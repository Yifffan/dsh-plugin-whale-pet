/** Pure pet state machine. Wall-clock time is injected for deterministic tests. */
export const STATES = Object.freeze(['resting', 'working', 'waiting', 'celebrate', 'sleeping', 'error']);
export const ERROR_KEYS = Object.freeze(['state.error', 'error.try', 'error.check', 'error.again']);
export const CELEBRATION_KEYS = Object.freeze(['state.celebrate', 'celebrate.again', 'celebrate.applause', 'celebrate.done', 'celebrate.team']);
export const WORKING_KEYS = Object.freeze(['state.working', 'working.start', 'working.find', 'working.think', 'working.progress', 'working.settings']);
// A settings tip is an occasional hint, not a regular work message.
export const WORKING_HINT_CHANCE = 0.02;
function nextWorkingVariantIndex(previous, random) {
  const hint = WORKING_KEYS.indexOf('working.settings');
  const draw = Math.min(1, Math.max(0, Number(random()) || 0));
  if (previous !== hint && draw >= 1 - WORKING_HINT_CHANCE) return hint;
  const choices = WORKING_KEYS.map((_, index) => index).filter(index => index !== hint && index !== previous);
  const regularDraw = previous === hint ? draw : draw / (1 - WORKING_HINT_CHANCE);
  return choices[Math.min(choices.length - 1, Math.floor(regularDraw * choices.length))];
}
function nextVariantIndex(size, previous, random) {
  const count = size - (previous >= 0 ? 1 : 0);
  const pick = Math.min(count - 1, Math.max(0, Math.floor(random() * count) || 0));
  return previous >= 0 && pick >= previous ? pick + 1 : pick;
}
export const DEFAULTS = Object.freeze({ scale: 1, hidden: false, motion: true, scope: 'global', sleepAfterMs: 120000, x: null, y: null });
export const STORAGE_KEY = 'dsh-plugin-whale-pet:v1';

export function cleanPreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  return {
    scale: finite(source.scale) ? Math.min(1.6, Math.max(0.65, source.scale)) : 1,
    hidden: source.hidden === true,
    motion: source.motion !== false,
    scope: source.scope === 'current' ? 'current' : 'global',
    sleepAfterMs: [30000, 120000, 300000].includes(source.sleepAfterMs) ? source.sleepAfterMs : 120000,
    x: finite(source.x) ? source.x : null,
    y: finite(source.y) ? source.y : null,
  };
}

export function clampPosition(x, y, width, height, viewportWidth, viewportHeight, top = 56) {
  const margin = 12;
  const maxX = Math.max(margin, viewportWidth - width - margin);
  const maxY = Math.max(margin, viewportHeight - height - margin);
  return {
    x: Math.min(maxX, Math.max(margin, x)),
    y: Math.min(maxY, Math.max(Math.min(top, maxY), y)),
  };
}

export class PetStateMachine {
  constructor(now = Date.now(), sleepAfterMs = DEFAULTS.sleepAfterMs, random = Math.random, workingRandom = Math.random) {
    this.random = random;
    this.workingRandom = workingRandom;
    this.celebrationIndex = -1;
    this.workingIndex = -1;
    this.errorIndex = -1;
    this.noticeId = undefined;
    this.liveNotice = undefined;
    this.noticeUntil = 0;
    this.sleepAfterMs = sleepAfterMs;
    this.sessionId = undefined;
    this.idleSince = now;
    this.celebrateUntil = 0;
    this.seenRunning = false;
    this.outcomeId = undefined;
    this.runId = undefined;
    this.snapshot = { available: false, running: false, pending: false };
    this.interactionUntil = 0;
  }
  update(snapshot, now = Date.now()) {
    const next = snapshot || { available: false };
    const changedSession = next.sessionId !== this.sessionId;
    const reconnected = next.available === true && this.snapshot.available !== true;
    // One phrase per uninterrupted busy period. Pending approval and internal
    // turn/start events must not reroll it while the driver remains running.
    if (next.available === true && next.running === true && (changedSession || reconnected || this.snapshot.running !== true)) {
      this.workingIndex = nextWorkingVariantIndex(this.workingIndex, this.workingRandom);
    }
    if (changedSession || reconnected) {
      this.sessionId = next.sessionId;
      this.idleSince = now;
      this.celebrateUntil = 0;
      this.seenRunning = next.running === true;
      // Never celebrate an old completed turn on mount, reconnect or session switch.
      this.outcomeId = next.outcome?.id;
      this.runId = next.runId;
    } else {
      if (next.runId !== undefined && next.runId !== this.runId) {
        this.runId = next.runId;
        this.celebrateUntil = 0;
        this.seenRunning = true;
        this.outcomeId = next.outcome?.id;
      }
      if (next.running === true && this.snapshot.running !== true) this.celebrateUntil = 0;
      if (next.running === true) this.seenRunning = true;
      if (next.outcome?.id !== undefined && next.outcome.id !== this.outcomeId) {
        this.outcomeId = next.outcome.id;
        if (this.seenRunning && next.outcome.reason === 'completed') {
          this.celebrateUntil = now + 4200;
          // Choose once per accepted completion, not on paint or language changes.
          // Uniformly select from the pool excluding the previous phrase.
          this.celebrationIndex = nextVariantIndex(CELEBRATION_KEYS.length, this.celebrationIndex, this.random);
        } else this.celebrateUntil = 0;
        this.seenRunning = false;
      }
      if ((this.snapshot.running || this.snapshot.pending) && !next.running && !next.pending) this.idleSince = now;
    }
    if (changedSession || reconnected) {
      this.noticeId = next.notice?.id;
      this.liveNotice = undefined;
      this.noticeUntil = 0;
    } else if (next.notice?.id !== undefined && next.notice.id !== this.noticeId) {
      this.noticeId = next.notice.id;
      if (next.notice.reason === 'completed' || next.notice.reason === 'error') {
        this.liveNotice = next.notice.reason;
        this.noticeUntil = now + 4200;
        if (next.notice.reason === 'error') this.errorIndex = nextVariantIndex(ERROR_KEYS.length, this.errorIndex, this.random);
        else this.celebrationIndex = nextVariantIndex(CELEBRATION_KEYS.length, this.celebrationIndex, this.random);
      }
    } else if (!next.notice && this.liveNotice) {
      this.liveNotice = undefined;
      this.noticeUntil = Math.min(this.noticeUntil, now);
    }
    if (next.available !== true) {
      this.liveNotice = undefined;
      this.noticeUntil = 0;
      this.celebrateUntil = 0;
      this.seenRunning = false;
      this.idleSince = now;
    }
    if (next.running || next.pending) this.idleSince = now;
    this.snapshot = next;
    return this.view(now);
  }
  touch(now = Date.now()) {
    this.idleSince = now;
    this.interactionUntil = now + 1800;
    return this.view(now);
  }
  view(now = Date.now()) {
    const s = this.snapshot;
    let state = 'resting';
    const noticeKey = now < this.noticeUntil && this.liveNotice
      ? (this.liveNotice === 'error' ? ERROR_KEYS[this.errorIndex] : CELEBRATION_KEYS[this.celebrationIndex]) : undefined;
    if (s.available === true) {
      if (s.pending) state = 'waiting';
      else if (noticeKey) state = this.liveNotice === 'error' ? 'error' : 'celebrate';
      else if (s.running) state = 'working';
      else if (now < this.celebrateUntil) state = 'celebrate';
      else if (now - Math.max(this.idleSince, this.celebrateUntil, this.noticeUntil) >= this.sleepAfterMs) state = 'sleeping';
    }
    return {
      state,
      noticeKey: s.available === true ? noticeKey : undefined,
      workingCount: state === 'working' ? Math.max(0, Math.floor(Number(s.workingCount ?? 1) || 0)) : 0,
      messageKey: s.available !== true ? 'state.unavailable'
        : state === 'celebrate' ? (CELEBRATION_KEYS[this.celebrationIndex] || 'state.celebrate')
        : state === 'working' ? (WORKING_KEYS[this.workingIndex] || 'state.working') : `state.${state}`,
      greeting: now < this.interactionUntil,
      available: s.available === true,
    };
  }
}
