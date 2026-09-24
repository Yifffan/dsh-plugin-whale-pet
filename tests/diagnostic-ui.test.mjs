import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WhaleWidget } from '../src/widget.js';
import { WhaleDiagnostics } from '../src/diagnostics.js';
import { MESSAGES, translate } from '../src/i18n.js';

function element() {
  return {
    hidden: false, disabled: false, value: '', textContent: '', attributes: {},
    focused: false, selected: false,
    setAttribute(key, value) { this.attributes[key] = value; },
    focus() { this.focused = true; },
    select() { this.selected = true; },
  };
}
function fixture() {
  const widget = Object.create(WhaleWidget.prototype);
  Object.assign(widget, {
    disposed: false, diagnosticsRequest: 0, language: 'en', diagnostics: new WhaleDiagnostics(),
    panel: element(), diagnosticsPanel: element(), diagnosticsToggle: element(),
    diagnosticsText: element(), diagnosticsRefresh: element(), diagnosticsCopy: element(),
    diagnosticsStatus: element(), button: element(), positionPanel() {},
    preferences: { hidden: false, scope: 'global' },
    cleanups: [], root: { replaceChildren() {} },
    host: { dataset: {}, removeAttribute() {} }, originalLang: null,
  });
  return widget;
}
function clipboard(t, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: value } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('explicit refresh produces sanitized JSON without needing a host callback', async () => {
  const widget = fixture();
  await widget.refreshDiagnostics();
  assert.ok(JSON.parse(widget.diagnosticsText.value).counts);
  assert.equal(widget.diagnosticsStatusKey, 'diagnostics.updated');
  assert.equal(widget.diagnosticsRefresh.disabled, false);
  assert.equal(widget.diagnosticsText.attributes['aria-busy'], 'false');
});

test('open refreshes once; closing and plain panel open do not query', async () => {
  const widget = fixture();
  let calls = 0;
  widget.onDiagnosticsRefresh = () => { calls++; };
  widget.openDiagnostics();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(widget.diagnosticsToggle.attributes['aria-expanded'], 'true');
  assert.equal(widget.diagnosticsText.focused, true);
  widget.closeDiagnostics();
  assert.equal(widget.diagnosticsToggle.attributes['aria-expanded'], 'false');
  assert.equal(widget.diagnosticsToggle.focused, true);
  widget.root.querySelector = () => element();
  widget.openPanel();
  assert.equal(calls, 1);
  assert.equal(widget.diagnosticsPanel.hidden, true);
});

test('copy is explicit and waits for refreshed diagnostics', async t => {
  const widget = fixture(), gate = deferred(), writes = [];
  clipboard(t, { writeText: async value => { writes.push(value); } });
  let calls = 0;
  widget.onDiagnosticsRefresh = async () => {
    calls++;
    await gate.promise;
    widget.diagnostics.setView({ state: 'celebrate', available: true }, { scope: 'global' });
  };
  const pending = widget.refreshDiagnostics(true);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(writes, []);
  assert.equal(widget.diagnosticsCopy.disabled, true);
  gate.resolve();
  await pending;
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0]).view.pose, 'celebrate');
  assert.equal(widget.diagnosticsStatusKey, 'diagnostics.copied');
  assert.equal(widget.diagnosticsText.selected, false);
});

for (const mode of ['missing', 'denied']) {
  test(`clipboard ${mode} selects read-only text and offers manual copy`, async t => {
    const widget = fixture();
    clipboard(t, mode === 'missing' ? undefined : { writeText: async () => { throw Error('private clipboard error'); } });
    await widget.refreshDiagnostics(true);
    assert.equal(widget.diagnosticsText.focused, true);
    assert.equal(widget.diagnosticsText.selected, true);
    assert.match(widget.diagnosticsStatus.textContent, /Ctrl\/Cmd\+C/);
    assert.doesNotMatch(widget.diagnosticsStatus.textContent, /private/);
  });
}

test('host rejection preserves a local snapshot and never renders exception text', async () => {
  const widget = fixture();
  widget.onDiagnosticsRefresh = () => { throw Error('secret-session-id and chat'); };
  await widget.refreshDiagnostics();
  assert.ok(JSON.parse(widget.diagnosticsText.value).counts);
  assert.equal(widget.diagnosticsStatusKey, 'diagnostics.refreshError');
  assert.doesNotMatch(widget.diagnosticsStatus.textContent, /secret-session-id|chat/);
  assert.equal(widget.diagnosticsRefresh.disabled, false);
});

test('bounded host wait releases controls and handles late rejection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const widget = fixture(), gate = deferred();
  widget.onDiagnosticsRefresh = () => gate.promise;
  const pending = widget.refreshDiagnostics();
  await Promise.resolve();
  t.mock.timers.tick(4000);
  await pending;
  assert.equal(widget.diagnosticsStatusKey, 'diagnostics.refreshError');
  assert.equal(widget.diagnosticsRefresh.disabled, false);
  gate.reject(Error('late host failure'));
  await Promise.resolve();
});

test('close/reopen ignores stale requests and preserves the newer snapshot', async () => {
  const widget = fixture(), gate = deferred();
  widget.onDiagnosticsRefresh = () => gate.promise;
  const pending = widget.refreshDiagnostics();
  await Promise.resolve();
  widget.closeDiagnostics(false);
  await pending;
  widget.diagnosticsPanel.hidden = false;
  widget.onDiagnosticsRefresh = undefined;
  await widget.refreshDiagnostics();
  const text = widget.diagnosticsText.value;
  const status = widget.diagnosticsStatus.textContent;
  gate.reject(Error('old host failure'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(widget.diagnosticsText.value, text);
  assert.equal(widget.diagnosticsStatus.textContent, status);
});

test('dispose cancels pending UI work without stale writes or clipboard access', async t => {
  const widget = fixture(), gate = deferred();
  let writes = 0;
  clipboard(t, { writeText: async () => { writes++; } });
  widget.onDiagnosticsRefresh = () => gate.promise;
  const pending = widget.refreshDiagnostics(true);
  await Promise.resolve();
  widget.dispose();
  const text = widget.diagnosticsText.value, status = widget.diagnosticsStatus.textContent;
  await pending;
  gate.reject(Error('disposed request'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(widget.diagnosticsText.value, text);
  assert.equal(widget.diagnosticsStatus.textContent, status);
  assert.equal(writes, 0);
});

test('repeated identical views do not log ticks or disturb selected JSON', () => {
  const widget = fixture();
  const seen = [];
  widget.diagnostics.setView = (view, options) => seen.push({ view, options });
  widget.diagnosticsText.value = 'manually selected JSON';
  widget.diagnosticsText.selected = true;
  const view = { state: 'working', available: true, workingCount: 1 };
  for (let tick = 0; tick < 1000; tick++) widget.syncDiagnosticsView({ ...view });
  assert.equal(seen.length, 1);
  widget.preferences.hidden = true;
  widget.syncDiagnosticsView(view);
  widget.preferences.scope = 'current';
  widget.syncDiagnosticsView(view);
  widget.syncDiagnosticsView({ ...view, state: 'waiting' });
  assert.equal(seen.length, 4);
  assert.equal(widget.diagnosticsText.value, 'manually selected JSON');
  assert.equal(widget.diagnosticsText.selected, true);
  assert.doesNotMatch(WhaleWidget.prototype.paint.toString(), /refreshDiagnostics|onDiagnosticsRefresh|diagnosticsText/);
});

test('diagnostic controls and statuses have English/Chinese privacy-safe copy', () => {
  assert.equal(translate('en', 'diagnostics.title'), 'Sync diagnostics');
  assert.equal(translate('zh', 'diagnostics.title'), '同步诊断');
  for (const key of Object.keys(MESSAGES.en).filter(key => key.startsWith('diagnostics.'))) {
    assert.ok(MESSAGES.zh[key], key);
    assert.notEqual(translate('zh', key), key);
  }
  assert.match(translate('en', 'diagnostics.privacy'), /No chat text, IDs or tokens/);
  const widget = fixture();
  widget.language = 'zh';
  widget.setDiagnosticsStatus('diagnostics.manualCopy');
  assert.match(widget.diagnosticsStatus.textContent, /已选中/);
});

test('static controls preserve accessibility, bounded scrolling and picker styling', () => {
  const widget = readFileSync(new URL('../src/widget.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/pet.css', import.meta.url), 'utf8');
  assert.match(widget, /class="diagnostics-text" readonly/);
  assert.match(widget, /aria-controls="whale-diagnostics"/);
  assert.match(widget, /class="diagnostics-status" role="status"/);
  assert.doesNotMatch(widget, /permissions\.query|execCommand/);
  assert.match(css, /\.diagnostics-text\{[^}]*max-height:32vh;[^}]*overflow:auto/);
  assert.match(css, /\.diagnostics\{[^}]*font-family:var\(--dsw-font-family,system-ui,sans-serif\)/);
  assert.match(css, /\.setting option::checkmark\{order:1;margin-left:auto/);
});
