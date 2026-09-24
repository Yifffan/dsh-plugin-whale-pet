import test from 'node:test';
import assert from 'node:assert/strict';
import { observeSession, selectedSessionId } from '../src/adapter.js';
import { PetStateMachine } from '../src/state.js';
const entry = (seq, type = 'turn/end', reason = 'completed') => ({ type: 'event', event: { seq, type, data: { turn: 1, reason: { kind: reason } } } });
function fixture(initialEntries = []) {
  let snapshot = { entries: initialEntries, revision: 0, change: { kind: 'replace', entries: initialEntries } };
  let state = { openState: 'open', removed: false }, releases = 0, failRead = false;
  const events = new Set(), states = new Set(), callbacks = [], health = [], resets = [];
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const session = {
    eventSource: { getSnapshot: () => { if (failRead) throw Error('transient test fault'); return snapshot; }, subscribe: cb => { events.add(cb); return () => events.delete(cb); } },
    getSnapshot: () => state, subscribe: cb => { states.add(cb); return () => states.delete(cb); },
  };
  const sessions = { retain(id, options) { assert.equal(id, 's'); assert.equal(options.source, 'whalePet'); return { binding: { session }, ready, release: () => releases++ }; } };
  const stop = observeSession(sessions, 's', { onBoundary: x => callbacks.push(x), onHealth: x => health.push(x), onReset: () => resets.push(1) });
  return {
    stop, callbacks, health, resets, events, states,
    get releases() { return releases; },
    publish(kind, entries) { snapshot = { entries, revision: snapshot.revision + 1, change: { kind, entries } }; for (const cb of events) cb(); },
    state(value) { state = value; for (const cb of states) cb(); },
    fail(value) { failRead = value; }, readyResolve, readyReject,
  };
}
test('main session selector ignores background running and our own reference', () => {
  assert.equal(selectedSessionId({ byId: { a: { id: 'a', running: true, retainedBy: { whalePet: 1 } }, b: { id: 'b', retainedBy: { mainView: 1 } } } }), 'b');
  assert.equal(selectedSessionId({}), undefined);
});
test('baseline/prepend/replace never replay completed history', () => {
  const f = fixture([entry(10)]); assert.deepEqual(f.callbacks, []);
  f.publish('prepend', [entry(3)]); f.publish('replace', [entry(20)]); f.publish('append', [entry(19)]);
  assert.deepEqual(f.callbacks, []); assert.equal(f.resets.length, 1);
  f.publish('append', [entry(21)]); assert.deepEqual(f.callbacks, [{ sessionId: 's', id: 's:21', type: 'turn/end', reason: 'completed' }]);
  f.stop();
});
test('only durable turn boundaries enter pet state, with duplicate suppression', () => {
  const f = fixture();
  f.publish('append', [{ type: 'transient', event: { seq: 1, type: 'assistant/chunk' } }]);
  f.publish('append', [entry(1, 'turn/start'), entry(2, 'assistant/message'), entry(3, 'turn/end', 'aborted')]);
  f.publish('append', [entry(3)]);
  assert.equal(f.callbacks.length, 2); assert.equal(f.callbacks[0].type, 'turn/start'); assert.equal(f.callbacks[1].reason, 'aborted'); f.stop();
});
test('health tracks loading, error, removal and recovered source read faults', () => {
  const f = fixture(); assert.deepEqual(f.health, [true]);
  f.state({ openState: 'loading' }); f.state({ openState: 'open' });
  f.fail(true); f.publish('append', [entry(1)]); f.fail(false); f.publish('replace', [entry(1)]);
  assert.deepEqual(f.health, [true, false, true, false, true]);
  f.state({ openState: 'open', removed: true }); assert.equal(f.health.at(-1), false); f.stop();
});
test('cleanup releases exactly once and ignores late ready resolution', async () => {
  const f = fixture(); f.stop(); f.stop(); f.readyResolve(); await Promise.resolve();
  f.publish('append', [entry(1)]);
  assert.equal(f.releases, 1); assert.equal(f.events.size, 0); assert.equal(f.states.size, 0); assert.equal(f.callbacks.length, 0); assert.deepEqual(f.health, [true]);
});
test('ready rejection degrades without an unhandled promise', async () => {
  const f = fixture(); f.readyReject(Error('closed')); await Promise.resolve(); assert.equal(f.health.at(-1), false);
  f.state({ openState: 'open' }); assert.equal(f.health.at(-1), true); f.stop();
});
test('bad API releases reference when observation cannot be established', () => {
  let releases = 0;
  assert.throws(() => observeSession({ retain: () => ({ binding: { session: {} }, release() { releases++; } }) }, 's', { onBoundary() {} }), /Unsupported/);
  assert.equal(releases, 1);
});
const base = { sessionId: 's', available: true, running: false, pending: false };
test('end before root idle keeps working until root reports idle', () => {
  const m = new PetStateMachine(0); m.update(base, 0); m.update({ ...base, running: true, runId: 's:1' }, 10);
  const done = { ...base, runId: 's:1', outcome: { id: 's:2', reason: 'completed' } };
  assert.equal(m.update({ ...done, running: true }, 20).state, 'working');
  assert.equal(m.update({ ...done, running: true }, 30).state, 'working');
  assert.equal(m.update(done, 40).state, 'celebrate');
});
test('root idle before end still celebrates the observed turn', () => {
  const m = new PetStateMachine(0); m.update(base, 0); m.update({ ...base, running: true, runId: 's:1' }, 10);
  m.update({ ...base, runId: 's:1' }, 20);
  assert.equal(m.update({ ...base, runId: 's:1', outcome: { id: 's:2', reason: 'completed' } }, 30).state, 'celebrate');
});
test('consecutive turns with continuously running driver clear old success', () => {
  const m = new PetStateMachine(0); m.update(base, 0); m.update({ ...base, running: true, runId: 's:1' }, 10);
  m.update({ ...base, running: true, runId: 's:1', outcome: { id: 's:2', reason: 'completed' } }, 20);
  m.update({ ...base, running: true, runId: 's:3' }, 30);
  assert.equal(m.update({ ...base, runId: 's:3' }, 40).state, 'resting');
  assert.equal(m.update({ ...base, runId: 's:3', outcome: { id: 's:4', reason: 'completed' } }, 50).state, 'celebrate');
});
test('fast explicit start is observed even if root running edge was coalesced', () => {
  const m = new PetStateMachine(0); m.update(base, 0); m.update({ ...base, runId: 's:1' }, 10);
  assert.equal(m.update({ ...base, runId: 's:1', outcome: { id: 's:2', reason: 'completed' } }, 20).state, 'celebrate');
});
