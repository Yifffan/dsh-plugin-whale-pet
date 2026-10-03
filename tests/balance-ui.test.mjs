import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE_STALE_MS, formatBalance } from '../src/widget.js';
import { MESSAGES, translate } from '../src/i18n.js';
import { fixture } from './widget-fixture.mjs';

const available = (total = '480.32', fetchedAt = 1000) => ({ available: true, source: 'api', wallets: [{ currency: 'CNY', total, granted: '0.00', toppedUp: total }], fetchedAt });

test('formatBalance keeps server decimals, groups digits and only marks known currencies', () => {
  assert.equal(formatBalance({ currency: 'CNY', total: '480.32' }), '¥480.32');
  assert.equal(formatBalance({ currency: 'USD', total: '1234567.5' }), '$1,234,567.5');
  assert.equal(formatBalance({ currency: 'XYZ', total: '12' }), '12 XYZ');
  assert.equal(formatBalance({ currency: 'CNY', total: '-3.5' }), '-¥3.5');
  for (const bad of [undefined, {}, { currency: 'CNY' }, { currency: 'CNY', total: 'nope' }, { currency: 'CNY', total: '' }]) {
    assert.equal(formatBalance(bad), undefined, JSON.stringify(bad));
  }
});

test('opt-in off keeps the ordinary bubble and no notice state', t => {
  const { widget } = fixture(t);
  widget.update({ available: true, running: false, sessionId: 's', runId: 'r0' });
  widget.setBalance(available());
  assert.equal(widget.bubbleText.textContent, translate('en', 'state.resting'));
  assert.equal(widget.pet.dataset.notice, 'false');
});

test('opt-in on shows the amount in the bubble and marks the notice state', t => {
  const { widget, saved } = fixture(t);
  widget.balance.checked = true;
  widget.balance.dispatch('change');
  assert.deepEqual(saved.at(-1).balance, true);
  widget.setBalance(available());
  assert.equal(widget.bubbleText.textContent, translate('en', 'pet.balance', { amount: '¥480.32' }));
  assert.equal(widget.pet.dataset.notice, 'true');
});

test('an unavailable reading shows the failure phrase, never an old figure', t => {
  const { widget } = fixture(t);
  widget.balance.checked = true; widget.balance.dispatch('change');
  widget.setBalance(available());
  widget.setBalance({ available: false, source: 'unconfigured' });
  assert.equal(widget.bubbleText.textContent, MESSAGES.en['pet.balanceUnavailable']);
  assert.doesNotMatch(widget.bubbleText.textContent, /\d/);
});

test('a live notice outranks the balance phrase and the amount returns afterwards', t => {
  const { widget } = fixture(t);
  widget.balance.checked = true; widget.balance.dispatch('change');
  // Establish the session first: the machine discards a live notice on a session switch.
  widget.update({ available: true, running: true, sessionId: 's', runId: 'r1', workingCount: 1 });
  widget.setBalance(available());
  widget.update({ available: true, running: true, sessionId: 's', runId: 'r1', workingCount: 1, notice: { id: 'n1', reason: 'completed' } });
  assert.equal(widget.pet.dataset.state, 'celebrate');
  assert.notEqual(widget.bubbleText.textContent, translate('en', 'pet.balance', { amount: '¥480.32' }));
  widget.update({ available: true, running: true, sessionId: 's2', runId: 'r2', workingCount: 1 });
  assert.equal(widget.bubbleText.textContent, translate('en', 'pet.balance', { amount: '¥480.32' }));
});

test('a routine session repaint cannot blank an opted-in bubble', t => {
  const { widget } = fixture(t);
  widget.balance.checked = true; widget.balance.dispatch('change');
  widget.setBalance(available());
  widget.update({ available: true, running: true, sessionId: 's', workingCount: 1 });
  assert.equal(widget.bubbleText.textContent, translate('en', 'pet.balance', { amount: '¥480.32' }));
});

test('clicking asks for a fresh reading only when the shown one is stale', t => {
  const wanted = [];
  let clock = 1000;
  const { widget } = fixture(t, 'en', { now: () => clock, onBalanceWanted: () => wanted.push(clock) });
  widget.balance.checked = true; widget.balance.dispatch('change');
  widget.setBalance(available('480.32', clock));
  widget.button.dispatch('click', { detail: 1 });
  assert.deepEqual(wanted, [], 'a fresh reading is reused');
  clock += BALANCE_STALE_MS + 1;
  widget.button.dispatch('click', { detail: 1 });
  assert.deepEqual(wanted, [clock], 'a stale reading is refreshed on demand');
});
