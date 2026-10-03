import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MESSAGES, translate } from '../src/i18n.js';
import { WhaleWidget } from '../src/widget.js';
import { fixture } from './widget-fixture.mjs';

const source = readFileSync(new URL('../src/widget.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/pet.css', import.meta.url), 'utf8');

test('formal widget has no diagnostic/test controls, collectors, clipboard or telemetry paths', () => {
  assert.doesNotMatch(source, /diagnostic|clipboard|execCommand|permissions\.query|telemetry|data-action|test-button|<textarea/i);
  assert.doesNotMatch(css, /diagnostic|textarea/i);
  assert.doesNotMatch(Object.getOwnPropertyNames(WhaleWidget.prototype).join(' '), /diagnostic|copy|refresh/i);
  assert.match(css, /\.panel\{[^}]*max-width:calc\(100vw - 24px\);[^}]*max-height:calc\(100vh - 80px\);overflow:auto/);
  assert.match(css, /\.setting option::checkmark\{order:1;margin-left:auto/);
  assert.match(css, /\.panel button:focus-visible,\.panel input:focus-visible,\.panel select:focus-visible\{/);
});

for (const language of ['en', 'zh']) {
  test(`${language} formal menu exposes only ordinary localized accessible controls`, t => {
    const { widget } = fixture(t, language);
    const buttons = widget.root.querySelectorAll('button');
    assert.deepEqual(buttons.map(button => button.getAttribute('class')), ['pet-button', 'close', 'action reset', 'action hide', 'restore']);
    assert.deepEqual(widget.root.querySelectorAll('input').map(input => input.getAttribute('id')), ['whale-size', 'whale-motion', 'whale-balance']);
    assert.deepEqual(widget.root.querySelectorAll('select').map(select => select.getAttribute('id')), ['whale-scope', 'whale-sleep']);
    for (const node of widget.root.querySelectorAll('[data-i18n]')) assert.equal(node.textContent, MESSAGES[language][node.dataset.i18n]);
    for (const node of widget.root.querySelectorAll('[data-i18n-aria]')) assert.equal(node.getAttribute('aria-label'), MESSAGES[language][node.dataset.i18nAria]);
    assert.equal(widget.panel.getAttribute('role'), 'dialog');
    assert.equal(widget.motion.getAttribute('role'), 'switch');
    assert.equal(widget.panel.hidden, true);
    widget.button.dispatch('click');
    assert.equal(widget.panel.hidden, false);
    assert.equal(widget.root.querySelector('.close'), widget.host.ownerDocument.activeElement);
    widget.root.dispatch('keydown', { key: 'Escape' });
    assert.equal(widget.panel.hidden, true);
    assert.equal(widget.button, widget.host.ownerDocument.activeElement);
  });
}

test('English and Chinese dictionaries stay consistent without diagnostic copy', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.zh).sort());
  for (const language of ['en', 'zh']) for (const [key, value] of Object.entries(MESSAGES[language])) {
    assert.ok(value.trim()); assert.equal(translate(language, key), value);
    assert.doesNotMatch(key, /diagnostic|test|copy/i);
    assert.deepEqual(value.match(/\{\w+\}/g), MESSAGES.en[key].match(/\{\w+\}/g));
  }
});

test('ordinary settings, reset, hide/restore, context menu and outside dismissal still work', t => {
  const { widget: w, document, saved, scopes } = fixture(t);
  w.button.dispatch('contextmenu'); assert.equal(w.panel.hidden, false);
  w.scope.value = 'current'; w.scope.dispatch('change'); w.scope.dispatch('change');
  assert.deepEqual(scopes, ['current']); assert.equal(w.preferences.scope, 'current');
  w.range.value = '125'; w.range.dispatch('input'); assert.equal(w.preferences.scale, 1.25); assert.equal(w.range.getAttribute('aria-valuetext'), '125%');
  w.motion.checked = false; w.motion.dispatch('change'); assert.equal(w.host.dataset.motion, 'false');
  w.sleep.value = '30000'; w.sleep.dispatch('change'); assert.equal(w.machine.sleepAfterMs, 30000);
  w.preferences.x = 100; w.preferences.y = 100; w.root.querySelector('.reset').dispatch('click');
  assert.equal(w.preferences.x, null); assert.equal(w.preferences.y, null);
  w.root.querySelector('.hide').dispatch('click'); assert.equal(w.preferences.hidden, true); assert.equal(w.panel.hidden, true); assert.equal(w.pet.hidden, true); assert.equal(w.restore.hidden, false); assert.equal(document.activeElement, w.restore);
  w.restore.dispatch('click'); assert.equal(w.preferences.hidden, false); assert.equal(w.pet.hidden, false); assert.equal(w.restore.hidden, true); assert.equal(document.activeElement, w.button);
  w.button.dispatch('click', { detail: 1 }); assert.equal(w.machine.view(1000).greeting, true);
  w.openPanel(); document.dispatch('pointerdown', { composedPath: () => [] }); assert.equal(w.panel.hidden, true);
  assert.equal(saved.at(-1).hidden, false);
});

test('keyboard movement and pointer dragging preserve capture, position and persistence', t => {
  const { widget: w, saved } = fixture(t);
  const x = w.position.x;
  w.button.dispatch('keydown', { key: 'ArrowLeft', shiftKey: true }); assert.equal(w.position.x, x - 20);
  const origin = { ...w.position };
  w.button.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 100 });
  w.button.dispatch('pointermove', { pointerId: 1, clientX: 80, clientY: 70 });
  assert.equal(w.pet.dataset.dragging, 'true'); assert.equal(w.position.x, origin.x - 20); assert.equal(w.position.y, origin.y - 30);
  w.button.dispatch('pointerup', { pointerId: 1 }); assert.equal(w.drag, null); assert.equal(w.button.hasPointerCapture(1), false); assert.equal(saved.at(-1).x, w.position.x);
  w.button.dispatch('click', { detail: 1 }); assert.equal(w.machine.view(1000).greeting, false);
});

test('ordinary snapshots retain working count, waiting, celebration and error behavior', t => {
  const { widget: w } = fixture(t);
  const base = { sessionId: 'release', available: true, running: true, pending: false, workingCount: 2 };
  w.update(base); assert.equal(w.pet.dataset.state, 'working'); assert.equal(w.countText.textContent, '2');
  w.update({ ...base, pending: true }); assert.equal(w.pet.dataset.state, 'waiting'); assert.equal(w.countOverlay.hidden, true);
  w.update({ ...base, workingCount: 1, notice: { id: 'completed', reason: 'completed' } }); assert.equal(w.pet.dataset.state, 'celebrate');
  const messageKey = w.machine.view(1000).noticeKey;
  w.setLanguage('zh'); assert.equal(w.bubbleText.textContent, translate('zh', messageKey)); assert.equal(w.pet.dataset.state, 'celebrate');
  w.update({ ...base, notice: { id: 'error', reason: 'error' } }); assert.equal(w.pet.dataset.state, 'error');
  w.update(base); assert.equal(w.pet.dataset.state, 'working');
});

test('disposal cleans ordinary listeners once and ignores late updates', t => {
  const { widget: w } = fixture(t); let cleanups = 0;
  w.cleanups.push(() => cleanups++); w.dispose(); w.dispose();
  assert.equal(cleanups, 1); assert.equal(w.root.children.length, 0);
  assert.equal(w.button.listeners.get('click').size, 0);
  const snapshot = w.machine.snapshot; w.update({ available: true, running: true }); assert.equal(w.machine.snapshot, snapshot);
});
