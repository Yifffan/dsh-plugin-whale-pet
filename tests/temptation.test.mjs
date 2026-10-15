import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FishTemptation, TEMPT_BLOCKING, TEMPT_DEFAULTS, TEMPT_KEYS, TEMPT_PHASES, TEMPT_TIMELINE,
} from '../src/temptation.js';

const css = readFileSync(new URL('../src/pet.css', import.meta.url), 'utf8');
const context = extra => ({ enabled: true, paused: false, dragging: false, state: 'working', ...extra });
// Always the midpoint of a range, so every schedule below is exact.
const steady = () => 0.5;
// Cumulative start of each phase, derived from the one timeline definition.
const STARTS = TEMPT_PHASES.map((_, index) => TEMPT_PHASES.slice(0, index)
  .reduce((total, phase) => total + TEMPT_TIMELINE[`${phase}Ms`], 0));
const TOTAL = STARTS.at(-1) + TEMPT_TIMELINE.returnMs;

test('a school is scheduled inside the configured window and never at mount', () => {
  const director = new FishTemptation(0, steady);
  assert.equal(director.view(0).active, false);
  const arrival = director.nextAt;
  assert.ok(arrival >= TEMPT_DEFAULTS.firstMinMs && arrival <= TEMPT_DEFAULTS.firstMaxMs);
  assert.equal(director.update(arrival - 1, context()).active, false);
  assert.equal(director.update(arrival, context()).active, true);
});

test('the gag walks notice, tempted, chase, catch, return and then reschedules', () => {
  const director = new FishTemptation(0, steady);
  const arrival = director.nextAt;
  director.update(arrival, context());
  assert.deepEqual(TEMPT_PHASES.map((_, index) => director.view(arrival + STARTS[index]).phase), TEMPT_PHASES);
  assert.deepEqual(TEMPT_PHASES.map((_, index) => director.view(arrival + STARTS[index]).key), TEMPT_KEYS);
  assert.equal(director.view(arrival + TOTAL - 1).active, true);
  const after = director.update(arrival + TOTAL, context());
  assert.equal(after.active, false);
  assert.equal(after.phase, 'none');
  assert.equal(director.finished, 1);
  assert.ok(director.nextAt >= arrival + TOTAL + TEMPT_DEFAULTS.gapMinMs, 'later schools keep a quiet gap');
  assert.ok(director.nextAt <= arrival + TOTAL + TEMPT_DEFAULTS.gapMaxMs);
});

test('repeated paint ticks neither restart nor double count one school', () => {
  const director = new FishTemptation(0, steady);
  const arrival = director.nextAt;
  director.update(arrival, context());
  for (let tick = 0; tick < 40; tick++) director.update(arrival + tick * 180, context());
  assert.equal(director.finished, 0);
  assert.equal(director.startedAt, arrival);
  assert.equal(director.view(arrival + 1800).phase, 'chase');
});

test('a pending decision, a failure and a win always interrupt the school', () => {
  for (const state of TEMPT_BLOCKING) {
    const director = new FishTemptation(0, steady);
    const arrival = director.nextAt;
    director.update(arrival, context());
    assert.equal(director.view(arrival + 500).active, true);
    assert.equal(director.update(arrival + 500, context({ state })).active, false, `${state} must win`);
    assert.equal(director.nextAt, arrival + 500 + TEMPT_DEFAULTS.retryMs);
  }
});

test('a hand on the whale interrupts the school', () => {
  const director = new FishTemptation(0, steady);
  const arrival = director.nextAt;
  director.update(arrival, context());
  assert.equal(director.update(arrival + 900, context({ dragging: true })).active, false);
});

test('resting and sleeping whales are tempted too, and blocked moments retry shortly', () => {
  for (const state of ['resting', 'sleeping', 'working']) {
    const director = new FishTemptation(0, steady);
    const arrival = director.nextAt;
    assert.equal(director.update(arrival, context({ state })).active, true, `${state} should look`);
  }
  const director = new FishTemptation(0, steady);
  const arrival = director.nextAt;
  assert.equal(director.update(arrival, context({ state: 'waiting' })).active, false);
  assert.equal(director.nextAt, arrival + TEMPT_DEFAULTS.retryMs);
  assert.equal(director.update(arrival + TEMPT_DEFAULTS.retryMs, context()).active, true);
});

test('the switch, a hidden pet or no signal means no fish at all', () => {
  const director = new FishTemptation(0, steady);
  director.update(5000, context({ enabled: false }));
  assert.equal(director.view(5000).active, false);
  assert.equal(director.nextAt, undefined, 'a disabled feature forgets its schedule');
  director.update(999999, context({ enabled: false }));
  assert.equal(director.view(999999).active, false);
  assert.equal(director.update(999999, context()).active, false, 're-enabling starts a fresh first delay');
  assert.ok(director.nextAt > 999999 + TEMPT_DEFAULTS.firstMinMs - 1);

  const paused = new FishTemptation(0, steady);
  const arrival = paused.nextAt;
  paused.update(arrival, context());
  assert.equal(paused.update(arrival + 400, context({ paused: true })).active, false);
  assert.equal(paused.nextAt, undefined);
});

test('the CSS timeline is the same timeline as the director', () => {
  const totals = [...css.matchAll(/--tempt-total:(\d+)ms/g)].map(match => Number(match[1]));
  assert.ok(totals.length >= 2);
  for (const total of totals) assert.equal(total, TOTAL, 'every --tempt-total must match TEMPT_TIMELINE');
  const marks = [...css.matchAll(/--tempt-p(\d):([\d.]+)%/g)];
  assert.deepEqual(marks.map(match => Number(match[2])), TEMPT_PHASES.slice(0, -1)
    .map((_, index) => Number(((STARTS[index + 1] / TOTAL) * 100).toFixed(2))));
  for (const match of marks) assert.ok(css.includes(`${match[2]}%{`), `keyframes must use ${match[2]}%`);
  // The whale is displaced by transform only, so the saved spot can never move.
  for (const block of css.matchAll(/:host\(\[data-chase=active\]\) \.pet\{([^}]*)\}/g)) {
    assert.doesNotMatch(block[1], /(?:^|;)(?:left|top|margin):/);
  }
});
