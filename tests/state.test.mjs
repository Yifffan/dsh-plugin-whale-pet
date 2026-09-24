import test from 'node:test';
import assert from 'node:assert/strict';
import { PetStateMachine, cleanPreferences, clampPosition } from '../src/state.js';
const base = { sessionId: 'a', available: true, running: false, pending: false };
function machine() { const m = new PetStateMachine(0, 30000); m.update(base, 0); return m; }

test('idle → working → waiting (priority) → working → completed → rest → sleep', () => {
  const m = machine();
  assert.equal(m.view(0).state, 'resting');
  assert.equal(m.update({ ...base, running: true }, 100).state, 'working');
  assert.equal(m.update({ ...base, running: true, pending: true }, 200).state, 'waiting');
  assert.equal(m.update({ ...base, running: true }, 300).state, 'working');
  assert.equal(m.update({ ...base, outcome: { id: 1, reason: 'completed' } }, 500).state, 'celebrate');
  assert.equal(m.view(4701).state, 'resting');
  assert.equal(m.view(34701).state, 'sleeping');
});
for (const reason of ['aborted', 'error', 'blocked', 'max-tokens', 'interrupted', 'forked', undefined]) {
  test(`${reason} ending never celebrates`, () => {
    const m = machine(); m.update({ ...base, running: true }, 100);
    assert.equal(m.update({ ...base, outcome: { id: 1, reason } }, 200).state, 'resting');
  });
}
test('running false alone cannot mean success', () => {
  const m = machine(); m.update({ ...base, running: true }, 100);
  assert.equal(m.update(base, 200).state, 'resting');
});
test('history on first mount and session switch never celebrates', () => {
  const m = new PetStateMachine(0); const ended = { ...base, outcome: { id: 4, reason: 'completed' } };
  assert.equal(m.update(ended, 0).state, 'resting');
  m.update({ ...base, running: true }, 100);
  assert.equal(m.update({ ...ended, sessionId: 'b' }, 200).state, 'resting');
});
test('reconnect baselines completion without false celebration', () => {
  const m = machine(); m.update({ ...base, running: true }, 100);
  m.update({ ...base, available: false }, 200);
  assert.equal(m.update({ ...base, outcome: { id: 1, reason: 'completed' } }, 300).state, 'resting');
});
test('duplicate completion does not extend celebration', () => {
  const m = machine(); m.update({ ...base, running: true }, 100);
  const done = { ...base, outcome: { id: 1, reason: 'completed' } };
  m.update(done, 200); m.update(done, 4000);
  assert.equal(m.view(4401).state, 'resting');
});
test('busy and waiting never fall asleep', () => {
  const m = machine(); m.update({ ...base, pending: true }, 100);
  assert.equal(m.view(9999999).state, 'waiting');
  m.update({ ...base, running: true }, 200);
  assert.equal(m.view(9999999).state, 'working');
});
test('petting wakes sleep without overriding real work', () => {
  const m = machine(); assert.equal(m.view(31000).state, 'sleeping');
  assert.equal(m.touch(32000).state, 'resting');
  m.update({ ...base, running: true }, 33000);
  assert.equal(m.touch(34000).state, 'working');
});
test('degraded mode is quiet, not false working or success', () => {
  const m = machine(); m.update({ ...base, running: true }, 100);
  assert.equal(m.update({ ...base, available: false, pending: true, running: true }, 200).state, 'resting');
  assert.equal(m.view(999999).state, 'resting');
});
test('new turn cancels the previous success animation', () => {
  const m = machine(); m.update({ ...base, running: true }, 100);
  m.update({ ...base, outcome: { id: 1, reason: 'completed' } }, 200);
  m.update({ ...base, running: true, outcome: { id: 1, reason: 'completed' } }, 300);
  assert.equal(m.update({ ...base, outcome: { id: 1, reason: 'completed' } }, 400).state, 'resting');
});
test('preferences are bounded and tolerate corrupt stored values', () => {
  assert.deepEqual(cleanPreferences(null), cleanPreferences({}));
  assert.equal(cleanPreferences({ scale: 90 }).scale, 1.6);
  assert.equal(cleanPreferences({ scale: 0 }).scale, .65);
  assert.equal(cleanPreferences({ scale: NaN }).scale, 1);
  assert.equal(cleanPreferences({ x: Infinity, y: '4' }).x, null);
  assert.equal(cleanPreferences({ sleepAfterMs: 10 }).sleepAfterMs, 120000);
  assert.equal(cleanPreferences({ hidden: 'yes' }).hidden, false);
});
test('drag position remains reachable on normal and tiny windows', () => {
  assert.deepEqual(clampPosition(-30, -40, 156, 156, 800, 600), { x: 12, y: 56 });
  assert.deepEqual(clampPosition(9999, 9999, 156, 156, 800, 600), { x: 632, y: 432 });
  assert.deepEqual(clampPosition(9999, 9999, 249, 249, 220, 200), { x: 12, y: 12 });
});
