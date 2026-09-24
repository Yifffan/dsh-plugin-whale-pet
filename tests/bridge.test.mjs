import test from 'node:test';
import assert from 'node:assert/strict';
import { WhaleBoundaryHub, runtimeIdentity } from '../src/host-bridge.js';
import { observeGlobalEvents } from '../src/bridge-client.js';
import { WHALE_FRAME_SCHEMA, WHALE_WATCH_DESCRIPTOR, TYPERT_REMOTE } from '../lib/remote.js';
import * as remoteContract from '../lib/remote.js';
import { TYPERT } from '../lib/typert.host.js';
import { withNamespaceInjection } from './namespace-context.mjs';
const event = (seq,type='turn/end',kind='completed') => ({ seq,type,time:seq,data:{reason:{kind,message:'PRIVATE'},content:'PRIVATE'} });
const settle = async () => { for(let i=0;i<16;i++) await Promise.resolve(); };
function stateStore(value) {
 const listeners=new Set();return {getSnapshot:()=>value,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},set(v){value=v;for(const fn of listeners)fn()},size:()=>listeners.size};
}
function fakeContext(hub) {
 let mounts=0,unmounts=0;
 const remote={$mount:async contribution=>{assert.equal(contribution,TYPERT_REMOTE);mounts++;return async()=>{unmounts++}},whalePet:{watch:signal=>hub.watch(signal)}};
 return withNamespaceInjection({remote,connection:{state:stateStore('connected'),generation:stateStore({id:1})},counts:()=>({mounts,unmounts})});
}

test('strict Host and Client descriptors agree and output schemas reject extra properties',()=>{
 assert.deepEqual(Object.keys(remoteContract).sort(),['TYPERT_REMOTE','WHALE_FRAME_SCHEMA','WHALE_WATCH_DESCRIPTOR']);
 assert.deepEqual(TYPERT_REMOTE.descriptors,[WHALE_WATCH_DESCRIPTOR]);
 assert.deepEqual(TYPERT.invocations,[WHALE_WATCH_DESCRIPTOR]);
 assert.deepEqual(TYPERT.schemas.map(schema=>schema.name),['WhaleBoundaryFrame']);
 assert.deepEqual(TYPERT.model.services[0].members.map(member=>member.name),['watch']);
 const frame={type:'turn/end',hostEpoch:'e',streamSeq:1,sessionId:'s',seq:2,time:2,reason:'error'};
 assert.deepEqual(WHALE_FRAME_SCHEMA.parse(frame),frame);
 assert.throws(()=>WHALE_FRAME_SCHEMA.parse({...frame,body:'PRIVATE'}));
 assert.throws(()=>WHALE_FRAME_SCHEMA.parse({...frame,seq:1.5}));
 assert.throws(()=>WHALE_FRAME_SCHEMA.parse({...frame,streamSeq:-1}));
 assert.throws(()=>WHALE_FRAME_SCHEMA.parse({...frame,time:Infinity}));
});

test('Host projects only live turn boundaries and no reason details/body',async()=>{
 const hub=new WhaleBoundaryHub({epoch:'e'});const reader=hub.watch(new AbortController().signal);
 assert.equal((await reader.next()).value.type,'baseline');
 hub.accept({id:'s'},event(1,'assistant/message'));
 hub.accept({id:'s'},event(2,'turn/start'));
 hub.accept({id:'s'},event(3));
 assert.equal((await reader.next()).value.type,'turn/start');
 const end=(await reader.next()).value;
 assert.deepEqual(Object.keys(end).sort(),['hostEpoch','reason','seq','sessionId','streamSeq','time','type'].sort());
 assert.equal(end.reason,'completed');assert.equal(JSON.stringify(end).includes('PRIVATE'),false);
 hub.dispose();assert.deepEqual(await reader.next(),{done:true});
});

test('Host baseline never replays earlier completion and has a shared watermark',async()=>{
 const hub=new WhaleBoundaryHub({epoch:'e'});hub.accept({id:'s'},event(1));
 const reader=hub.watch();const baseline=(await reader.next()).value;
 assert.equal(baseline.type,'baseline');assert.equal(baseline.streamSeq,1);
 hub.accept({id:'s'},event(2,'turn/start'));
 assert.equal((await reader.next()).value.streamSeq,2);hub.dispose();
});

test('Host deduplicates per session and allows equal seq across different sessions',async()=>{
 const hub=new WhaleBoundaryHub({epoch:'e'});const reader=hub.watch();await reader.next();
 hub.accept({id:'a'},event(2));hub.accept({id:'a'},event(2));hub.accept({id:'a'},event(1));hub.accept({id:'b'},event(2));
 assert.equal((await reader.next()).value.sessionId,'a');assert.equal((await reader.next()).value.sessionId,'b');
 assert.equal(hub.streamSeq,2);hub.dispose();
});

test('bounded queue overflow resets watermark instead of replaying stale successes',async()=>{
 const hub=new WhaleBoundaryHub({epoch:'e',queueLimit:2});const reader=hub.watch();await reader.next();
 for(let seq=1;seq<=3;seq++)hub.accept({id:'s'},event(seq));
 const reset=(await reader.next()).value;assert.equal(reset.type,'baseline');assert.equal(reset.streamSeq,3);
 hub.accept({id:'s'},event(4,'turn/start'));assert.equal((await reader.next()).value.streamSeq,4);hub.dispose();
});

test('runtime ownership classification does not mistake a restored root for an owned child',async()=>{
 const root={id:'r'},restored={id:'old-child'},child={id:'c'};const items=[root,restored,child];
 const agents={get:id=>items.find(x=>x.id===id),list:()=>items,roots:()=>[root,restored]};
 assert.deepEqual(runtimeIdentity(agents,'r'),{isSubagent:false});
 assert.deepEqual(runtimeIdentity(agents,'old-child'),{isSubagent:false});
 assert.deepEqual(runtimeIdentity(agents,'c'),{isSubagent:true});
 assert.deepEqual(runtimeIdentity(agents,'missing'),{});
 const hub=new WhaleBoundaryHub({agents,epoch:'e'});const reader=hub.watch();
 assert.deepEqual((await reader.next()).value.identities,[{sessionId:'r',isSubagent:false},{sessionId:'old-child',isSubagent:false},{sessionId:'c',isSubagent:true}]);hub.dispose();
});

test('abort, return and Host disposal release all readers idempotently',async()=>{
 const hub=new WhaleBoundaryHub({epoch:'e'});const abort=new AbortController();const reader=hub.watch(abort.signal);await reader.next();
 const pending=reader.next();abort.abort();assert.deepEqual(await pending,{done:true});assert.equal(hub.clients.size,0);
 await reader.return();hub.dispose();hub.dispose();const late=hub.watch();assert.deepEqual(await late.next(),{done:true});
});

test('observer emits stable unique IDs and does not equate cancelled/error with completed',async()=>{
 const hub=new WhaleBoundaryHub({epoch:'e'});const ctx=fakeContext(hub);const seen=[],health=[];
 const cleanup=observeGlobalEvents(ctx,{onBoundary:v=>seen.push(v),onHealth:v=>health.push(v)});await settle();
 for(const [seq,reason]of [[1,'completed'],[2,'aborted'],[3,'error']])hub.accept({id:'a'},event(seq,'turn/end',reason));
 await settle();assert.deepEqual(seen.map(x=>x.reason),['completed','aborted','error']);assert.deepEqual(seen.map(x=>x.id),['e:1','e:2','e:3']);assert.deepEqual(health,[false,true]);
 cleanup();cleanup();await settle();assert.equal(hub.clients.size,0);assert.equal(ctx.connection.state.size(),0);assert.deepEqual(ctx.counts(),{mounts:1,unmounts:1});hub.dispose();
});

test('observer reconnects with a baseline and never replays offline completion',async()=>{
 const hub=new WhaleBoundaryHub({epoch:'e'});const ctx=fakeContext(hub);const seen=[],resets=[];
 const cleanup=observeGlobalEvents(ctx,{onBoundary:v=>seen.push(v),onReset:v=>resets.push(v)});await settle();
 ctx.connection.state.set('disconnected');hub.accept({id:'a'},event(1));
 ctx.connection.generation.set({id:2});ctx.connection.state.set('connected');await settle();assert.equal(seen.length,0);
 hub.accept({id:'a'},event(2,'turn/start'));await settle();assert.equal(seen[0].seq,2);
 assert.equal(resets.filter(x=>x.type==='baseline').length,2);cleanup();await settle();hub.dispose();
});

test('overlapping observer mounts share one strict Remote contribution',async()=>{
 const hub=new WhaleBoundaryHub({epoch:'e'});const ctx=fakeContext(hub);
 const a=observeGlobalEvents(ctx),b=observeGlobalEvents(ctx);await settle();assert.equal(ctx.counts().mounts,1);assert.equal(hub.clients.size,2);
 a();await settle();assert.equal(ctx.counts().unmounts,0);assert.equal(hub.clients.size,1);
 b();await settle();assert.equal(ctx.counts().unmounts,1);assert.equal(hub.clients.size,0);hub.dispose();
});

test('fresh traced Remote wrappers share their stable Context root mount',async()=>{
 const hub=new WhaleBoundaryHub({epoch:'e'});const ctx=fakeContext(hub);const base=ctx.remote;
 ctx.root={};Object.defineProperty(ctx,'remote',{get:()=>Object.defineProperties({},Object.getOwnPropertyDescriptors(base))});
 const a=observeGlobalEvents(ctx),b=observeGlobalEvents(ctx);await settle();
 assert.equal(ctx.counts().mounts,1);a();b();await settle();assert.equal(ctx.counts().unmounts,1);hub.dispose();
});

test('namespace injection happens only after local mount resolves and watch uses the child service',async t=>{
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub);let finishMount,mounted=false,injections=0;
  ctx.remote.$mount=()=>new Promise(resolve=>{finishMount=()=>{mounted=true;resolve(async()=>{})}});
  const inject=ctx.inject;
  ctx.inject=(keys,callback)=>{assert.equal(mounted,true);injections++;return inject(keys,callback)};
  ctx.namespace.watch=function(signal){assert.equal(this,ctx.namespace);return hub.watch(signal)};
  const stop=observeGlobalEvents(ctx);t.after(()=>{stop();hub.dispose()});await settle();
  assert.equal(injections,0);assert.equal(ctx.namespaceChildren(),0);assert.equal(hub.clients.size,0);
  finishMount();await settle();assert.equal(injections,1);assert.equal(hub.clients.size,1);
  assert.throws(()=>ctx.remote.whalePet,/without inject/);
});

test('cleanup before async mount resolves releases it without starting stream or late callback',async()=>{
 const hub=new WhaleBoundaryHub({epoch:'e'});const ctx=fakeContext(hub);let finishMount;let unmounted=0;let callbacks=0;
 ctx.remote.$mount=()=>new Promise(resolve=>{finishMount=()=>resolve(async()=>{unmounted++})});
 const cleanup=observeGlobalEvents(ctx,{onHealth:()=>callbacks++,onReset:()=>callbacks++});await settle();
 cleanup();const before=callbacks;finishMount();await settle();assert.equal(callbacks,before);assert.equal(unmounted,1);assert.equal(hub.clients.size,0);hub.dispose();
});

test('invalid/gapped frames fail closed and clear unplayed notifications',async()=>{
 const hub=new WhaleBoundaryHub({epoch:'e'});const ctx=fakeContext(hub);const seen=[],health=[],resets=[];
 const cleanup=observeGlobalEvents(ctx,{onBoundary:v=>seen.push(v),onHealth:v=>health.push(v),onReset:v=>resets.push(v)});await settle();
 for(const client of hub.clients)client.push({type:'turn/end',hostEpoch:'e',streamSeq:8,sessionId:'a',seq:1,time:1,reason:'completed'});
 await settle();assert.equal(seen.length,0);assert.equal(health.at(-1),false);assert.equal(resets.at(-1).reason,'stream-ended');cleanup();await settle();hub.dispose();
});

test('absence of Remote is a completion-stream failure, not a fabricated task state',()=>{
 const flags=[],resets=[];const cleanup=observeGlobalEvents({}, {onHealth:v=>flags.push(v),onReset:v=>resets.push(v)});
 assert.deepEqual(flags,[false]);assert.equal(resets[0].reason,'unavailable');cleanup();cleanup();
});

const flush = async () => { for (let i=0;i<80;i++) await Promise.resolve(); };

test('namespace injection is required, never bypassed by a plain Remote mock',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub),health=[],resets=[];
  assert.throws(()=>ctx.remote.whalePet,/without inject/);
  delete ctx.inject;
  const stop=observeGlobalEvents(ctx,{onHealth:v=>health.push(v),onReset:v=>resets.push(v)});t.after(()=>{stop();hub.dispose()});await flush();
  assert.equal(hub.clients.size,0);assert.equal(ctx.namespaceChildren(),0);
  assert.deepEqual(health,[false]);assert.equal(resets.at(-1).reason,'stream-ended');
  assert.deepEqual(ctx.counts(),{mounts:1,unmounts:0});
});

test('pending namespace is bounded, releases its child, and recovers without remount',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub),health=[],resets=[];
  ctx.setNamespaceAvailable(false);
  const stop=observeGlobalEvents(ctx,{onHealth:v=>health.push(v),onReset:v=>resets.push(v)});t.after(()=>{stop();hub.dispose()});await flush();
  assert.equal(ctx.namespaceChildren(),1);assert.equal(hub.clients.size,0);
  t.mock.timers.tick(3000);await flush();
  assert.equal(ctx.namespaceChildren(),0);assert.equal(hub.clients.size,0);
  assert.deepEqual(health,[false]);assert.equal(resets.at(-1).reason,'stream-ended');
  ctx.setNamespaceAvailable(true);t.mock.timers.tick(1000);await flush();
  assert.equal(ctx.counts().mounts,1);assert.equal(hub.clients.size,1);assert.equal(ctx.namespaceChildren(),1);
  assert.deepEqual(health,[false,true]);assert.equal(resets.at(-1).type,'baseline');
});

test('pending scope disposal and generation replacement cannot open stale streams',async t=>{
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub);
  ctx.setNamespaceAvailable(false);
  const stop=observeGlobalEvents(ctx);t.after(()=>{stop();hub.dispose()});await flush();
  ctx.connection.generation.set({id:2});await flush();assert.equal(ctx.namespaceChildren(),1);
  ctx.setNamespaceAvailable(true);await flush();assert.equal(hub.clients.size,1);
  ctx.connection.generation.set({id:3});await flush();assert.equal(hub.clients.size,1);assert.equal(ctx.namespaceChildren(),1);
  stop();await flush();assert.equal(hub.clients.size,0);assert.equal(ctx.namespaceChildren(),0);
  ctx.setNamespaceAvailable(true);await flush();assert.equal(hub.clients.size,0);
});

test('disposing while namespace is pending removes its parked child and readiness timer',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub),health=[],resets=[];
  ctx.setNamespaceAvailable(false);
  const stop=observeGlobalEvents(ctx,{onHealth:v=>health.push(v),onReset:v=>resets.push(v)});await flush();assert.equal(ctx.namespaceChildren(),1);
  stop();await flush();assert.equal(ctx.namespaceChildren(),0);assert.equal(ctx.counts().unmounts,1);
  const before=resets.length;
  ctx.setNamespaceAvailable(true);t.mock.timers.tick(10000);await flush();
  assert.equal(hub.clients.size,0);assert.equal(ctx.namespaceChildren(),0);assert.deepEqual(health,[false]);
  assert.equal(resets.length,before);assert.equal(ctx.counts().mounts,1);hub.dispose();
});

test('namespace withdrawal aborts established stream and retry reacquires child capability',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub),health=[];
  const stop=observeGlobalEvents(ctx,{onHealth:v=>health.push(v)});t.after(()=>{stop();hub.dispose()});await flush();
  assert.equal(hub.clients.size,1);ctx.setNamespaceAvailable(false);await flush();
  assert.equal(hub.clients.size,0);assert.equal(ctx.namespaceChildren(),0);assert.equal(health.at(-1),false);
  ctx.setNamespaceAvailable(true);t.mock.timers.tick(1000);await flush();
  assert.equal(hub.clients.size,1);assert.equal(health.at(-1),true);assert.equal(ctx.counts().mounts,1);
});
test('failed LOCAL mount retries in same observer and overlapping retries coalesce',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub),health=[],resets=[];
  let mounts=0,unmounts=0;
  ctx.remote.$mount=async()=>{if(++mounts===1)throw Error('PRIVATE');return async()=>{unmounts++}};
  const a=observeGlobalEvents(ctx,{onHealth:v=>health.push(v),onReset:v=>resets.push(v)}),b=observeGlobalEvents(ctx);
  t.after(()=>{a();b();hub.dispose()});await flush();
  assert.equal(mounts,1);assert.equal(hub.clients.size,0);
  t.mock.timers.tick(1000);await flush();
  assert.equal(mounts,2);assert.equal(hub.clients.size,2);
  assert.deepEqual(health,[false,true]);assert.equal(resets.at(-1).type,'baseline');
  a();await flush();assert.equal(unmounts,0);
  b();await flush();assert.equal(unmounts,1);
});

test('reconnect reacquires failed local lease without waiting for scheduled retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub);let mounts=0;
  ctx.remote.$mount=async()=>{if(++mounts===1)throw Error('PRIVATE');return async()=>{}};
  const stop=observeGlobalEvents(ctx);t.after(()=>{stop();hub.dispose()});await flush();
  ctx.connection.state.set('disconnected');ctx.connection.generation.set(2);ctx.connection.state.set('connected');await flush();
  assert.equal(mounts,2);assert.equal(hub.clients.size,1);
  t.mock.timers.tick(10000);await flush();assert.equal(mounts,2);assert.equal(hub.clients.size,1);
});

test('ordinary watch dispatch failure retries watch but never remounts',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub),health=[],resets=[];let watches=0;
  ctx.namespace.watch=signal=>{if(++watches===1)throw Error('PRIVATE');return hub.watch(signal)};
  const stop=observeGlobalEvents(ctx,{onHealth:v=>health.push(v),onReset:v=>resets.push(v)});t.after(()=>{stop();hub.dispose()});await flush();
  t.mock.timers.tick(1000);await flush();
  assert.equal(watches,2);assert.equal(ctx.counts().mounts,1);
  assert.deepEqual(health,[false,true]);assert.equal(hub.clients.size,1);
  assert.equal(resets.filter(value=>value.reason==='stream-ended').length,1);
});

test('new mount waits for prior namespace unmount to finish',async t=>{
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub);let mounts=0,active=0,finish;
  ctx.remote.$mount=async()=>{assert.equal(active,0);active++;mounts++;return()=>new Promise(resolve=>{finish=()=>{active--;resolve()}})};
  const a=observeGlobalEvents(ctx);await flush();a();await flush();assert.equal(typeof finish,'function');
  const b=observeGlobalEvents(ctx);t.after(()=>{b();hub.dispose()});await flush();assert.equal(mounts,1);
  finish();await flush();assert.equal(mounts,2);assert.equal(hub.clients.size,1);
  b();await flush();finish();await flush();assert.equal(active,0);
});

test('repeated zero-ref transitions during pending mount unmount once and serialize replacement',async t=>{
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub);
  let finishMount,finishUnmount,mounts=0,unmounts=0,active=0;
  ctx.remote.$mount=()=>{mounts++;assert.equal(active,0);return new Promise(resolve=>{finishMount=()=>{active++;resolve(()=>{unmounts++;return new Promise(done=>{finishUnmount=()=>{active--;done()}})})}})};
  const a=observeGlobalEvents(ctx);await flush();a();
  const b=observeGlobalEvents(ctx);b();await flush();assert.equal(mounts,1);
  finishMount();await flush();assert.equal(unmounts,1);
  const c=observeGlobalEvents(ctx);t.after(()=>{c();hub.dispose()});await flush();assert.equal(mounts,1);
  finishUnmount();await flush();assert.equal(mounts,2);finishMount();await flush();assert.equal(hub.clients.size,1);
  c();await flush();assert.equal(unmounts,2);finishUnmount();await flush();assert.equal(active,0);
});

test('reconnect while initial local mount is pending starts only newest stream generation',async t=>{
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub);let finish,mounts=0;
  ctx.remote.$mount=()=>{mounts++;return new Promise(resolve=>{finish=()=>resolve(async()=>{})})};
  const stop=observeGlobalEvents(ctx);t.after(()=>{stop();hub.dispose()});await flush();
  ctx.connection.state.set('disconnected');ctx.connection.generation.set(2);ctx.connection.state.set('connected');
  finish();await flush();assert.equal(mounts,1);assert.equal(hub.clients.size,1);
});

test('disposing after failed mount cancels recovery; reconnect cannot resurrect observer',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub);let mounts=0;
  ctx.remote.$mount=async()=>{mounts++;throw Error('PRIVATE')};
  const stop=observeGlobalEvents(ctx);await flush();stop();
  ctx.connection.state.set('disconnected');ctx.connection.state.set('connected');t.mock.timers.tick(10000);await flush();
  assert.equal(mounts,1);assert.equal(hub.clients.size,0);hub.dispose();
});

test('baseline-only feed ready never fabricates a received boundary',async t=>{
  const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub),health=[],resets=[],seen=[];
  const stop=observeGlobalEvents(ctx,{onBoundary:v=>seen.push(v),onHealth:v=>health.push(v),onReset:v=>resets.push(v)});
  t.after(()=>{stop();hub.dispose()});await flush();
  assert.deepEqual(health,[false,true]);assert.equal(resets.filter(value=>value.type==='baseline').length,1);
  assert.deepEqual(seen,[]);
  ctx.connection.state.set('disconnected');await flush();assert.equal(health.at(-1),false);
  assert.equal(hub.clients.size,0);assert.deepEqual(seen,[]);
});

test('malformed and gapped frames close streams; duplicates are ignored without losing healthy watch',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  for(const [duplicate,frame]of [
    [false,{type:'turn/end',body:'PRIVATE'}],
    [false,{type:'turn/end',hostEpoch:'e',streamSeq:3,sessionId:'a',seq:1,time:1,reason:'completed'}],
    [true,{type:'turn/end',hostEpoch:'e',streamSeq:0,sessionId:'a',seq:1,time:1,reason:'completed'}],
  ]){
    const hub=new WhaleBoundaryHub({epoch:'e'}),ctx=fakeContext(hub),health=[],resets=[],seen=[];
    const stop=observeGlobalEvents(ctx,{onBoundary:v=>seen.push(v),onHealth:v=>health.push(v),onReset:v=>resets.push(v)});
    await flush();for(const client of hub.clients)client.push(frame);await flush();
    assert.deepEqual(seen,[]);assert.equal(health.at(-1),duplicate);
    assert.equal(hub.clients.size,duplicate?1:0);assert.equal(ctx.namespaceChildren(),duplicate?1:0);
    if(duplicate){
      hub.accept({id:'a'},event(1,'turn/start'));await flush();assert.equal(seen.length,1);assert.equal(seen[0].type,'turn/start');
    }else assert.equal(resets.at(-1).reason,'stream-ended');
    assert(!JSON.stringify({seen,resets}).includes('PRIVATE'));
    stop();hub.dispose();await flush();
  }
});
