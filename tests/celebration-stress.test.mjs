import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionAggregate } from '../src/global-state.js';
import { PetStateMachine } from '../src/state.js';

// Deterministic virtual clocks and controlled root projections: no real timers,
// transcript access, running DSH connection or changes to the delivered package.
function fixture(ids = ['a', 'b'], scope = 'global') {
  let clock = 100000, draws = 0;
  const catalog = { phase: 'ready', byId: Object.fromEntries(ids.map(id => [id, { id }])) };
  const statuses = new Map(ids.map(id => [id, { running: true }]));
  let input = { catalog, statuses, connected: true, scope, currentSessionId: ids[0] };
  const aggregate = new SessionAggregate(() => clock);
  const machine = new PetStateMachine(clock, 120000, () => { draws++; return .17; }, () => .3);
  const trace = [];
  let view;
  const accept = (snapshot, label) => {
    view = machine.update(snapshot, clock);
    trace.push({ at: clock, label, state: view.state, notice: snapshot.notice?.id, count: snapshot.workingCount });
    return view;
  };
  const publish = (changes = {}) => {
    input = { ...input, ...changes };
    return accept(aggregate.update(input), 'projection');
  };
  publish();
  return {
    catalog, statuses, aggregate, machine, trace, publish,
    get clock() { return clock; }, get draws() { return draws; }, get view() { return view; },
    context(label) { return `${label}\n${JSON.stringify(trace.slice(-10))}`; },
    at(value) { assert.ok(value >= clock, 'test clocks are monotonic'); clock = value; return publish(); },
    step(delta = 1) { clock += delta; },
    status(id, value) { statuses.set(id, value); return publish(); },
    emit(event) {
      // Match connectWhaleState: publish current root stores before each boundary.
      publish();
      return accept(aggregate.boundary({ id: `${event.sessionId}:${event.seq}`, ...event }), `${event.sessionId}:${event.seq}:${event.type}:${event.reason || ''}`);
    },
    reset(identities = []) { aggregate.reset(identities); return publish(); },
  };
}
const boundary = (sessionId, seq, type, reason, extra = {}) => ({ sessionId, seq, type, reason, ...extra });
function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
}
function permutations(items) {
  return items.length ? items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest])) : [[]];
}

// 48 schedules, 3,264 boundary deliveries, 768 distinct successful replies.
// Each schedule preserves ordering within a session, but interleaves sessions.
for (const count of [1, 3, 8]) {
  test(`stress: 16 seeded reply schedules across ${count} continuously running main session(s)`, () => {
    for (let seed = 1; seed <= 16; seed++) {
      const random = rng(seed), ids = Array.from({ length: count }, (_, i) => `main-${i}`), f = fixture(ids);
      const streams = ids.map(id => {
        const events = [boundary(id, 1, 'turn/start')];
        for (let round = 1; round <= 4; round++) {
          events.push(boundary(id, round * 2, 'turn/end', 'completed'));
          events.push(boundary(id, round * 2 + 1, 'turn/start'));
          events.push(boundary(id, round * 2, 'turn/end', 'completed')); // Duplicate after continuation.
          events.push(boundary(id, round * 2 - 1, 'turn/start')); // Older boundary after newer start.
        }
        return events;
      });
      const highest = new Map();
      let latest, successes = 0;
      while (streams.some(events => events.length)) {
        const available = streams.map((events, index) => events.length ? index : -1).filter(index => index >= 0);
        const event = streams[available[random() % available.length]].shift();
        f.step(1 + random() % 31);
        const fresh = event.seq > (highest.get(event.sessionId) ?? -1);
        if (fresh) highest.set(event.sessionId, event.seq);
        if (fresh && event.type === 'turn/end') {
          latest = { id: `${event.sessionId}:${event.seq}`, at: f.clock };
          successes++;
        }
        const view = f.emit(event), active = latest && f.clock < latest.at + 4200;
        const context = f.context(`seed=${seed}, count=${count}`);
        assert.equal(view.state, active ? 'celebrate' : 'working', context);
        assert.equal(f.aggregate.snapshot().workingCount, count, context);
        assert.equal(f.draws, successes, context);
        if (active) {
          assert.equal(f.aggregate.snapshot().notice.id, latest.id, context);
          assert.equal(f.machine.noticeUntil, latest.at + 4200, context);
          assert.equal(view.workingCount, 0, context);
        }
      }
      const deadline = latest.at + 4200;
      assert.equal(f.at(deadline - 1).state, 'celebrate');
      for (const id of ids) f.emit(boundary(id, highest.get(id) - 1, 'turn/end', 'completed'));
      assert.equal(f.machine.noticeUntil, deadline, 'late duplicate floods do not extend the window');
      assert.equal(f.at(deadline).state, 'working', 'expiry is exact, not one additional tick');
      assert.equal(f.view.workingCount, count);
      for (const id of ids) f.emit(boundary(id, 0, 'turn/start'));
      assert.equal(f.draws, count * 4);
      assert.equal(f.view.state, 'working');
      assert.equal(f.aggregate.snapshot().notice, undefined);
    }
  });
}

test('stress: permutations of waiting, pending error settlement and another success preserve priority without queuing', () => {
  for (const order of permutations(['success', 'errorIdle', 'waiting'])) {
    const f = fixture(['a', 'b', 'c']);
    f.emit(boundary('a', 1, 'turn/start'));
    f.emit(boundary('a', 2, 'turn/end', 'error'));
    assert.equal(f.view.state, 'working', 'errors still wait for idle');
    for (const action of order) {
      f.step(17);
      if (action === 'success') f.emit(boundary('b', 1, 'turn/end', 'completed'));
      if (action === 'errorIdle') f.status('a', { running: false });
      if (action === 'waiting') f.status('c', { running: true, pendingInteraction: { id: 'approval' } });
    }
    const context = f.context(order.join(' -> ')), error = f.aggregate.snapshot().notice;
    assert.equal(error.reason, 'error', context);
    assert.equal(f.view.state, 'waiting', context);
    assert.equal(f.view.noticeKey, 'state.error', context);
    f.step(100);f.status('c', { running: true });
    assert.equal(f.view.state, 'error', context);
    assert.equal(f.at(error.at + 4199).state, 'error');
    assert.equal(f.at(error.at + 4200).state, 'working');
    assert.equal(f.view.workingCount, 2);
    assert.equal(f.view.noticeKey, undefined, 'overridden/suppressed success is not a delayed queue');
    f.emit(boundary('b', 3, 'turn/start'));f.emit(boundary('b', 4, 'turn/end', 'completed'));
    assert.equal(f.view.state, 'celebrate', 'a genuinely new success is eligible after the error window');
  }
});

test('stress: success hidden under waiting expires instead of replaying when approval clears', () => {
  for (const clearAfter of [4199, 4200, 4201, 20000]) {
    const f = fixture(['a', 'b']);
    f.status('b', { running: true, pendingInteraction: {} });
    f.emit(boundary('a', 1, 'turn/end', 'completed'));
    const at = f.clock;
    assert.equal(f.view.state, 'waiting');assert.ok(f.view.noticeKey);
    f.at(at + clearAfter);f.status('b', { running: true });
    assert.equal(f.view.state, clearAfter < 4200 ? 'celebrate' : 'working');
    assert.equal(f.draws, 1);
    assert.equal(f.at(at + 25000).state, 'working');
  }
});

test('stress: cancellation targets only its own latest success and never resurrects an older success', () => {
  for (const order of permutations(['aDone', 'bDone', 'aCancel']).filter(order => order.indexOf('aDone') < order.indexOf('aCancel'))) {
    const f = fixture();let expected;
    for (const action of order) {
      f.step(20);
      if (action === 'aDone') { f.emit(boundary('a', 1, 'turn/end', 'completed')); expected = 'a'; }
      if (action === 'bDone') { f.emit(boundary('b', 1, 'turn/end', 'completed')); expected = 'b'; }
      if (action === 'aCancel') {
        const before = f.draws, deadline = f.machine.noticeUntil;
        f.emit(boundary('a', 2, 'turn/end', 'aborted'));
        f.status('a', { running: false });
        if (expected === 'a') expected = undefined;
        assert.equal(f.draws, before, 'cancellation cannot draw a success phrase');
        assert.ok(f.machine.noticeUntil <= deadline, 'cancellation cannot extend another success');
      }
      assert.equal(f.aggregate.snapshot().notice?.sessionId, expected, f.context(order.join(' -> ')));
      assert.equal(f.view.state, expected ? 'celebrate' : 'working');
    }
    f.step(5000);f.publish();
    assert.equal(f.view.state, 'working');assert.equal(f.view.workingCount, 1);
    f.emit(boundary('a', 2, 'turn/end', 'aborted'));
    assert.equal(f.aggregate.snapshot().notice, undefined);
  }
});

test('stress: delayed errors settle only within their budget and do not erase a newer unrelated success when expired', () => {
  for (const idleAge of [10000, 10001]) {
    const f = fixture();f.emit(boundary('a', 1, 'turn/end', 'error'));
    const began = f.clock;
    f.at(began + 9999);f.emit(boundary('b', 1, 'turn/end', 'completed'));
    assert.equal(f.view.state, 'celebrate');
    f.at(began + idleAge);f.status('a', { running: false });
    assert.equal(f.view.state, idleAge === 10000 ? 'error' : 'celebrate');
    assert.equal(f.aggregate.snapshot().notice.sessionId, idleAge === 10000 ? 'a' : 'b');
  }
});

test('stress: scope, reset and disconnect clear both visible success and held error across repeated epochs', () => {
  for (const operation of ['scope', 'reset', 'disconnect']) {
    const f = fixture();
    for (let epoch = 0; epoch < 12; epoch++) {
      f.step(100);f.status('a', { running: true });f.status('b', { running: true });
      const seq = epoch * 10 + 1;
      f.emit(boundary('a', seq, 'turn/end', 'completed'));
      f.emit(boundary('b', seq, 'turn/end', 'error'));
      assert.equal(f.view.state, 'celebrate');
      if (operation === 'scope') { f.publish({ scope: 'current', currentSessionId: 'b' });f.publish({ scope: 'global' }); }
      if (operation === 'reset') f.reset([{ sessionId: 'a', isSubagent: false }, { sessionId: 'b', isSubagent: false }]);
      if (operation === 'disconnect') { f.publish({ connected: false });f.publish({ connected: true }); }
      assert.equal(f.view.state, 'working', f.context(`${operation}, epoch=${epoch}`));
      f.status('b', { running: false });
      assert.equal(f.view.state, 'working', 'cleared error candidates cannot settle after the new baseline');
      assert.equal(f.aggregate.snapshot().notice, undefined);
      const draws = f.draws;
      for (let n = 0; n < 3; n++) { f.step(10);f.publish(); }
      assert.equal(f.draws, draws, 'projection updates alone cannot replay success');
      // Deliberately do not replay old boundary packets across a stream reset:
      // filtering those belongs to bridge-client's baseline/sequence contract.
    }
  }
});

test('stress: subagent identity from catalog, baseline or live boundary never overwrites a main success', () => {
  for (const identity of ['catalog', 'baseline', 'boundary']) {
    for (const order of permutations(['childStart', 'mainDone', 'childDone']).filter(order => order.indexOf('childStart') < order.indexOf('childDone'))) {
      const f = fixture(['a', 'child']);
      if (identity === 'catalog') f.catalog.byId.child.origin = 'subagent';
      if (identity === 'boundary') delete f.catalog.byId.child;
      f.reset(identity === 'baseline' ? [{ sessionId: 'child', isSubagent: true }] : []);
      let mainDone = false;
      for (const action of order) {
        f.step(7);
        if (action === 'childStart') f.emit(boundary('child', 1, 'turn/start', undefined, identity === 'boundary' ? { isSubagent: true } : {}));
        if (action === 'childDone') f.emit(boundary('child', 2, 'turn/end', 'completed', identity === 'boundary' ? { isSubagent: true } : {}));
        if (action === 'mainDone') { f.emit(boundary('a', 1, 'turn/end', 'completed'));mainDone = true; }
        assert.equal(f.view.state, mainDone ? 'celebrate' : 'working', f.context(`${identity}: ${order}`));
        assert.equal(f.aggregate.snapshot().workingCount, 1);
        assert.equal(f.draws, mainDone ? 1 : 0);
        assert.equal(f.aggregate.snapshot().notice?.sessionId, mainDone ? 'a' : undefined);
      }
    }
  }
});

test('stress: independent current/global instances can diverge, reset and reconnect without leaking windows', () => {
  const current = fixture(['a', 'b', 'c'], 'current'), global = fixture(['a', 'b', 'c']);
  for (let round = 0; round < 16; round++) {
    for (const f of [current, global]) { f.step(5000);f.publish(); }
    const seq = round * 4 + 1;
    for (const f of [current, global]) f.emit(boundary('b', seq, 'turn/end', 'completed'));
    assert.equal(current.view.state, 'working');assert.equal(global.view.state, 'celebrate');
    for (const f of [current, global]) f.emit(boundary('a', seq, 'turn/end', 'completed'));
    assert.equal(current.view.state, 'celebrate');assert.equal(global.view.state, 'celebrate');
    const globalDeadline = global.machine.noticeUntil, globalDraws = global.draws;
    current.publish({ connected: false });current.reset();current.publish({ connected: true });
    assert.equal(current.view.state, 'working');
    assert.equal(global.machine.noticeUntil, globalDeadline);assert.equal(global.draws, globalDraws);
    assert.equal(global.view.state, 'celebrate');
    for (const f of [current, global]) f.emit(boundary('a', seq + 1, 'turn/start'));
    assert.equal(current.view.state, 'working');assert.equal(global.view.state, 'celebrate');
    for (const f of [current, global]) f.emit(boundary('a', seq + 2, 'turn/end', 'completed'));
    assert.equal(current.view.state, 'celebrate');assert.equal(global.view.state, 'celebrate');
  }
});

test('stress: a late second renderer treats an active notice as baseline but observes future replies independently', () => {
  const f = fixture();f.emit(boundary('a', 1, 'turn/end', 'completed'));
  const late = new PetStateMachine(f.clock, 120000, () => .8, () => .3);
  let lateView = late.update(f.aggregate.snapshot(), f.clock);
  assert.equal(f.view.state, 'celebrate');assert.equal(lateView.state, 'working');
  const firstDeadline = f.machine.noticeUntil;
  f.step(200);f.emit(boundary('a', 2, 'turn/start'));
  lateView = late.update(f.aggregate.snapshot(), f.clock);
  assert.equal(lateView.state, 'working');assert.equal(f.machine.noticeUntil, firstDeadline);
  f.step(200);f.emit(boundary('a', 3, 'turn/end', 'completed'));
  lateView = late.update(f.aggregate.snapshot(), f.clock);
  assert.equal(lateView.state, 'celebrate');assert.equal(f.view.state, 'celebrate');
  assert.equal(late.noticeUntil, f.machine.noticeUntil);
  f.at(f.clock + 4200);lateView = late.update(f.aggregate.snapshot(), f.clock);
  assert.equal(lateView.state, 'working');assert.equal(f.view.state, 'working');
});
