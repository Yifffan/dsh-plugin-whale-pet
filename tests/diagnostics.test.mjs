import test from 'node:test';
import assert from 'node:assert/strict';
import { WhaleDiagnostics } from '../src/diagnostics.js';
import { WHALE_VERSION } from '../src/version.js';
import { WhaleBoundaryHub, apply } from '../src/host-bridge.js';
import { SessionAggregate } from '../src/global-state.js';
import { refreshHostDiagnostics } from '../src/bridge-client.js';
import { WHALE_DIAGNOSTICS_SCHEMA, WHALE_DIAGNOSTICS_DESCRIPTOR, TYPERT_REMOTE } from '../lib/remote.js';
import { TYPERT } from '../lib/typert.host.js';

const flush = async () => { for(let i=0;i<80;i++) await Promise.resolve(); };
const hostEvent = (seq,type='turn/end',kind='completed') => ({seq,type,time:seq,data:{reason:{kind,message:'PRIVATE'}}});
const input = (extra={}) => ({connected:true,scope:'global',catalog:{phase:'ready',byId:{a:{running:false},b:{running:false}}},statuses:new Map([['a',{running:false}],['b',{running:false}]]),...extra});
const boundary = (seq,type='turn/end',reason='completed',sessionId='a') => ({sessionId,seq,type,reason,id:`PRIVATE:${seq}`});

test('collector bounds trace, saturates counters, returns fresh JSON-safe snapshots',()=>{
  const d=new WhaleDiagnostics();
  for(let i=0;i<1000002;i++) d.record('start');
  const s=d.snapshot();assert.equal(s.counts.starts,1000000);assert.equal(s.trace.length,64);
  assert.equal(s.version,WHALE_VERSION);assert(s.elapsedMs>=0);assert(JSON.stringify(s).length<20000);
  s.trace[0].event='PRIVATE';s.counts.starts=0;s.decisions.dropped.scope=900;s.view.pose='PRIVATE';s.host.status='PRIVATE';
  const fresh=d.snapshot();assert.equal(fresh.counts.starts,1000000);assert.equal(fresh.decisions.dropped.scope,0);assert(!d.text().includes('PRIVATE'));
  assert.deepEqual(JSON.parse(d.text()).counts,fresh.counts);
});

test('malicious details, error objects, identifiers, epochs and getters are never retained',()=>{
  const d=new WhaleDiagnostics();const details={reason:'PRIVATE',sessionId:'PRIVATE',agentId:'PRIVATE',hostEpoch:'PRIVATE',message:'PRIVATE',error:new Error('PRIVATE'),stack:'PRIVATE',token:'PRIVATE',at:Date.now()};
  details.self=details;details.toJSON=()=>{throw Error('must not invoke')};
  d.record('end',details);d.record('reset',details);d.record('decision',{...details,outcome:'PRIVATE'});d.record('PRIVATE',details);
  d.record('host-unavailable',details);d.record('host-snapshot',{...details,version:'PRIVATE',starts:Infinity,ends:{toString(){throw Error('must not invoke')}},completed:1n});
  d.record('aggregate',{...details,notice:'PRIVATE',workingCount:Infinity,waitingCount:1e99});
  const getters=Object.defineProperty({},'reason',{get(){throw Error('must not invoke')}});d.record('end',getters);
  d.setView({state:'PRIVATE',available:true,noticeKey:'PRIVATE',message:'PRIVATE',id:'PRIVATE'}, {scope:'PRIVATE',hidden:true});
  const text=d.text();assert(!text.includes('PRIVATE'));assert(!text.includes('stack'));assert(!text.includes('sessionId'));assert(!text.includes('hostEpoch'));
  assert.equal(d.snapshot().view.pose,'unknown');assert.equal(d.snapshot().aggregate.waitingCount,1000000);
  assert.equal(d.snapshot().host.version,'unknown');assert.equal(d.snapshot().trace[0].reason,'unknown');
});

test('view captures only whitelisted pose, notice and flags; duplicate paints are coalesced',()=>{
  const d=new WhaleDiagnostics();
  const v={state:'celebrate',available:true,noticeKey:'celebrate.team',message:'PRIVATE',greeting:true};
  for(let i=0;i<100;i++)d.setView(v,{hidden:false,scope:'current'});
  assert.equal(d.snapshot().trace.length,1);
  assert.deepEqual(d.snapshot().view,{pose:'celebrate',available:true,notice:'completed',hidden:false,scope:'current',greeting:true});
  d.setView({...v,state:'waiting'},{hidden:true,scope:'global'});assert.equal(d.snapshot().trace.length,2);
  d.record('end',{reason:'blocked'});d.record('end',{reason:'max-tokens'});assert.equal(d.snapshot().counts.completed,0);
});

test('aggregate records actual boundary rejection gates and accepted publication',()=>{
  const d=new WhaleDiagnostics(),a=new SessionAggregate(()=>100,d);
  a.boundary(boundary(1));a.update(input({scope:'current',currentSessionId:'a'}));
  a.boundary(null);a.boundary(boundary(1,'turn/end','completed','b'));a.boundary(boundary(1));
  a.boundary(boundary(1));a.boundary(boundary(2,'turn/start'));a.boundary(boundary(3,'turn/end','cancelled'));
  a.boundary(boundary(4,'turn/start'));a.boundary(boundary(5));
  const s=d.snapshot();
  for(const reason of ['disconnected','invalid','scope','unobserved','duplicate','reason'])assert.equal(s.decisions.dropped[reason],1,reason);
  assert.equal(s.decisions.accepted.start,2);assert.equal(s.decisions.accepted.candidate,1);assert.equal(s.decisions.accepted.published,1);
  assert.equal(s.aggregate.notice,'completed');assert(!d.text().includes('PRIVATE'));
});

test('aggregate subagent, expiry, driver wait, and error priority preserve existing policies',()=>{
  let now=100;const d=new WhaleDiagnostics(),a=new SessionAggregate(()=>now,d);
  const i=input();i.catalog.byId.b.origin='subagent';a.update(i);
  a.boundary(boundary(1,'turn/start','completed','b'));a.boundary(boundary(2,'turn/end','completed','b'));
  i.statuses.set('a',{running:true});a.update(i);a.boundary(boundary(1,'turn/end','error'));
  a.update(i);a.update(i);assert.equal(d.snapshot().decisions.deferred['driver-busy'],1);
  now=10101;a.update(i);assert.equal(d.snapshot().decisions.dropped.expired,1);
  i.statuses.set('a',{running:false});a.update(i);a.boundary(boundary(2,'turn/start'));a.boundary(boundary(3,'turn/end','error'));
  // A new turn in the SAME session deliberately clears its old error; use a
  // different main session to exercise the existing cross-session priority gate.
  a.boundary(boundary(1,'turn/start','completed','c'));const end=a.boundary(boundary(2,'turn/end','completed','c'));assert.equal(end.notice.reason,'error');
  assert.equal(d.snapshot().decisions.dropped.subagent,1);assert.equal(d.snapshot().decisions.dropped['error-priority'],1);
});

test('baseline reset clears observed-start eligibility and records current working/waiting counts',()=>{
  const d=new WhaleDiagnostics(),a=new SessionAggregate(()=>100,d),i=input();a.update(i);
  a.boundary(boundary(1,'turn/start'));a.reset([], 'baseline');a.update(i);assert.equal(a.boundary(boundary(2)).notice,undefined);
  assert.equal(d.snapshot().decisions.dropped.unobserved,1);
  i.statuses.set('a',{running:true});i.statuses.set('b',{running:true,pendingInteraction:{message:'PRIVATE'}});a.update(i);
  assert.equal(d.snapshot().aggregate.workingCount,1);assert.equal(d.snapshot().aggregate.waitingCount,1);assert(!d.text().includes('PRIVATE'));
});

test('strict unary diagnostics descriptors and reflection agree with fixed DTO',()=>{
  assert.equal(WHALE_DIAGNOSTICS_DESCRIPTOR.mode,undefined);
  assert.deepEqual(WHALE_DIAGNOSTICS_DESCRIPTOR.parameters,[]);
  assert.deepEqual(WHALE_DIAGNOSTICS_DESCRIPTOR.cancellation,{parameter:'signal'});
  assert.equal(TYPERT.invocations[1],TYPERT_REMOTE.descriptors[1]);
  const dto={version:WHALE_VERSION,starts:1,ends:2,completed:1};assert.deepEqual(WHALE_DIAGNOSTICS_SCHEMA.parse(dto),dto);
  for(const invalid of [{...dto,sessionId:'PRIVATE'},{...dto,starts:-1},{...dto,ends:Infinity},{...dto,completed:1.5}])assert.throws(()=>WHALE_DIAGNOSTICS_SCHEMA.parse(invalid));
});

test('Host diagnostics counts accepted boundaries only, without reading history or retaining payload',()=>{
  const hub=new WhaleBoundaryHub({epoch:'PRIVATE',agents:{list(){throw Error('no history read')}}});
  hub.accept({id:'PRIVATE'},hostEvent(1,'assistant/message'));hub.accept({id:'PRIVATE'},hostEvent(-1));
  hub.accept({id:'PRIVATE'},hostEvent(1,'turn/start'));hub.accept({id:'PRIVATE'},hostEvent(2));
  hub.accept({id:'PRIVATE'},hostEvent(2));hub.accept({id:'PRIVATE'},hostEvent(1));hub.accept({id:'OTHER'},hostEvent(1,'turn/end','error'));
  const s=hub.diagnostics();assert.deepEqual(s,{version:WHALE_VERSION,starts:1,ends:2,completed:1});
  s.starts=999;assert.equal(hub.diagnostics().starts,1);assert(!JSON.stringify(s).includes('PRIVATE'));
  hub.dispose();hub.accept({id:'PRIVATE'},hostEvent(3));assert.equal(hub.diagnostics().ends,2);
});

test('Host registers read-only diagnostics in existing whalePet service without extra endpoint',()=>{
  let service,accept,dispose;
  apply({get:()=>undefined,provide(name,value){assert.equal(name,'whalePet');service=value},on(name,fn){assert.equal(name,'session/event');accept=fn},effect(fn){dispose=fn()}});
  assert.equal(service.typertRemote.namespace,'whalePet');assert.deepEqual(service.diagnostics(),{version:WHALE_VERSION,starts:0,ends:0,completed:0});
  accept({id:'PRIVATE'},hostEvent(1));assert.equal(service.diagnostics().completed,1);dispose();
});

const remoteContext = diagnostics => ({connection:{state:{getSnapshot:()=> 'connected'}},remote:{whalePet:{diagnostics}}});
test('user refresh unwraps RemoteResult, validates fixed DTO and never fabricates unavailable zeros',async()=>{
  const d=new WhaleDiagnostics();assert.deepEqual(d.snapshot().host,{status:'unavailable',reason:'not-requested'});
  let calls=0;const ctx=remoteContext(async signal=>{calls++;assert(signal instanceof AbortSignal);return {ok:true,value:{version:WHALE_VERSION,starts:4,ends:3,completed:2}}});
  await refreshHostDiagnostics(ctx,d);assert.equal(calls,1);assert.deepEqual(d.snapshot().host,{status:'available',version:WHALE_VERSION,starts:4,ends:3,completed:2,sampledAtMs:d.snapshot().host.sampledAtMs});
  assert(Number.isSafeInteger(d.snapshot().host.sampledAtMs));
  ctx.remote.whalePet.diagnostics=async()=>({ok:false,error:{message:'PRIVATE'}});await refreshHostDiagnostics(ctx,d);
  assert.deepEqual(d.snapshot().host,{status:'unavailable',reason:'remote-failure'});assert(!d.text().includes('PRIVATE'));
  ctx.remote.whalePet.diagnostics=async()=>({ok:true,value:{version:WHALE_VERSION,starts:4,ends:3,completed:2,token:'PRIVATE'}});await refreshHostDiagnostics(ctx,d);
  assert.equal(d.snapshot().host.reason,'invalid');
  delete ctx.remote.whalePet.diagnostics;await refreshHostDiagnostics(ctx,d);assert.equal(d.snapshot().host.reason,'unavailable');
});

test('diagnostics refresh timeout and abort finish even when transport ignores cancellation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const d=new WhaleDiagnostics();let signal,lateReject;
  const ctx=remoteContext(s=>{signal=s;return new Promise((_resolve,reject)=>{lateReject=reject})});
  const pending=refreshHostDiagnostics(ctx,d);await flush();t.mock.timers.tick(3000);await pending;
  assert(signal.aborted);assert.equal(d.snapshot().host.reason,'timeout');lateReject(Error('PRIVATE'));await flush();
  const outer=new AbortController();const pending2=refreshHostDiagnostics(ctx,d,{signal:outer.signal});await flush();outer.abort();await pending2;
  assert(signal.aborted);assert.equal(d.snapshot().host.reason,'aborted');lateReject(Error('PRIVATE'));await flush();
});
