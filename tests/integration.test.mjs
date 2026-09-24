import test from 'node:test';
import assert from 'node:assert/strict';
import { connectWhaleState } from '../src/adapter.js';
import { PetStateMachine } from '../src/state.js';
import { WhaleDiagnostics } from '../src/diagnostics.js';
import { WHALE_VERSION } from '../src/version.js';
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
  const widget = { host: { dataset: {} }, preferences: { scope: 'global' }, feed: [], setCompletionFeed(ready) { this.feed.push(ready); }, update(s) { updates.push(s); machine.update(s); } };
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
test('stream health does not fake disconnection of working and waiting root states', () => {
  const f = wire(); f.handlers.onHealth(false); assert.equal(f.widget.host.dataset.completionFeed, 'unavailable');
  assert.equal(f.machine.view().state, 'working'); f.handlers.onHealth(true);
  assert.equal(f.widget.host.dataset.completionFeed, 'ready'); assert.deepEqual(f.widget.feed, [false, true]); f.control.dispose(); f.handlers.onHealth(false); assert.deepEqual(f.widget.feed, [false, true]);
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
  f.handlers.onReset(); f.handlers.onHealth(true); f.boundary('a', 2, 'turn/end', 'completed'); f.control.publish();
  assert.equal(f.updates.length, length); assert.equal(f.disposed, 1); assert.equal(f.listeners.size, 0);
});

const flush = async () => { for(let i=0;i<100;i++)await Promise.resolve(); };
test('user diagnostics refresh is on-demand, coalesced, aborted and cleaned up on disposal',async()=>{
  const f=wire();let calls=0,signal,resolve;
  f.ctx.remote={whalePet:{diagnostics(s){calls++;signal=s;return new Promise(r=>{resolve=r})}}};
  assert(f.widget.diagnostics instanceof WhaleDiagnostics);assert.equal(f.handlers.diagnostics,f.widget.diagnostics);
  assert.equal(calls,0);const refresh=f.widget.onDiagnosticsRefresh;
  const a=refresh(),b=refresh();await flush();assert.equal(calls,1);
  resolve({ok:true,value:{version:WHALE_VERSION,starts:3,ends:2,completed:1}});await Promise.all([a,b]);
  assert.equal(f.widget.diagnostics.snapshot().host.completed,1);
  const pending=refresh();await flush();assert.equal(calls,2);f.control.dispose();await pending;
  assert(signal.aborted);assert.equal(f.widget.onDiagnosticsRefresh,undefined);
  resolve({ok:true,value:{version:WHALE_VERSION,starts:99,ends:99,completed:99}});await flush();
  assert.equal(f.widget.diagnostics.snapshot().host.status,'unavailable');await refresh();assert.equal(calls,2);
});

test('adapter reuses widget collector and disconnect cancels outstanding host snapshot',async()=>{
  const d=new WhaleDiagnostics(),listeners=new Set();let connected=true,signal;
  const ctx={connection:{state:{getSnapshot:()=>connected?'connected':'disconnected',subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}}},remote:{whalePet:{diagnostics(s){signal=s;return new Promise(()=>{})}}}};
  const widget={diagnostics:d,preferences:{scope:'global'},update(){}};
  const control=connectWhaleState(ctx,widget,()=>({catalog:{phase:'ready',byId:{}},statuses:new Map()}),()=>()=>{});
  assert.equal(widget.diagnostics,d);const pending=widget.onDiagnosticsRefresh();await flush();
  connected=false;for(const fn of listeners)fn();await pending;assert(signal.aborted);assert.equal(d.snapshot().host.status,'unavailable');control.dispose();
});

test('clean EOF clears just-published notice while preserving diagnostic transition trace',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const d=new WhaleDiagnostics(),machine=new PetStateMachine(0),poses=[];
  const widget={diagnostics:d,preferences:{scope:'global'},host:{dataset:{}},update(s){const view=machine.update(s,0);poses.push(view.state);d.setView(view,{scope:'global'})}};
  const state={getSnapshot:()=> 'connected',subscribe:()=>()=>{}};
  const frame=(type,seq)=>({type,hostEpoch:'PRIVATE',streamSeq:seq,sessionId:'PRIVATE',seq,time:seq,...(type==='turn/end'?{reason:'completed'}:{})});
  const ctx={root:{},connection:{state},remote:{$mount:async()=>async()=>{},whalePet:{async *watch(){
    yield {type:'baseline',hostEpoch:'PRIVATE',streamSeq:0,identities:[]};yield frame('turn/start',1);yield frame('turn/end',2);
  }}}};
  const control=connectWhaleState(ctx,widget,()=>({catalog:{phase:'ready',byId:{PRIVATE:{running:false}}},statuses:new Map([['PRIVATE',{running:false}]])}));
  t.after(()=>control.dispose());await flush();
  assert(poses.includes('celebrate'));assert.equal(poses.at(-1),'resting');
  const snapshot=d.snapshot();assert.equal(snapshot.counts.cleanEof,1);assert.equal(snapshot.counts.completed,1);assert.equal(snapshot.ready,false);
  assert(snapshot.trace.some(x=>x.event==='view'&&x.pose==='celebrate'));
  assert(snapshot.trace.some(x=>x.event==='reset'&&x.reason==='stream-ended'));
  assert.equal(snapshot.aggregate.notice,'none');assert(!d.text().includes('PRIVATE'));
});
