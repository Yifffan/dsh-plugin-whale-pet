import test from 'node:test';
import assert from 'node:assert/strict';
import { connectWhaleState } from '../src/adapter.js';
import { PetStateMachine } from '../src/state.js';
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
