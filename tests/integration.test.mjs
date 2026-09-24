import test from 'node:test';
import assert from 'node:assert/strict';
import { connectWhaleState } from '../src/adapter.js';
import { PetStateMachine } from '../src/state.js';
import { observeGlobalEvents } from '../src/bridge-client.js';
import { withNamespaceInjection } from './namespace-context.mjs';
function wire() {
  let connection = 'connected', handlers, disposed = 0;
  const listeners = new Set();
  const ctx = {
    connection: { state: { getSnapshot: () => connection, subscribe: cb => { listeners.add(cb); return () => listeners.delete(cb); } } },
    sessions: { retain() { throw new Error('Global observation must not retain transcripts'); } },
  };
  const projection = { catalog: { phase: 'ready', byId: { a: { id: 'a', running: true, retainedBy: { mainView: 1 } }, b: { id: 'b', running: false, retainedBy: {} } } }, statuses: new Map([['a', { running: true }], ['b', { running: false }]]) };
  const machine = new PetStateMachine();
  const updates = [];
  const widget = { host: { dataset: {} }, preferences: { scope: 'global' }, update(s) { updates.push(s); machine.update(s); } };
  const control = connectWhaleState(ctx, widget, () => projection, (_ctx, callbacks) => { handlers = callbacks; return () => disposed++; });
  return {
    ctx, projection, widget, machine, updates, control, listeners,
    get handlers() { return handlers; }, get disposed() { return disposed; },
    connect(value) { connection = value; for (const listener of listeners) listener(); },
    boundary(id, seq, type, reason) { handlers.onBoundary({ sessionId: id, seq, type, reason, id: `${id}:${seq}` }); },
  };
}
test('integration aggregates root stores without retaining any session history', () => {
  const f = wire(); assert.equal(f.machine.view().state, 'working'); assert.equal(f.machine.view().workingCount, 1); f.control.dispose();
});
test('a normally completed reply celebrates immediately without waiting for driver idle', () => {
  const f = wire(); f.boundary('a', 1, 'turn/start'); f.boundary('a', 2, 'turn/end', 'completed');
  assert.equal(f.machine.view().state, 'celebrate');
  assert.equal(f.updates.at(-1).running, true);
  const notice = f.updates.at(-1).notice.id;
  f.boundary('a', 3, 'turn/start');
  assert.equal(f.updates.at(-1).notice.id, notice);
  assert.equal(f.machine.view().state, 'celebrate', 'automatic continuation must not erase the completed reply');
  assert.equal(f.machine.view(f.machine.noticeUntil + 1).state, 'working');
  f.projection.statuses.set('a', { running: false }); f.control.publish();
  assert.equal(f.machine.view().state, 'celebrate'); f.control.dispose();
});
test('each new normal reply in a continuously running session can celebrate once', () => {
  const f = wire(); f.boundary('a', 1, 'turn/start'); f.boundary('a', 2, 'turn/end', 'completed');
  const first = f.machine.noticeId;
  f.boundary('a', 3, 'turn/start'); f.boundary('a', 4, 'turn/end', 'completed');
  const second = f.machine.noticeId;
  assert.notEqual(second, first); assert.equal(f.machine.view().state, 'celebrate');
  const deadline = f.machine.noticeUntil;
  f.boundary('a', 4, 'turn/end', 'completed');
  assert.equal(f.machine.noticeId, second); assert.equal(f.machine.noticeUntil, deadline);
  f.control.dispose();
});
test('connection drop masks cache and reset suppresses old terminal candidates', () => {
  const f = wire(); f.boundary('a', 2, 'turn/end', 'completed'); f.connect('disconnected');
  assert.equal(f.machine.view().available, false);
  f.projection.statuses.set('a', { running: false }); f.connect('connected'); f.handlers.onReset();
  assert.equal(f.machine.view().state, 'resting'); f.control.dispose();
});
test('stream failure resets notices without masking root work or waiting or exposing health UI', () => {
  const f = wire(); f.handlers.onReset({reason:'stream-ended'});
  assert.equal(f.machine.view().state, 'working');
  f.projection.statuses.set('b',{running:false,pendingInteraction:{id:'question'}});
  f.handlers.onReset({reason:'stream-ended'});assert.equal(f.machine.view().state,'waiting');
  assert.equal(f.handlers.onHealth,undefined);assert.deepEqual(f.widget.host.dataset,{});f.control.dispose();
});
test('synchronous stream setup failure stays quiet while root work and waiting remain usable',()=>{
  const machine=new PetStateMachine(),listeners=new Set();
  const ctx={connection:{state:{getSnapshot:()=> 'connected',subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}}}};
  const projection={catalog:{phase:'ready',byId:{a:{running:true}}},statuses:new Map([['a',{running:true}]])};
  const widget={preferences:{scope:'global'},update:value=>machine.update(value)};
  const control=connectWhaleState(ctx,widget,()=>projection,()=>{throw Error('PRIVATE')});
  assert.equal(machine.view().state,'working');projection.statuses.set('a',{running:true,pendingInteraction:{id:'question'}});
  control.publish();assert.equal(machine.view().state,'waiting');control.dispose();assert.equal(listeners.size,0);
});
test('changing scope uses mainView selection and cancels out-of-scope notices', () => {
  const f = wire(); f.widget.preferences.scope = 'current';
  f.projection.catalog.byId.a.retainedBy = {}; f.projection.catalog.byId.b.retainedBy = { mainView: 1 };
  f.control.publish(); assert.equal(f.machine.view().state, 'resting');
  f.boundary('a', 2, 'turn/end', 'error'); assert.equal(f.machine.view().state, 'resting');
  f.widget.preferences.scope = 'global'; f.control.publish(); assert.equal(f.machine.view().state, 'working'); f.control.dispose();
});
test('an already-published pending request works even before session catalog entry', () => {
  const f = wire(); f.projection.statuses.set('unopened', { pendingInteraction: { id: 'question' } }); f.control.publish();
  assert.equal(f.machine.view().state, 'waiting'); f.projection.statuses.delete('unopened'); f.control.publish();
  assert.equal(f.machine.view().state, 'working'); f.control.dispose();
});
test('teardown removes both subscriptions once and ignores late callbacks', () => {
  const f = wire(); f.control.dispose(); f.control.dispose(); const length = f.updates.length;
  f.handlers.onReset(); f.boundary('a', 2, 'turn/end', 'completed'); f.control.publish();
  assert.equal(f.updates.length, length); assert.equal(f.disposed, 1); assert.equal(f.listeners.size, 0);
});

const flush = async () => { for(let i=0;i<100;i++)await Promise.resolve(); };
test('adapter attaches no collector, read RPC callback or diagnostic observer option',()=>{
  const f=wire();
  assert.equal('diagnostics' in f.widget,false);assert.equal('onDiagnosticsRefresh' in f.widget,false);
  assert.deepEqual(Object.keys(f.handlers).sort(),['onBoundary','onReset']);f.control.dispose();
});

test('clean EOF clears just-published notice and closes its child while retaining actual celebration',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const machine=new PetStateMachine(0),poses=[],updates=[],health=[],resets=[];
  const widget={preferences:{scope:'global'},host:{dataset:{}},update(s){updates.push(s);poses.push(machine.update(s,0).state)}};
  const state={getSnapshot:()=> 'connected',subscribe:()=>()=>{}};
  const frame=(type,seq)=>({type,hostEpoch:'PRIVATE',streamSeq:seq,sessionId:'PRIVATE',seq,time:seq,...(type==='turn/end'?{reason:'completed'}:{})});
  const ctx={root:{},connection:{state},remote:{$mount:async()=>async()=>{},whalePet:{async *watch(){
    yield {type:'baseline',hostEpoch:'PRIVATE',streamSeq:0,identities:[]};yield frame('turn/start',1);yield frame('turn/end',2);
  }}}};
  withNamespaceInjection(ctx);
  const control=connectWhaleState(ctx,widget,()=>({catalog:{phase:'ready',byId:{PRIVATE:{running:false}}},statuses:new Map([['PRIVATE',{running:false}]])}),
    (context,callbacks)=>observeGlobalEvents(context,{...callbacks,onHealth:value=>health.push(value),onReset:value=>{resets.push(value);callbacks.onReset(value)}}));
  t.after(()=>control.dispose());await flush();
  assert(poses.includes('celebrate'));assert.equal(poses.at(-1),'resting');
  assert.deepEqual(health,[false,true,false]);assert.equal(resets.at(-1).reason,'stream-ended');
  assert.equal(updates.at(-1).notice,undefined);assert.equal(ctx.namespaceChildren(),0);
  assert.deepEqual(widget.host.dataset,{});
});
