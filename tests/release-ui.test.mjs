import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WhaleWidget } from '../src/widget.js';
import { MESSAGES, translate } from '../src/i18n.js';

const source = readFileSync(new URL('../src/widget.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/pet.css', import.meta.url), 'utf8');

// Minimal DOM fixture exercises the actual constructor/event handlers without a browser.
// Native layout, pointer delivery and rendering are checked by release-browser-check.mjs.
function fixture(t, language = 'en') {
  let document;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.attributes = {}; this.dataset = {}; this.children = [];
      this.hidden = false; this.value = ''; this.textContent = ''; this.checked = false;
      this.ownerDocument = document; this.listeners = new Map(); this.captures = new Set();
      this.style = { setProperty(key, value) { this[key] = value; } };
      this.offsetWidth = 156; this.offsetHeight = 156;
    }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
      if (key === 'hidden') this.hidden = true;
      if (['min', 'max', 'value'].includes(key)) this[key] = value;
    }
    getAttribute(key) { return this.attributes[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; }
    toggleAttribute(key, force) { if (force) this.setAttribute(key, ''); else { this.removeAttribute(key); if (key === 'hidden') this.hidden = false; } }
    append(...nodes) { this.children.push(...nodes); }
    prepend(node) { this.children.unshift(node); }
    remove() {}
    replaceChildren() { this.children = []; }
    cloneNode() { return this; }
    focus() { document.activeElement = this; }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    dispatch(type, details = {}) {
      const event = { detail: 0, preventDefault() {}, stopPropagation() {}, ...details };
      for (const callback of this.listeners.get(type) || []) callback(event);
    }
    querySelectorAll(selector) {
      const matches = node => selector.startsWith('.') ? (node.attributes.class || '').split(' ').includes(selector.slice(1))
        : selector.startsWith('#') ? node.attributes.id === selector.slice(1)
        : selector.startsWith('[') ? Object.hasOwn(node.attributes, selector.slice(1, -1)) : node.tagName === selector;
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    set innerHTML(html) {
      this.content = new Element('fragment');
      for (const [, tag, attributes] of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
        const node = new Element(tag);
        for (const [, key, value] of attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(key, value ?? '');
        this.content.append(node);
      }
    }
  }
  document = new Element('document');
  document.documentElement = new Element('html');
  document.createElement = tag => new Element(tag);
  document.createElementNS = (_namespace, tag) => new Element(tag);
  document.hidden = false;
  const window = new Element('window');
  window.innerWidth = 1100; window.innerHeight = 850;
  document.defaultView = window;
  const globals = { document, window, getComputedStyle: () => ({ getPropertyValue: () => '', paddingBottom: '17', paddingLeft: '9', paddingRight: '9', paddingTop: '20' }) };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  // Any accidental clipboard access fails, even if the implementation catches it.
  let clipboardReads = 0;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get clipboard() { clipboardReads++; throw Error('No clipboard access in formal UI'); } } });
  t.after(() => { if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator; });
  const saved = [], scopes = [];
  const host = new Element(); host.ownerDocument = document;
  host.attachShadow = () => (host.shadowRoot = new Element('shadow'));
  const widget = new WhaleWidget(host, { language, assets: Object.fromEntries(['resting', 'working', 'waiting', 'celebrate', 'sleeping', 'error'].map(state => [state, `${state}.svg`])), css,
    storage: { getItem: () => null, setItem: (_key, value) => saved.push(JSON.parse(value)) }, now: () => 1000, onScopeChange: scope => scopes.push(scope) });
  t.after(() => { widget.dispose(); assert.equal(clipboardReads, 0); });
  return { widget, document, window, saved, scopes };
}

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
    assert.deepEqual(widget.root.querySelectorAll('input').map(input => input.getAttribute('id')), ['whale-size', 'whale-motion']);
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
