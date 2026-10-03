import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE_ENDPOINT, createBalanceReader, projectBalance } from '../src/balance.js';

const SAMPLE = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '480.32', granted_balance: '0.00', topped_up_balance: '480.32' }] };
const credentials = value => ({ resolve: async () => (value === undefined ? undefined : { value }) });
const okFetch = (payload = SAMPLE) => async () => ({ ok: true, json: async () => payload });
const reader = (options = {}) => createBalanceReader({ credentials: credentials('sk-test'), fetchImpl: okFetch(), now: () => 1000, ...options });

test('a configured key yields exact decimal strings and a source', async () => {
  const frame = await reader().read();
  assert.deepEqual(frame, { available: true, source: 'api', wallets: [{ currency: 'CNY', total: '480.32', granted: '0.00', toppedUp: '480.32' }], fetchedAt: 1000 });
});

test('the resolved key is sent as a bearer token to the pinned endpoint only', async () => {
  const seen = [];
  await reader({ fetchImpl: async (url, init) => { seen.push({ url, auth: init.headers.authorization }); return { ok: true, json: async () => SAMPLE }; } }).read();
  assert.deepEqual(seen, [{ url: BALANCE_ENDPOINT, auth: 'Bearer sk-test' }]);
});

test('an absent, empty or unreadable credential never fetches and never throws', async () => {
  for (const [label, service] of [['absent', undefined], ['empty', credentials('')], ['throwing', { resolve: async () => { throw new Error('store offline'); } }]]) {
    let fetched = 0;
    const frame = await createBalanceReader({ credentials: service, fetchImpl: async () => { fetched += 1; return { ok: true, json: async () => SAMPLE }; } }).read();
    assert.deepEqual(frame, { available: false, source: 'unconfigured' }, label);
    assert.equal(fetched, 0, label);
  }
});

test('rejected, unreachable, malformed and unavailable answers stay phrase-only', async () => {
  assert.deepEqual(await reader({ fetchImpl: async () => ({ ok: false, status: 401 }) }).read(), { available: false, source: 'rejected' });
  assert.deepEqual(await reader({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }).read(), { available: false, source: 'unreachable' });
  assert.deepEqual(await reader({ fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('not json'); } }) }).read(), { available: false, source: 'unreachable' });
  assert.deepEqual(await reader({ fetchImpl: okFetch({ is_available: false }) }).read(), { available: false, source: 'api' });
});

test('a frame that only repeats already-absent states is never cached', async () => {
  let calls = 0;
  const read = reader({ fetchImpl: async () => { calls += 1; return { ok: false, status: 500 }; } }).read;
  await read(); await read();
  assert.equal(calls, 2);
});

test('a successful reading is cached, then re-read once the window elapses', async () => {
  let calls = 0; let clock = 1000;
  const read = createBalanceReader({ credentials: credentials('sk-test'), fetchImpl: async () => { calls += 1; return { ok: true, json: async () => SAMPLE }; }, now: () => clock }).read;
  await read(); await read();
  assert.equal(calls, 1);
  clock += 60001;
  await read();
  assert.equal(calls, 2);
});

test('overlapping reads collapse onto one request', async () => {
  let calls = 0; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const read = createBalanceReader({ credentials: credentials('sk-test'), fetchImpl: async () => { calls += 1; await gate; return { ok: true, json: async () => SAMPLE }; } }).read;
  const first = read(); const second = read(); release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});

test('projection drops unknown currencies and malformed amounts instead of coercing', () => {
  const frame = projectBalance({ balance_infos: [{ currency: 'CNY; DROP', total_balance: '1' }, { currency: 'USD', total_balance: 'nope', topped_up_balance: '12' }, { total_balance: '3' }] }, 7);
  assert.deepEqual(frame, { available: true, source: 'api', wallets: [{ currency: 'USD', toppedUp: '12' }], fetchedAt: 7 });
});

test('a non-object body and an empty wallet list are inert', () => {
  assert.deepEqual(projectBalance(null, 1), { available: true, source: 'api', wallets: [], fetchedAt: 1 });
  assert.deepEqual(projectBalance({ balance_infos: 'nope' }, 2), { available: true, source: 'api', wallets: [], fetchedAt: 2 });
});
