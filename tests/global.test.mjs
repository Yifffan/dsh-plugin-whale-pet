import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionAggregate } from '../src/global-state.js';
import { PetStateMachine, cleanPreferences } from '../src/state.js';

function setup(rows = { a: true, b: false }) {
  let time = 0;
  const catalog = { phase: 'ready', byId: {} }, statuses = new Map();
  for (const [id, running] of Object.entries(rows)) {
    catalog.byId[id] = { id, running, retainedBy: id === 'a' ? { mainView: 1 } : {} };
    statuses.set(id, { running });
  }
  const aggregate = new SessionAggregate(() => time);
  const machine = new PetStateMachine(0, 30000, () => 0, () => 0);
  let input = { catalog, statuses, connected: true, scope: 'global', currentSessionId: 'a' };
  const push = changes => { input = { ...input, ...changes }; return machine.update(aggregate.update(input), time); };
  const boundary = (id, seq, type, reason, extra = {}) => machine.update(aggregate.boundary({ sessionId: id, id: `${id}:${seq}`, seq, type, reason, ...extra }), time);
  const running = (id, value, pending = false) => { catalog.byId[id].running = value; statuses.set(id, { running: value, ...(pending ? { pendingInteraction: { id: 'ask' } } : {}) }); return push(); };
  push();
  return { aggregate, machine, catalog, statuses, push, boundary, running, tick(value) { time = value; }, view() { return machine.view(time); } };
}
test('global count stays working when the selected main view changes to an idle session', () => {
  const f = setup(); assert.equal(f.view().workingCount, 1);
  assert.equal(f.push({ currentSessionId: 'b' }).state, 'working');
  assert.equal(f.view().workingCount, 1);
});
test('only regular sessions count; parentId alone does not exclude a fork', () => {
  const f = setup({ a: true, fork: true, child: true });
  f.catalog.byId.fork.parentId = 'a'; f.catalog.byId.child.origin = 'subagent'; f.catalog.byId.child.parentId = 'a';
  assert.equal(f.push().workingCount, 2);
});
test('five subagents still count as just one working parent', () => {
  const f = setup({ a: true, c1: true, c2: true, c3: true, c4: true, c5: true });
  for (const id of ['c1','c2','c3','c4','c5']) f.catalog.byId[id].origin = 'subagent';
  assert.equal(f.push().workingCount, 1);
});
test('waiting dominates and is excluded from the work count', () => {
  const f = setup({ a: true, b: true }); f.running('b', true, true);
  const snapshot = f.aggregate.snapshot(); assert.equal(snapshot.workingCount, 1); assert.equal(snapshot.waitingCount, 1);
  assert.equal(f.view().state, 'waiting'); assert.equal(f.view().workingCount, 0);
  assert.equal(f.running('b', true).workingCount, 2);
});
test('real pending before catalog arrives and child pending are never silently lost', () => {
  const f = setup({ a: false }); f.statuses.set('unknown', { pendingInteraction: {} });
  assert.equal(f.push().state, 'waiting');
  f.catalog.byId.unknown = { id: 'unknown', origin: 'subagent' };
  assert.equal(f.push().state, 'waiting');
  f.statuses.delete('unknown'); assert.equal(f.push().state, 'resting');
});
test('A completes while B works: brief celebration then working count one', () => {
  const f = setup({ a: true, b: true }); f.tick(10); f.boundary('a', 1, 'turn/start');
  f.tick(20); assert.equal(f.boundary('a', 2, 'turn/end', 'completed').state, 'celebrate');
  assert.equal(f.aggregate.snapshot().workingCount, 2); // Neither driver must be idle yet.
  f.tick(30); assert.equal(f.running('a', false).state, 'celebrate');
  f.tick(4221); assert.equal(f.view().state, 'working'); assert.equal(f.view().workingCount, 1);
});
test('last normal completion celebrates then rests and sleeps', () => {
  const f = setup(); f.tick(10); f.running('a', false);
  assert.equal(f.boundary('a', 2, 'turn/end', 'completed').state, 'celebrate');
  f.tick(4211); assert.equal(f.view().state, 'resting');
  f.tick(34211); assert.equal(f.view().state, 'sleeping');
});
for (const reason of ['aborted','cancelled','interrupted','blocked','max-tokens',undefined]) {
  test(`${reason} never causes a success or error notice`, () => {
    const f = setup(); f.running('a', false); f.boundary('a', 2, 'turn/end', reason);
    assert.equal(f.view().state, 'resting'); assert.equal(f.view().noticeKey, undefined);
  });
}
test('D terminal error interrupts work briefly, never claims other sessions stopped', () => {
  const f = setup({ a: true, d: true }); f.tick(10); f.running('d', false);
  assert.equal(f.boundary('d', 2, 'turn/end', 'error').state, 'error');
  f.tick(4211); assert.equal(f.view().state, 'working'); assert.equal(f.view().workingCount, 1);
});
test('waiting pose survives completion/error; bubble can report the transient notice', () => {
  const f = setup({ a: true, b: true }); f.running('b', true, true); f.running('a', false);
  const view = f.boundary('a', 2, 'turn/end', 'error');
  assert.equal(view.state, 'waiting'); assert.equal(view.noticeKey, 'state.error');
  f.tick(4201); assert.equal(f.view().noticeKey, undefined); assert.equal(f.view().state, 'waiting');
});
test('an active error is not overridden by another session success', () => {
  const f = setup({ a: true, b: true }); f.running('a', false); f.boundary('a', 2, 'turn/end', 'error');
  f.running('b', false); f.boundary('b', 2, 'turn/end', 'completed'); assert.equal(f.view().state, 'error');
});
test('tool/message events and invalid sequences cannot produce terminal states', () => {
  const f = setup(); f.running('a', false);
  for (const seq of [NaN,Infinity,-Infinity,'2']) f.boundary('a', seq, 'turn/end', 'completed');
  f.boundary('a', 3, 'tool/result', 'error'); assert.equal(f.view().state, 'resting');
});
test('completed reply celebrates immediately while its driver stays running, including the next start', () => {
  const f = setup(); f.boundary('a', 1, 'turn/start');
  assert.equal(f.boundary('a', 2, 'turn/end', 'completed').state, 'celebrate');
  const notice = f.aggregate.snapshot().notice;
  f.tick(1); assert.equal(f.boundary('a', 3, 'turn/start').state, 'celebrate');
  assert.equal(f.aggregate.snapshot().notice, notice);
  f.tick(4100); assert.equal(f.push().state, 'celebrate');
  f.tick(4201); assert.equal(f.push().state, 'working'); assert.equal(f.view().workingCount, 1);
  f.tick(4300); assert.equal(f.running('a', false).state, 'resting');
});
test('another distinct completed reply can celebrate again without driver idle', () => {
  const f = setup(); f.boundary('a', 1, 'turn/start'); f.boundary('a', 2, 'turn/end', 'completed');
  const first = f.aggregate.snapshot().notice;
  f.tick(1000); f.boundary('a', 3, 'turn/start');
  f.tick(1100); assert.equal(f.boundary('a', 4, 'turn/end', 'completed').state, 'celebrate');
  assert.notEqual(f.aggregate.snapshot().notice.id, first.id);
  assert.equal(f.aggregate.snapshot().notice.at, 1100);
  f.tick(4201); assert.equal(f.view().state, 'celebrate');
  f.tick(5301); assert.equal(f.view().state, 'working');
});
test('start/end for a very short task works even when running=true was coalesced', () => {
  const f = setup({ a: false }); f.boundary('a', 1, 'turn/start');
  assert.equal(f.boundary('a', 2, 'turn/end', 'completed').state, 'celebrate');
});
test('falling running without an observed terminal boundary never celebrates', () => {
  const f = setup(); assert.equal(f.running('a', false).state, 'resting');
});
test('duplicate or older event does not replay or extend a notice', () => {
  const f = setup(); f.running('a', false); f.boundary('a', 5, 'turn/end', 'completed');
  f.tick(4100); f.boundary('a', 5, 'turn/end', 'completed'); f.boundary('a', 4, 'turn/start');
  f.tick(4201); assert.equal(f.view().state, 'resting');
});
test('equal sequence numbers in different sessions are independent', () => {
  const f = setup({ a: true, b: true }); f.running('a', false); f.boundary('a', 2, 'turn/end', 'completed');
  f.tick(5000); f.running('b', false); assert.equal(f.boundary('b', 2, 'turn/end', 'completed').state, 'celebrate');
});
test('child terminal boundaries do not produce additional success notices', () => {
  const f = setup({ a: true, child: true }); f.catalog.byId.child.origin = 'subagent'; f.push();
  f.running('child', false); assert.equal(f.boundary('child', 2, 'turn/end', 'completed').state, 'working');
});
test('completed notice expires and is not replayed when the driver eventually idles', () => {
  const f = setup(); f.boundary('a', 2, 'turn/end', 'completed');
  f.tick(10001); assert.equal(f.running('a', false).state, 'resting');
});
test('disconnect clears live candidates; reconnect does not replay history', () => {
  const f = setup(); f.boundary('a', 2, 'turn/end', 'completed');
  assert.equal(f.push({ connected: false }).available, false); f.running('a', false);
  assert.equal(f.push({ connected: true }).state, 'resting');
  f.boundary('a', 2, 'turn/end', 'completed'); assert.equal(f.view().state, 'resting');
});
test('scope changes isolate current mode without replaying a global notice', () => {
  const f = setup(); assert.equal(f.push({ scope: 'current', currentSessionId: 'b' }).state, 'resting');
  f.boundary('a', 2, 'turn/end', 'completed'); assert.equal(f.view().state, 'resting');
  assert.equal(f.push({ scope: 'global' }).state, 'working');
});
test('stream reset clears notices but preserves uninterrupted work phrase', () => {
  const f = setup({ a: true, b: true }); const key = f.view().messageKey;
  f.aggregate.reset(); f.push(); assert.equal(f.view().messageKey, key);
});
test('removing a session clears its published completion notice', () => {
  const f = setup(); f.boundary('a', 2, 'turn/end', 'completed');
  delete f.catalog.byId.a; f.statuses.delete('a'); assert.equal(f.push().state, 'resting');
});
test('empty ready list is valid idle; empty loading list and missing current selection are unknown', () => {
  const f = setup({}); assert.equal(f.view().available, true);
  f.catalog.phase = 'pending'; assert.equal(f.push().available, false);
  f.catalog.phase = 'ready'; assert.equal(f.push({ scope: 'current', currentSessionId: undefined }).available, false);
});
test('work count changes and waiting/resume do not reroll one busy-period phrase', () => {
  const f = setup(); const key = f.view().messageKey; f.running('b', true);
  assert.equal(f.view().messageKey, key); f.running('a', true, true); f.running('b', true, true);
  f.running('a', true); f.running('b', true); assert.equal(f.view().messageKey, key);
});
test('Host baseline ownership excludes children even before catalog origin is known', () => {
  const f = setup({ a: true, child: true });
  f.aggregate.reset([{ sessionId: 'a', isSubagent: false }, { sessionId: 'child', isSubagent: true }]);
  assert.equal(f.push().workingCount, 1);
});
test('negative event sequence is ignored', () => {
  const f = setup({ a: false }); f.boundary('a', -5, 'turn/start');
  assert.equal(f.boundary('a', 2, 'turn/end', 'completed').state, 'resting');
});
test('new preferences default to global; invalid scope is safely normalized', () => {
  assert.equal(cleanPreferences({}).scope, 'global'); assert.equal(cleanPreferences({ scope: 'current' }).scope, 'current');
  assert.equal(cleanPreferences({ scope: 'other-host' }).scope, 'global');
});
