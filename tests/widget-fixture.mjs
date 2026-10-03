import { WhaleWidget } from '../src/widget.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const css = readFileSync(new URL('../src/pet.css', import.meta.url), 'utf8');

// Minimal DOM fixture exercises the actual constructor/event handlers without a browser.
// Native layout, pointer delivery and rendering are checked by release-browser-check.mjs.
/**
 * Build one widget on the minimal DOM.
 * @param t - node:test context for global restoration.
 * @param language - UI language.
 * @param options - `now` clock and `onBalanceWanted` hook for balance tests.
 */
export function fixture(t, language = 'en', { now = () => 1000, onBalanceWanted = () => {} } = {}) {
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
    storage: { getItem: () => null, setItem: (_key, value) => saved.push(JSON.parse(value)) }, now, onBalanceWanted, onScopeChange: scope => scopes.push(scope) });
  t.after(() => { widget.dispose(); assert.equal(clipboardReads, 0); });
  return { widget, document, window, saved, scopes };
}
