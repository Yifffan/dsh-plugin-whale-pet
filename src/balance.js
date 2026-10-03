// Read-only DeepSeek balance reader for the whale's bubble.
//
// Same boundary as the boundary hub: this file owns the only credential use, the
// value never enters a frame, a log line or the client bundle. A missing key, a
// rejected key or an unreachable endpoint all reduce to `available: false`, so the
// bubble degrades to one localized phrase instead of inventing a figure.
export const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance';
export const BALANCE_CACHE_MS = 60000;
export const BALANCE_TIMEOUT_MS = 10000;
export const BALANCE_CURRENCY = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
export const BALANCE_DECIMAL = /^-?\d{1,24}(?:\.\d{1,12})?$/;

/** Keep a server-authored decimal string exact; anything else reads as absent. */
function amount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return BALANCE_DECIMAL.test(trimmed) ? trimmed : undefined;
}

/** Reduce one `/user/balance` payload to the frame the bubble renders. */
export function projectBalance(payload, fetchedAt) {
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
export function createBalanceReader({ credentials, fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now(), ref = 'DEEPSEEK_API_KEY', endpoint = BALANCE_ENDPOINT, cacheMs = BALANCE_CACHE_MS, timeoutMs = BALANCE_TIMEOUT_MS } = {}) {
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
