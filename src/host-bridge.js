import { WHALE_VERSION } from './version.js';

// Read-only Host event bridge. No transcript retention or HTTP routes.
export const name = 'whalePet';
export const inject = ['agents'];
export const BRIDGE_QUEUE_LIMIT = 128;

export function runtimeIdentity(agents, sessionId) {
  try {
    const agent = agents?.get(sessionId);
    if (!agent || typeof agents.roots !== 'function') return {};
    return { isSubagent: !agents.roots().includes(agent) };
  } catch { return {}; }
}

export class WhaleBoundaryHub {
  #accepted = { starts: 0, ends: 0, completed: 0 };
  diagnostics() { return { version: WHALE_VERSION, ...this.#accepted }; }
  constructor({ agents, epoch = globalThis.crypto.randomUUID(), queueLimit = BRIDGE_QUEUE_LIMIT } = {}) {
    this.agents = agents;
    this.hostEpoch = epoch;
    this.streamSeq = 0;
    this.queueLimit = Math.max(2, Math.min(1024, queueLimit));
    this.clients = new Set();
    this.closed = false;
    this.seen = new Map();
  }
  baseline() {
    let identities = [];
    try {
      identities = [...this.agents.list()].slice(0, 4096).map(agent => ({
        sessionId: String(agent.id), ...runtimeIdentity(this.agents, agent.id),
      }));
    } catch { /* Identity is optional, never invent an ownership classification. */ }
    return { type: 'baseline', hostEpoch: this.hostEpoch, streamSeq: this.streamSeq, identities };
  }
  accept(session, event) {
    if (this.closed || !event || (event.type !== 'turn/start' && event.type !== 'turn/end')) return;
    const sessionId = session?.id;
    if (typeof sessionId !== 'string' || !sessionId || !Number.isSafeInteger(event.seq) || event.seq < 0) return;
    if (event.seq <= (this.seen.get(sessionId) ?? -1)) return;
    this.seen.delete(sessionId);
    this.seen.set(sessionId, event.seq);
    if (this.seen.size > 4096) this.seen.delete(this.seen.keys().next().value);
    const frame = {
      type: event.type, hostEpoch: this.hostEpoch, streamSeq: ++this.streamSeq,
      sessionId, seq: event.seq,
      time: typeof event.time === 'string' ? event.time.slice(0, 64) : Number.isFinite(event.time) ? event.time : Date.now(),
      ...runtimeIdentity(this.agents, sessionId),
    };
    if (event.type === 'turn/end') {
      const kind = event.data?.reason?.kind;
      frame.reason = typeof kind === 'string' ? kind.slice(0, 80) : 'unknown';
    }
    // Accepted live boundaries only, after the same validation/dedup gates.
    // Counts are Hub-lifetime totals, not inferred from stored log history.
    const counter = event.type === 'turn/start' ? 'starts' : 'ends';
    this.#accepted[counter] = Math.min(1000000, this.#accepted[counter] + 1);
    if (frame.reason === 'completed') this.#accepted.completed = Math.min(1000000, this.#accepted.completed + 1);
    for (const client of this.clients) client.push(frame);
  }
  watch(signal) {
    const hub = this;
    const queue = [];
    let resolveNext;
    let ended = this.closed || signal?.aborted === true;
    const finish = () => {
      if (ended) return;
      ended = true;
      hub.clients.delete(client);
      signal?.removeEventListener('abort', finish);
      queue.length = 0;
      if (resolveNext) { const resolve = resolveNext; resolveNext = undefined; resolve({ done: true }); }
    };
    const client = {
      push(frame) {
        if (ended) return;
        if (resolveNext) { const resolve = resolveNext; resolveNext = undefined; resolve({ done: false, value: frame }); }
        else if (queue.length >= hub.queueLimit) {
          // Drop stale boundaries, send a fresh watermark instead of replaying success.
          queue.length = 0;
          queue.push(hub.baseline());
        } else queue.push(frame);
      },
      next() {
        if (queue.length) return Promise.resolve({ done: false, value: queue.shift() });
        if (ended) return Promise.resolve({ done: true });
        if (resolveNext) return Promise.reject(new Error('Only one bridge iterator read may be pending'));
        return new Promise(resolve => { resolveNext = resolve; });
      },
      return() { finish(); return Promise.resolve({ done: true }); },
      [Symbol.asyncIterator]() { return this; },
      close: finish,
    };
    if (!ended) {
      this.clients.add(client);
      signal?.addEventListener('abort', finish, { once: true });
      client.push(this.baseline());
    }
    return client;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const client of [...this.clients]) client.close();
    this.seen.clear();
  }
}

export function apply(ctx) {
  const hub = new WhaleBoundaryHub({ agents: ctx.get('agents') });
  const service = {
    watch(signal) { return hub.watch(signal); },
    diagnostics(_signal) { return hub.diagnostics(); },
  };
  // Public Cordis service + the exact visible protocol binding. Strict reflection is
  // contributed separately by ./typert; no SRC discovery or decorator fallback.
  service.typertRemote = Object.freeze({ service, serviceKey: name, namespace: name });
  ctx.provide(name, service);
  ctx.on('session/event', (session, event) => hub.accept(session, event), { global: true });
  ctx.effect(() => () => hub.dispose(), 'whale-pet.boundary-hub');
}
