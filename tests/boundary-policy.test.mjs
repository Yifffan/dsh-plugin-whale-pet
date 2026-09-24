import test from 'node:test';
import assert from 'node:assert/strict';
import { WhaleBoundaryHub, apply } from '../src/host-bridge.js';
import { SessionAggregate } from '../src/global-state.js';

const hostEvent = (seq,type='turn/end',kind='completed') => ({seq,type,time:seq,data:{reason:{kind,message:'PRIVATE'}}});
const input = (extra={}) => ({connected:true,scope:'global',catalog:{phase:'ready',byId:{a:{running:false},b:{running:false}}},statuses:new Map([['a',{running:false}],['b',{running:false}]]),...extra});
const boundary = (seq,type='turn/end',reason='completed',sessionId='a') => ({sessionId,seq,type,reason,id:`turn:${seq}`});

test('aggregate rejects disconnected, invalid, out-of-scope, unobserved, duplicate and cancelled boundaries',()=>{
  const a=new SessionAggregate(()=>100);
  assert.equal(a.boundary(boundary(1)).notice,undefined);
  a.update(input({scope:'current',currentSessionId:'a'}));
  for(const value of [null,boundary(1,'turn/end','completed','b'),boundary(1),boundary(1)])assert.equal(a.boundary(value).notice,undefined);
  a.boundary(boundary(2,'turn/start'));assert.equal(a.boundary(boundary(3,'turn/end','cancelled')).notice,undefined);
  a.boundary(boundary(4,'turn/start'));const accepted=a.boundary(boundary(5));
  assert.equal(accepted.notice.reason,'completed');assert.equal(accepted.notice.sessionId,'a');
  assert.equal(a.boundary(boundary(5)).notice,accepted.notice);
  assert.equal(a.boundary(boundary(6,'turn/end','cancelled')).notice,undefined);
});

test('aggregate subagent, expiry, driver wait, and error priority preserve existing policies',()=>{
  let now=100;const a=new SessionAggregate(()=>now);
  const i=input();i.catalog.byId.b.origin='subagent';a.update(i);
  a.boundary(boundary(1,'turn/start','completed','b'));assert.equal(a.boundary(boundary(2,'turn/end','completed','b')).notice,undefined);
  i.statuses.set('a',{running:true});a.update(i);assert.equal(a.boundary(boundary(1,'turn/end','error')).notice,undefined);
  assert.equal(a.update(i).notice,undefined);assert.equal(a.update(i).notice,undefined);
  now=10101;assert.equal(a.update(i).notice,undefined);
  i.statuses.set('a',{running:false});assert.equal(a.update(i).notice,undefined,'expired error must not reappear at idle');
  a.boundary(boundary(2,'turn/start'));assert.equal(a.boundary(boundary(3,'turn/end','error')).notice.reason,'error');
  // A fresh turn in the same session deliberately clears its error; use another root.
  a.boundary(boundary(1,'turn/start','completed','c'));const end=a.boundary(boundary(2,'turn/end','completed','c'));
  assert.equal(end.notice.reason,'error');assert.equal(end.notice.sessionId,'a');
});

test('baseline reset clears observed-start eligibility and working/waiting output excludes payload',()=>{
  const a=new SessionAggregate(()=>100),i=input();a.update(i);
  a.boundary(boundary(1,'turn/start'));a.reset();a.update(i);assert.equal(a.boundary(boundary(2)).notice,undefined);
  i.statuses.set('a',{running:true});i.statuses.set('b',{running:true,pendingInteraction:{message:'PRIVATE'}});
  const snapshot=a.update(i);assert.equal(snapshot.workingCount,1);assert.equal(snapshot.waitingCount,1);
  assert(!JSON.stringify(snapshot).includes('PRIVATE'));
});

test('Host accepts only deduplicated boundaries without reading or retaining private payload',async()=>{
  const hub=new WhaleBoundaryHub({epoch:'e',agents:{list(){throw Error('no history read')}}});
  const reader=hub.watch();assert.deepEqual((await reader.next()).value.identities,[]);
  const secret=hostEvent(1,'assistant/message');Object.defineProperty(secret,'data',{get(){throw Error('must not inspect content')}});
  hub.accept({id:'a'},secret);hub.accept({id:'a'},hostEvent(-1));
  hub.accept({id:'a'},hostEvent(1,'turn/start'));hub.accept({id:'a'},hostEvent(2));
  hub.accept({id:'a'},hostEvent(2));hub.accept({id:'a'},hostEvent(1));hub.accept({id:'b'},hostEvent(1,'turn/end','error'));
  const frames=[];for(let i=0;i<3;i++)frames.push((await reader.next()).value);
  assert.deepEqual(frames.map(frame=>[frame.type,frame.reason]),[['turn/start',undefined],['turn/end','completed'],['turn/end','error']]);
  assert.equal(hub.streamSeq,3);assert(!JSON.stringify(frames).includes('PRIVATE'));
  assert(!JSON.stringify([...hub.seen]).includes('PRIVATE'));
  hub.dispose();hub.accept({id:'a'},hostEvent(3));assert.equal(hub.streamSeq,3);assert.deepEqual(await reader.next(),{done:true});
});

test('Host registers only the read-only watch capability and disposal closes its readers',async()=>{
  let service,accept,dispose;
  apply({get:()=>undefined,provide(name,value){assert.equal(name,'whalePet');service=value},on(name,fn,options){assert.equal(name,'session/event');assert.deepEqual(options,{global:true});accept=fn},effect(fn){dispose=fn()}});
  assert.deepEqual(Object.keys(service).sort(),['typertRemote','watch']);
  assert.equal(service.typertRemote.namespace,'whalePet');assert.equal(service.typertRemote.service,service);
  const reader=service.watch();assert.equal((await reader.next()).value.type,'baseline');
  accept({id:'a'},hostEvent(1));assert.equal((await reader.next()).value.reason,'completed');
  const pending=reader.next();dispose();assert.deepEqual(await pending,{done:true});dispose();
});
