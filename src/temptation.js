/**
 * Pure "a school of fish swims past" director.
 *
 * Wall-clock time and randomness are injected, so the whole gag is deterministic
 * under test. The director only decides *when* a school appears and which beat of
 * the gag is on screen; every movement is CSS. It never touches session data, and
 * it never overrides a real, user-facing state.
 */
export const TEMPT_PHASES = Object.freeze(['notice', 'tempted', 'chase', 'catch', 'return']);
export const TEMPT_KEYS = Object.freeze(['tempt.notice', 'tempt.tempted', 'tempt.chase', 'tempt.catch', 'tempt.back']);
// A pending decision, a failure or a win belongs to the person in front of the screen.
export const TEMPT_BLOCKING = Object.freeze(['waiting', 'celebrate', 'error']);
export const TEMPT_TIMELINE = Object.freeze({ noticeMs: 900, temptedMs: 900, chaseMs: 3400, catchMs: 1000, returnMs: 1400 });
export const TEMPT_TOTAL_MS = TEMPT_PHASES.reduce((total, phase) => total + TEMPT_TIMELINE[`${phase}Ms`], 0);
export const TEMPT_DEFAULTS = Object.freeze({
  enabled: true,
  // The first school arrives early enough to be discovered, later ones stay a surprise.
  firstMinMs: 18000, firstMaxMs: 40000,
  gapMinMs: 45000, gapMaxMs: 95000,
  // A block that clears quickly (a decision answered, a drag released) retries soon.
  retryMs: 2500,
  schools: 3,
  ...TEMPT_TIMELINE,
});
function draw(random, min, max) {
  const value = Number(random());
  const unit = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return min + unit * (max - min);
}
export class FishTemptation {
  constructor(now = Date.now(), random = Math.random, options = {}) {
    this.random = random;
    this.options = { ...TEMPT_DEFAULTS, ...options };
    this.steps = TEMPT_PHASES.map(phase => Math.max(0, Number(this.options[`${phase}Ms`]) || 0));
    this.totalMs = this.steps.reduce((total, ms) => total + ms, 0);
    this.startedAt = null;
    this.endsAt = 0;
    this.nextAt = undefined;
    this.school = 0;
    this.finished = 0;
    this.schedule(now, true);
  }
  schedule(now, first) {
    const { firstMinMs, firstMaxMs, gapMinMs, gapMaxMs } = this.options;
    this.nextAt = now + (first ? draw(this.random, firstMinMs, firstMaxMs) : draw(this.random, gapMinMs, gapMaxMs));
  }
  start(now = Date.now()) {
    this.startedAt = now;
    this.endsAt = now + this.totalMs;
    this.school = Math.min(Math.max(0, this.options.schools - 1), Math.floor(draw(this.random, 0, this.options.schools)));
    return this.view(now);
  }
  /** Interrupted mid-gag: the whale snaps home and the school is retried shortly. */
  interrupt(now) {
    this.startedAt = null;
    this.nextAt = now + this.options.retryMs;
  }
  /** Feature off, motion off or pet hidden: forget the schedule entirely. */
  clear() {
    this.startedAt = null;
    this.nextAt = undefined;
  }
  /**
   * Advance the director. `context` carries the live facts it must respect:
   * `{ enabled, paused, dragging, state }`.
   */
  update(now = Date.now(), context = {}) {
    // No fish at all when the feature is off, motion is off, or the pet is hidden.
    if (context.enabled === false || context.paused === true) {
      this.clear();
      return this.view(now);
    }
    if (this.nextAt === undefined) this.schedule(now, true);
    const blocked = context.dragging === true || TEMPT_BLOCKING.includes(context.state);
    if (this.startedAt !== null) {
      // A real state, or a hand on the whale, always interrupts the gag.
      if (blocked) this.interrupt(now);
      else if (now >= this.endsAt) { this.finished++; this.startedAt = null; this.schedule(now, false); }
    } else if (now >= this.nextAt) {
      if (blocked) this.nextAt = now + this.options.retryMs;
      else this.start(now);
    }
    return this.view(now);
  }
  view(now = Date.now()) {
    if (this.startedAt === null) {
      return { active: false, phase: 'none', key: undefined, elapsed: 0, total: this.totalMs, progress: 0, school: this.school };
    }
    const elapsed = Math.max(0, now - this.startedAt);
    let step = 0, offset = elapsed;
    while (step < this.steps.length - 1 && offset >= this.steps[step]) { offset -= this.steps[step]; step++; }
    return {
      active: true,
      phase: TEMPT_PHASES[step],
      key: TEMPT_KEYS[step],
      elapsed: Math.min(elapsed, this.totalMs),
      total: this.totalMs,
      progress: this.totalMs > 0 ? Math.min(1, elapsed / this.totalMs) : 1,
      school: this.school,
    };
  }
}
