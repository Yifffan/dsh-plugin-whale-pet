import test from 'node:test';
import assert from 'node:assert/strict';
import { PetStateMachine, WORKING_KEYS, WORKING_HINT_CHANCE } from '../src/state.js';
import { MESSAGES, translate } from '../src/i18n.js';
const base = { sessionId: 'test', available: true, running: true, pending: false };
function make(random) { return new PetStateMachine(0, 120000, () => 0, random); }
test('six distinct working phrases include a localized right-click hint', () => {
  assert.equal(WORKING_KEYS.length, 6);
  assert.ok(WORKING_KEYS.includes('working.settings'));
  assert.match(translate('zh', 'working.settings'), /右键/);
  assert.match(translate('en', 'working.settings'), /right-click/);
  for (const language of ['zh', 'en']) {
    const phrases = WORKING_KEYS.map(key => MESSAGES[language][key]);
    assert.ok(phrases.every(value => typeof value === 'string' && value.length > 0));
    assert.equal(new Set(phrases).size, WORKING_KEYS.length);
  }
});
test('all working phrases are reachable on first start', () => {
  for (let index = 0; index < WORKING_KEYS.length; index++) {
    const draw = WORKING_KEYS[index] === 'working.settings' ? 0.99 : (index + 0.5) / (WORKING_KEYS.length - 1) * (1 - WORKING_HINT_CHANCE);
    assert.equal(make(() => draw).update(base, 0).messageKey, WORKING_KEYS[index]);
  }
});
test('settings hint has a 2% chance even when a previous regular phrase is excluded', () => {
  assert.equal(WORKING_HINT_CHANCE, 0.02);
  const hint = WORKING_KEYS.indexOf('working.settings'), samples = 5000;
  for (const previous of [-1, ...WORKING_KEYS.map((_, index) => index)]) {
    const counts = Array(WORKING_KEYS.length).fill(0);
    for (let n = 0; n < samples; n++) {
      const machine = make(() => (n + 0.5) / samples);
      machine.workingIndex = previous;
      const view = machine.update(base, 0);
      counts[WORKING_KEYS.indexOf(view.messageKey)]++;
    }
    assert.equal(counts[hint], previous === hint ? 0 : samples * WORKING_HINT_CHANCE);
    if (previous >= 0) assert.equal(counts[previous], 0);
    const regular = counts.filter((_, index) => index !== hint && index !== previous);
    assert.ok(regular.every(count => count === regular[0]), 'remaining ordinary phrases share the probability evenly');
  }
});
test('rare hint threshold and out-of-range random inputs stay safe', () => {
  assert.notEqual(make(() => 0.979999).update(base, 0).messageKey, 'working.settings');
  assert.equal(make(() => 0.98).update(base, 0).messageKey, 'working.settings');
  for (const draw of [NaN, undefined, -1, 1, Infinity, -Infinity]) {
    assert.ok(WORKING_KEYS.includes(make(() => draw).update(base, 0).messageKey));
  }
});
test('right-click hint is stable for one busy period, yields to waiting, and does not immediately repeat', () => {
  let draws = 0; const machine = make(() => { draws++; return 0.99; });
  assert.equal(machine.update(base, 0).messageKey, 'working.settings');
  assert.equal(machine.view(1000).messageKey, 'working.settings');
  assert.equal(machine.update({ ...base, pending: true }, 1001).state, 'waiting');
  assert.equal(machine.update(base, 1002).messageKey, 'working.settings');
  assert.equal(draws, 1);
  assert.equal(machine.update({ ...base, running: false }, 1003).state, 'resting');
  assert.notEqual(machine.update(base, 1004).messageKey, 'working.settings');
  assert.equal(draws, 2);
});
test('working phrase survives ticks, approval and internal turn boundaries', () => {
  let draws = 0;const machine = make(() => { draws++; return 0; });
  const first = machine.update(base, 0).messageKey;
  for (let time = 1; time < 5; time++) assert.equal(machine.view(time).messageKey, first);
  assert.equal(machine.update({ ...base, pending: true }, 5).state, 'waiting');
  assert.equal(machine.update({ ...base, pending: false }, 6).messageKey, first);
  assert.equal(machine.update({ ...base, runId: 'run-1' }, 7).messageKey, first);
  assert.equal(machine.update({ ...base, runId: 'run-1', outcome: { id: 'end-1', reason: 'completed' } }, 8).messageKey, first);
  assert.equal(machine.update({ ...base, runId: 'run-2' }, 9).messageKey, first);
  assert.equal(draws, 1);
});
test('next busy period chooses a different phrase without changing completion selection', () => {
  let draws = 0;const machine = make(() => { draws++; return 0; });
  const first = machine.update(base, 0).messageKey;
  assert.equal(machine.update({ ...base, running: false, outcome: { id: 1, reason: 'completed' } }, 1).state, 'celebrate');
  const second = machine.update(base, 2).messageKey;
  assert.notEqual(second, first);assert.equal(draws, 2);
});
test('unknown and idle states do not choose working phrases', () => {
  let draws = 0;const machine = make(() => { draws++; return 0; });
  machine.update({ ...base, available: false }, 0);
  machine.update({ ...base, running: false }, 1);
  assert.equal(draws, 0);
  assert.equal(machine.update(base, 2).state, 'working');assert.equal(draws, 1);
});
test('new selected session and reconnect initialize their own busy display', () => {
  let draws = 0;const machine = make(() => { draws++; return 0; });
  machine.update(base, 0);
  machine.update({ ...base, sessionId: 'other' }, 1);
  machine.update({ ...base, sessionId: 'other', available: false }, 2);
  machine.update({ ...base, sessionId: 'other' }, 3);
  assert.equal(draws, 3);
});
test('language changes translate the same working key without rerolling', () => {
  let draws = 0;const machine = make(() => { draws++; return 0.3; });
  const view = machine.update(base, 0);
  assert.equal(translate('zh', view.messageKey), '小鲸鱼开工啦！');
  assert.equal(translate('en', view.messageKey), 'Little whale on the job!');
  assert.equal(machine.view(1).messageKey, view.messageKey);assert.equal(draws, 1);
});
