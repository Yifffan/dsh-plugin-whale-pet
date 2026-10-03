// Read-only DeepSeek balance reader for the whale's bubble.
//
// Same boundary as the boundary hub: this file owns the only credential use, the
// value never enters a frame, a log line or the client bundle. A missing key, a
// rejected key or an unreachable endpoint all reduce to `available: false`, so the
// bubble degrades to one localized phrase instead of inventing a figure.
const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance';
const BALANCE_CACHE_MS = 60000;
const BALANCE_TIMEOUT_MS = 10000;
const BALANCE_CURRENCY = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
const BALANCE_DECIMAL = /^-?\d{1,24}(?:\.\d{1,12})?$/;

/** Keep a server-authored decimal string exact; anything else reads as absent. */
function amount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return BALANCE_DECIMAL.test(trimmed) ? trimmed : undefined;
}

/** Reduce one `/user/balance` payload to the frame the bubble renders. */
function projectBalance(payload, fetchedAt) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const wallets = [];
  for (const entry of Array.isArray(body.balance_infos) ? body.balance_infos : []) {
    if (!entry || typeof entry !== 'object') continue;
    const currency = typeof entry.currency === 'string' && BALANCE_CURRENCY.test(entry.currency) ? entry.currency : undefined;
    if (currency === undefined) continue;
    const total = amount(entry.total_balance);
    const frame = { currency };
    if (total !== undefined) frame.total = total;
    const granted = amount(entry.granted_balance);
    if (granted !== undefined) frame.granted = granted;
    const toppedUp = amount(entry.topped_up_balance);
    if (toppedUp !== undefined) frame.toppedUp = toppedUp;
    wallets.push(frame);
  }
  return body.is_available === false ? { available: false, source: 'api' } : { available: true, source: 'api', wallets, fetchedAt };
}

/**
 * Create the one balance reader the Host service shares.
 * @param options.credentials - Host credential service; absent means an unconfigured key.
 * @param options.fetchImpl - fetch implementation, injectable for tests.
 * @param options.now - clock, injectable for tests.
 */
function createBalanceReader({ credentials, fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now(), ref = 'DEEPSEEK_API_KEY', endpoint = BALANCE_ENDPOINT, cacheMs = BALANCE_CACHE_MS, timeoutMs = BALANCE_TIMEOUT_MS } = {}) {
  let cached;
  let cachedAt = 0;
  let inflight;
  const read = async () => {
    if (cached !== undefined && now() - cachedAt < cacheMs) return cached;
    if (inflight !== undefined) return inflight;
    inflight = (async () => {
      try {
        let key;
        try { key = (await credentials?.resolve?.(ref))?.value; } catch { key = undefined; }
        if (typeof key !== 'string' || key === '') return cached ?? { available: false, source: 'unconfigured' };
        let response;
        try {
          response = await fetchImpl(endpoint, {
            method: 'GET',
            headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch { return cached ?? { available: false, source: 'unreachable' }; }
        if (!response?.ok) return cached ?? { available: false, source: 'rejected' };
        let payload;
        try { payload = await response.json(); } catch { return cached ?? { available: false, source: 'unreachable' }; }
        const frame = projectBalance(payload, now());
        if (frame.available && frame.wallets.length > 0) { cached = frame; cachedAt = now(); }
        return frame;
      } finally { inflight = undefined; }
    })();
    return inflight;
  };
  return { read, invalidate() { cached = undefined; cachedAt = 0; } };
}

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
  // The credential service is optional: without it the reader reports an
  // unconfigured key and the bubble shows one phrase instead of a figure.
  const reader = createBalanceReader({ credentials: ctx.get('credentials') });
  const service = {
    watch(signal) { return hub.watch(signal); },
    // Every method on this service is a stream contribution, so one reading is
    // published as a single-frame iterable that ends immediately.
    balance(signal) {
      return (async function* one() {
        if (signal?.aborted === true) return;
        yield await reader.read();
      })();
    },
  };
  // Public Cordis service + the exact visible protocol binding. Strict reflection is
  // contributed separately by ./typert; no SRC discovery or decorator fallback.
  service.typertRemote = Object.freeze({ service, serviceKey: name, namespace: name });
  ctx.provide(name, service);
  ctx.on('session/event', (session, event) => hub.accept(session, event), { global: true });
  ctx.effect(() => () => hub.dispose(), 'whale-pet.boundary-hub');
}
