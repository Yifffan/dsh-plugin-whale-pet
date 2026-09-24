import { WHALE_VERSION } from './version.js';

// In-memory metadata only. Never retain caller objects, exception text, identifiers,
// absolute timestamps, or arbitrary enum strings. Bounds also apply to snapshots.
const whaleDiagnosticLimit = 64;
const whaleDiagnosticMaximum = 1000000;
const whaleDiagnosticReasons = ['disconnected', 'invalid', 'scope', 'duplicate', 'start', 'candidate', 'reason', 'unobserved', 'subagent', 'expired', 'driver-busy', 'error-priority', 'published', 'unknown'];
const whaleDiagnosticResets = ['unavailable', 'connecting', 'generation', 'disconnected', 'stream-ended', 'baseline', 'scope-connection', 'dispose', 'unknown'];
const whaleDiagnosticEvents = ['mount-attempt', 'mount-ready', 'mount-failure', 'watch-attempt', 'watch-failure', 'baseline', 'received-start', 'received-end', 'start', 'end', 'reset', 'aggregate-reset', 'eof', 'parser-failure', 'order-failure', 'duplicate', 'decision', 'aggregate', 'view', 'health', 'host-request', 'host-snapshot', 'host-unavailable', 'disposed'];
const whaleDiagnosticCounterNames = ['mountAttempts', 'mountFailures', 'watchAttempts', 'watchFailures', 'baselines', 'receivedStarts', 'receivedEnds', 'receivedCompleted', 'starts', 'ends', 'completed', 'resets', 'aggregateResets', 'cleanEof', 'parserFailures', 'orderFailures', 'duplicates', 'hostRequests'];
const whaleDiagnosticEnum = (value, values) => values.includes(value) ? value : 'unknown';
const whaleDiagnosticNumber = value => typeof value === 'number' && Number.isFinite(value) ? Math.min(whaleDiagnosticMaximum, Math.max(0, Math.floor(value))) : 0;
const whaleDiagnosticGet = (object, key) => {
  // Avoid running arbitrary getters/toJSON while sanitizing diagnostic inputs.
  try { const descriptor = Object.getOwnPropertyDescriptor(object ?? {}, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined; } catch { return undefined; }
};
const whaleDiagnosticReasonCounts = () => Object.fromEntries(whaleDiagnosticReasons.map(reason => [reason, 0]));

export class WhaleDiagnostics {
  #started = globalThis.performance?.now?.() ?? 0;
  #trace = [];
  #counts = Object.fromEntries(whaleDiagnosticCounterNames.map(name => [name, 0]));
  #decisions = { accepted: whaleDiagnosticReasonCounts(), dropped: whaleDiagnosticReasonCounts(), deferred: whaleDiagnosticReasonCounts() };
  #stage = 'idle';
  #ready = false;
  #host = { status: 'unavailable', reason: 'not-requested' };
  #view = { pose: 'unknown', available: false, notice: 'none', hidden: false, scope: 'unknown', greeting: false };
  #aggregate = { available: false, running: false, pending: false, workingCount: 0, waitingCount: 0, notice: 'none' };
  #elapsed() { return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor((globalThis.performance?.now?.() ?? this.#started) - this.#started))); }
  record(event, details = {}) {
    if (!whaleDiagnosticEvents.includes(event)) return;
    const get = key => whaleDiagnosticGet(details, key);
    const item = { atMs: this.#elapsed(), event };
    const increment = key => { this.#counts[key] = Math.min(whaleDiagnosticMaximum, this.#counts[key] + 1); };
    const counter = { 'mount-attempt': 'mountAttempts', 'mount-failure': 'mountFailures', 'watch-attempt': 'watchAttempts', 'watch-failure': 'watchFailures', baseline: 'baselines', 'received-start': 'receivedStarts', 'received-end': 'receivedEnds', start: 'starts', end: 'ends', reset: 'resets', 'aggregate-reset': 'aggregateResets', eof: 'cleanEof', 'parser-failure': 'parserFailures', 'order-failure': 'orderFailures', duplicate: 'duplicates', 'host-request': 'hostRequests' }[event];
    if (counter) increment(counter);
    if (['mount-attempt', 'mount-ready', 'mount-failure', 'watch-attempt', 'watch-failure', 'baseline', 'start', 'end', 'eof', 'parser-failure', 'order-failure', 'disposed'].includes(event)) this.#stage = event;
    if (event === 'end' || event === 'received-end') {
      item.reason = whaleDiagnosticEnum(get('reason'), ['completed', 'error', 'aborted', 'cancelled', 'interrupted', 'blocked', 'max-tokens', 'unknown']);
      if (item.reason === 'completed') increment(event === 'end' ? 'completed' : 'receivedCompleted');
    }
    if (event === 'reset' || event === 'aggregate-reset') item.reason = whaleDiagnosticEnum(get('reason'), whaleDiagnosticResets);
    if (event === 'health') { item.ready = get('ready') === true; this.#ready = item.ready; }
    if (event === 'disposed') this.#ready = false;
    if (event === 'decision') {
      item.outcome = whaleDiagnosticEnum(get('outcome'), ['accepted', 'dropped', 'deferred']);
      item.reason = whaleDiagnosticEnum(get('reason'), whaleDiagnosticReasons);
      if (item.outcome !== 'unknown') {
        const counters = this.#decisions[item.outcome];
        counters[item.reason] = Math.min(whaleDiagnosticMaximum, counters[item.reason] + 1);
      }
    }
    if (event === 'aggregate') {
      this.#aggregate = { available: get('available') === true, running: get('running') === true, pending: get('pending') === true,
        workingCount: whaleDiagnosticNumber(get('workingCount')), waitingCount: whaleDiagnosticNumber(get('waitingCount')),
        notice: whaleDiagnosticEnum(get('notice'), ['none', 'completed', 'error']) };
      Object.assign(item, this.#aggregate);
    }
    if (event === 'view') {
      this.#view = { pose: whaleDiagnosticEnum(get('pose'), ['resting', 'working', 'waiting', 'celebrate', 'sleeping', 'error']),
        available: get('available') === true, notice: whaleDiagnosticEnum(get('notice'), ['none', 'completed', 'error']),
        hidden: get('hidden') === true, scope: whaleDiagnosticEnum(get('scope'), ['global', 'current']), greeting: get('greeting') === true };
      Object.assign(item, this.#view);
    }
    if (event === 'host-request') this.#host = { status: 'unavailable', reason: 'pending' };
    if (event === 'host-unavailable') {
      item.reason = whaleDiagnosticEnum(get('reason'), ['unavailable', 'disconnected', 'timeout', 'aborted', 'invalid', 'remote-failure']);
      this.#host = { status: 'unavailable', reason: item.reason };
    }
    if (event === 'host-snapshot') {
      // Exact known version only: a malicious version field cannot smuggle text.
      this.#host = { status: 'available', version: get('version') === WHALE_VERSION ? WHALE_VERSION : 'unknown',
        starts: whaleDiagnosticNumber(get('starts')), ends: whaleDiagnosticNumber(get('ends')), completed: whaleDiagnosticNumber(get('completed')), sampledAtMs: item.atMs };
      Object.assign(item, this.#host);
    }
    // Keep repaint/publish loops from evicting the interesting boundary trace.
    if (event === 'view' || event === 'aggregate') {
      const previous = this.#trace.findLast(entry => entry.event === event);
      if (previous && Object.keys(item).every(key => key === 'atMs' || item[key] === previous[key])) return;
    }
    this.#trace.push(item);
    if (this.#trace.length > whaleDiagnosticLimit) this.#trace.shift();
  }
  setView(view, { hidden, scope } = {}) {
    const pose = whaleDiagnosticGet(view, 'state');
    const noticeKey = whaleDiagnosticGet(view, 'noticeKey');
    // Notice translation keys are classified, never copied into the trace.
    const notice = ['state.error', 'error.try', 'error.check', 'error.again'].includes(noticeKey) ? 'error'
      : ['state.celebrate', 'celebrate.again', 'celebrate.applause', 'celebrate.done', 'celebrate.team'].includes(noticeKey) ? 'completed'
      : noticeKey === undefined ? 'none' : 'unknown';
    this.record('view', { pose, available: whaleDiagnosticGet(view, 'available'), notice, hidden, scope, greeting: whaleDiagnosticGet(view, 'greeting') });
  }
  snapshot() {
    return { version: WHALE_VERSION, elapsedMs: this.#elapsed(), stage: this.#stage, ready: this.#ready,
      counterLifetimes: { client: 'widget-lifetime', host: 'hub-lifetime', maximum: whaleDiagnosticMaximum },
      counterMeanings: { received: 'schema-valid-before-order-gate', boundaries: 'ordered-forwarded-to-aggregate', mounts: 'local-calls-initiated-by-widget', decisions: 'gate-outcomes-not-unique-turns', host: 'last-explicit-refresh-snapshot' }, counts: { ...this.#counts },
      decisions: Object.fromEntries(Object.entries(this.#decisions).map(([key, value]) => [key, { ...value }])),
      host: { ...this.#host }, view: { ...this.#view }, aggregate: { ...this.#aggregate }, trace: this.#trace.map(item => ({ ...item })) };
  }
  text() { return JSON.stringify(this.snapshot(), null, 2); }
}
