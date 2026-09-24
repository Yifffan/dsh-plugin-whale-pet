import test from 'node:test';
import assert from 'node:assert/strict';
import { CELEBRATION_KEYS, PetStateMachine } from '../src/state.js';
import { MESSAGES, translate } from '../src/i18n.js';
const base = { sessionId: 'test', available: true, pending: false };
function finish(machine, id, time = 0, reason = 'completed') {
  machine.update({ ...base, running: true }, time);
  return machine.update({ ...base, running: false, outcome: { id, reason } }, time + 1);
}
test('five distinct completion phrases exist in both languages', () => {
  assert.equal(CELEBRATION_KEYS.length, 5);
  for (const language of ['zh', 'en']) {
    const phrases = CELEBRATION_KEYS.map(key => MESSAGES[language][key]);
    assert.ok(phrases.every(value => typeof value === 'string' && value.length > 0));
    assert.equal(new Set(phrases).size, 5);
  }
  assert.equal(translate('zh', CELEBRATION_KEYS[0]), '刚刚完成了一个任务！');
});
test('each phrase is reachable on the first random draw', () => {
  for (let index = 0; index < CELEBRATION_KEYS.length; index++) {
    const machine = new PetStateMachine(0, 120000, () => (index + 0.5) / CELEBRATION_KEYS.length);
    assert.equal(finish(machine, 1).messageKey, CELEBRATION_KEYS[index]);
  }
});
test('repainting, greeting and duplicate completion do not reroll or extend success', () => {
  let draws = 0;
  const machine = new PetStateMachine(0, 120000, () => { draws++; return 0.5; });
  const first = finish(machine, 1);const until = machine.celebrateUntil;
  for (let time = 2; time < 20; time++) assert.equal(machine.view(time).messageKey, first.messageKey);
  assert.equal(machine.touch(20).messageKey, first.messageKey);
  assert.equal(machine.update({ ...base, running: false, outcome: { id: 1, reason: 'completed' } }, 21).messageKey, first.messageKey);
  assert.equal(draws, 1);assert.equal(machine.celebrateUntil, until);
});
test('new successful tasks never immediately repeat the previous phrase', () => {
  let draws = 0;const machine = new PetStateMachine(0, 120000, () => { draws++; return 0; });
  let previous;
  for (let turn = 0; turn < 30; turn++) {
    const view = finish(machine, turn, turn * 100);
    assert.equal(view.state, 'celebrate');assert.notEqual(view.messageKey, previous);previous = view.messageKey;
  }
  assert.equal(draws, 30);
});
test('every non-previous choice is reachable on subsequent tasks', () => {
  for (let previous = 0; previous < 5; previous++) {
    const selected = new Set();
    for (let next = 0; next < 4; next++) {
      const draws = [(previous + 0.5) / 5, (next + 0.5) / 4];
      const machine = new PetStateMachine(0, 120000, () => draws.shift());
      finish(machine, 1);selected.add(finish(machine, 2, 100).messageKey);
    }
    assert.equal(selected.size, 4);assert.ok(!selected.has(CELEBRATION_KEYS[previous]));
  }
});
test('failures, historical success, reconnect and idle alone never draw a phrase', () => {
  let draws = 0;const random = () => { draws++; return 0; };
  for (const reason of ['aborted', 'error', 'blocked', 'interrupted', 'forked', 'max-tokens', undefined]) {
    const machine = new PetStateMachine(0, 120000, random);
    finish(machine, 1, 0, reason === undefined ? 'unknown' : reason);
    assert.notEqual(machine.view(2).state, 'celebrate');
  }
  const machine = new PetStateMachine(0, 120000, random);
  const historical = { ...base, running: false, outcome: { id: 1, reason: 'completed' } };
  machine.update(historical, 1);machine.update({ ...base, available: false }, 2);machine.update(historical, 3);
  machine.update({ ...base, running: true }, 4);machine.update({ ...base, running: false }, 5);
  assert.equal(draws, 0);
});
test('a live reply celebration survives immediate continuation and a new run id', () => {
  let draws = 0;
  const machine = new PetStateMachine(0, 120000, () => { draws++; return 0; });
  machine.update({ ...base, running: true, workingCount: 1, runId: 'a' }, 0);
  const notice = { id: 'reply-a', reason: 'completed' };
  assert.equal(machine.update({ ...base, running: true, workingCount: 1, runId: 'a', notice }, 1).state, 'celebrate');
  const until = machine.noticeUntil;
  for (const [time, running, runId] of [[2, true, 'b'], [3, false, 'b'], [4, true, 'c']]) {
    assert.equal(machine.update({ ...base, running, workingCount: 1, runId, notice }, time).state, 'celebrate');
    assert.equal(machine.noticeUntil, until);
  }
  assert.equal(draws, 1);
  assert.equal(machine.view(until + 1).state, 'working');
  assert.equal(machine.view(until + 1).workingCount, 1);
  assert.equal(machine.update({ ...base, running: true, workingCount: 1, runId: 'c', notice: { id: 'reply-c', reason: 'completed' } }, until + 2).state, 'celebrate');
  assert.equal(draws, 2);
});
test('locale changes translate the same completion key without drawing again', () => {
  let draws = 0;const machine = new PetStateMachine(0, 120000, () => { draws++; return 0; });
  const view = finish(machine, 1);
  assert.equal(translate('zh', view.messageKey), '刚刚完成了一个任务！');
  assert.equal(translate('en', view.messageKey), 'Just finished a task!');
  assert.equal(machine.view(2).messageKey, view.messageKey);assert.equal(draws, 1);
});
