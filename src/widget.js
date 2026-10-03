import { PetStateMachine, cleanPreferences, clampPosition, STORAGE_KEY } from './state.js';
import { normalizeLanguage, translate } from './i18n.js';
import { acquireBubbleFonts } from './fonts.js';
import { bubbleLayout } from './bubble-layout.js';
import { attachBubbleSurface } from './bubble-surface.js';

/** How long a reading stays fresh enough to show without re-reading first. */
export const BALANCE_STALE_MS = 120000;
const CURRENCY_SIGNS = Object.freeze({ CNY: '¥', USD: '$', EUR: '€', JPY: '¥', GBP: '£' });

/**
 * Format one Host wallet reading for the bubble. Returns undefined for every
 * absent or malformed shape so the caller falls back to a phrase, never a guess.
 * @param {{ currency?: string, total?: string }} wallet - Host wallet entry.
 */
export function formatBalance(wallet) {
  const currency = typeof wallet?.currency === 'string' ? wallet.currency : '';
  const decimal = typeof wallet?.total === 'string' ? wallet.total : '';
  if (!/^-?\d{1,24}(?:\.\d{1,12})?$/.test(decimal)) return undefined;
  const sign = decimal.startsWith('-') ? '-' : '';
  const [whole, fraction] = (sign ? decimal.slice(1) : decimal).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const tail = fraction === undefined ? '' : `.${fraction}`;
  const mark = CURRENCY_SIGNS[currency.toUpperCase()];
  return mark === undefined ? `${sign}${grouped}${tail} ${currency}`.trim() : `${sign}${mark}${grouped}${tail}`;
}

/** Framework-independent UI shared by the real plugin and offline preview. */
export class WhaleWidget {
  constructor(host, { assets, css, fonts, storage, language = 'en', now = () => Date.now(), onView = () => {}, onScopeChange = () => {}, onBalanceWanted = () => {} } = {}) {
    this.host = host;
    this.language = normalizeLanguage(language);
    this.originalLang = host.getAttribute('lang');
    this.now = now;
    this.onView = onView;
    this.onScopeChange = onScopeChange;
    this.onBalanceWanted = onBalanceWanted;
    this.assets = assets;
    this.cleanups = [];
    this.disposed = false;
    this.storage = storage;
    if (storage === undefined) { try { this.storage = window.localStorage; } catch { this.storage = null; } }
    let saved;
    try { saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) || 'null'); } catch { /* corrupt storage is optional */ }
    this.preferences = cleanPreferences(saved);
    this.machine = new PetStateMachine(now(), this.preferences.sleepAfterMs);
    this.root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    this.root.replaceChildren();
    const sheet = document.createElement('style');
    sheet.textContent = css;
    this.root.append(sheet);
    // All HTML is static; SVGs are validated at build time and rendered as inert images.
    const template = document.createElement('template');
    template.innerHTML = `
      <div class="pet" data-state="resting">
        <div class="bubble" aria-hidden="true"><span class="bubble-message"></span></div><span class="ground"></span>
        <button type="button" class="pet-button" aria-label="Whale companion" aria-keyshortcuts="Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight">
          <span class="pet-art">
            <img class="pet-image" alt="" draggable="false" />
            <svg class="working-count" viewBox="0 0 116 89" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" hidden>
              <text class="working-count-text" x="0" y="0" transform="translate(89.5 62.5) skewY(-9) skewX(-17)" text-anchor="middle" dominant-baseline="central"></text>
            </svg>
          </span>
        </button>
        <div class="sparkles" aria-hidden="true"><span>✦</span><span>✧</span><span>✦</span></div>
      </div>
      <section class="panel" role="dialog" data-i18n-aria="panel.aria" hidden>
        <div class="panel-head"><strong data-i18n="panel.title"></strong><button class="close" type="button" data-i18n-aria="panel.close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
        <p class="subtitle"><span data-i18n="panel.subtitle1"></span></p>
        <div class="setting"><label for="whale-scope" data-i18n="setting.scope"></label><span class="select-control"><select id="whale-scope"><option value="current" data-i18n="setting.scopeCurrent"></option><option value="global" data-i18n="setting.scopeGlobal"></option></select><span class="select-arrow" aria-hidden="true"></span></span></div>
        <div class="setting"><label for="whale-size"><span data-i18n="setting.size"></span> <output class="size-value"></output></label><input id="whale-size" type="range" min="65" max="160" step="5" /></div>
        <div class="setting"><label for="whale-motion" data-i18n="setting.motion"></label><input id="whale-motion" type="checkbox" role="switch" /></div>
        <div class="setting"><label for="whale-balance" data-i18n="setting.balance"></label><input id="whale-balance" type="checkbox" role="switch" /></div>
        <div class="setting"><label for="whale-sleep" data-i18n="setting.sleep"></label><span class="select-control"><select id="whale-sleep"><option value="30000" data-i18n="setting.seconds30"></option><option value="120000" data-i18n="setting.minutes2"></option><option value="300000" data-i18n="setting.minutes5"></option></select><span class="select-arrow" aria-hidden="true"></span></span></div>
        <div class="panel-actions"><button class="action reset" type="button" data-i18n="action.reset"></button><button class="action hide" type="button" data-i18n="action.hide"></button></div>
      </section>
      <button class="restore" type="button" hidden data-i18n-aria="action.restoreAria" data-i18n="action.restore"></button>`;
    this.root.append(template.content.cloneNode(true));
    this.pet = this.root.querySelector('.pet');
    this.button = this.root.querySelector('.pet-button');
    this.image = this.root.querySelector('.pet-image');
    this.countOverlay = this.root.querySelector('.working-count');
    this.countText = this.root.querySelector('.working-count-text');
    this.scope = this.root.querySelector('#whale-scope');
    this.bubble = this.root.querySelector('.bubble');
    this.bubbleText = this.root.querySelector('.bubble-message');
    this.bubbleSurface = attachBubbleSurface(this.bubble, () => this.positionBubble());
    this.cleanups.push(() => this.bubbleSurface.dispose());
    this.panel = this.root.querySelector('.panel');
    this.restore = this.root.querySelector('.restore');
    this.range = this.root.querySelector('#whale-size');
    this.motion = this.root.querySelector('#whale-motion');
    this.balance = this.root.querySelector('#whale-balance');
    this.sleep = this.root.querySelector('#whale-sleep');
    const fontLease = acquireBubbleFonts(host.ownerDocument, fonts);
    this.fontsReady = fontLease.ready;
    this.cleanups.push(() => fontLease.release());
    this.fontsReady.then(() => { if (!this.disposed) this.positionBubble(); });
    this.listen(this.image, 'load', () => this.positionBubble());
    this.listen(this.button, 'pointerdown', e => this.pointerDown(e));
    this.listen(this.button, 'pointermove', e => this.pointerMove(e));
    this.listen(this.button, 'pointerup', e => this.pointerEnd(e));
    this.listen(this.button, 'pointercancel', e => this.pointerEnd(e, true));
    this.listen(this.button, 'lostpointercapture', () => { this.drag = null; delete this.pet.dataset.dragging; });
    this.listen(this.button, 'click', e => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      if (e.detail === 0) this.openPanel();
      else {
        this.machine.touch(this.now());
        // A reading older than the freshness window is refreshed on demand, so the
        // opted-in bubble never shows a figure from an unknown moment.
        if (this.preferences.balance && this.now() - (this.balanceFrame?.fetchedAt ?? 0) >= BALANCE_STALE_MS) this.onBalanceWanted();
        this.paint();
      }
    });
    this.listen(this.button, 'contextmenu', e => { e.preventDefault(); this.openPanel(); });
    this.listen(this.button, 'keydown', e => {
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (directions[e.key]) {
        e.preventDefault(); const [dx, dy] = directions[e.key]; const step = e.shiftKey ? 20 : 5;
        this.preferences.x = this.position.x + dx * step;
        this.preferences.y = this.position.y + dy * step;
        this.reposition(); this.save();
      }
    });
    this.listen(this.root.querySelector('.close'), 'click', () => this.closePanel());
    this.listen(this.root, 'keydown', e => {
      if (e.key !== 'Escape' || this.panel.hidden) return;
      // First Escape belongs to the native picker; the next closes the settings.
      if (this.root.querySelector('select:open')) { e.stopPropagation(); return; }
      e.preventDefault(); e.stopPropagation(); this.closePanel();
    });
    this.listen(document, 'pointerdown', e => {
      if (!this.panel.hidden && !e.composedPath().includes(host)) this.closePanel(false);
    });
    this.listen(this.range, 'input', () => {
      this.preferences.scale = Number(this.range.value) / 100; this.applyPreferences(); this.save();
    });
    this.listen(this.scope, 'change', () => {
      const scope = this.scope.value === 'current' ? 'current' : 'global';
      if (scope === this.preferences.scope) return;
      this.preferences.scope = scope; this.save();
      this.onScopeChange(scope); this.paint();
    });
    this.listen(this.motion, 'change', () => {
      this.preferences.motion = this.motion.checked; this.applyPreferences(); this.save();
    });
    this.listen(this.balance, 'change', () => {
      this.preferences.balance = this.balance.checked; this.save(); this.paint();
    });
    this.listen(this.sleep, 'change', () => {
      this.preferences.sleepAfterMs = Number(this.sleep.value);
      this.machine.sleepAfterMs = this.preferences.sleepAfterMs; this.save(); this.paint();
    });
    this.listen(this.root.querySelector('.reset'), 'click', () => {
      this.preferences.x = null; this.preferences.y = null; this.reposition(); this.save();
    });
    this.listen(this.root.querySelector('.hide'), 'click', () => {
      this.preferences.hidden = true; this.closePanel(false); this.applyPreferences(); this.save(); this.restore.focus();
    });
    this.listen(this.restore, 'click', () => {
      this.preferences.hidden = false; this.machine.touch(this.now()); this.applyPreferences(); this.save(); this.button.focus(); this.paint();
    });
    this.listen(window, 'resize', () => this.reposition());
    this.listen(document, 'visibilitychange', () => { this.visibility(); this.paint(); });
    this.listen(window, 'storage', e => {
      if (e.key !== STORAGE_KEY && e.key !== null) return;
      let preferences;
      try { preferences = cleanPreferences(JSON.parse(e.newValue || 'null')); } catch { /* ignore malformed cross-tab data */ return; }
      const changedScope = preferences.scope !== this.preferences.scope;
      this.preferences = preferences; this.applyPreferences();
      if (changedScope) this.onScopeChange(this.preferences.scope);
      this.paint();
    });
    this.interval = setInterval(() => { if (!document.hidden && !this.preferences.hidden) this.paint(); }, 500);
    this.cleanups.push(() => clearInterval(this.interval));
    this.applyPreferences(); this.setLanguage(this.language);
  }
  setLanguage(language) {
    if (this.disposed) return;
    this.language = normalizeLanguage(language);
    this.host.setAttribute('lang', this.language);
    for (const element of this.root.querySelectorAll('[data-i18n]')) {
      element.textContent = translate(this.language, element.dataset.i18n);
    }
    for (const element of this.root.querySelectorAll('[data-i18n-aria]')) {
      element.setAttribute('aria-label', translate(this.language, element.dataset.i18nAria));
    }
    // Update text in place: keep pointer capture, focus, timers, phase and preferences.
    this.paint();
    if (!this.panel.hidden) this.positionPanel();
  }
  listen(target, event, callback, options) {
    target.addEventListener(event, callback, options);
    this.cleanups.push(() => target.removeEventListener(event, callback, options));
  }
  /** Host balances are read through the bridge, never here; the clock is shared for staleness. */
  nowMs() { return this.now(); }
  save() { try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.preferences)); } catch { /* storage denial does not break the pet */ } }
  visibility() { this.host.dataset.paused = String(document.hidden || this.preferences.hidden); }
  applyPreferences() {
    this.range.value = String(Math.round(this.preferences.scale * 100));
    this.root.querySelector('.size-value').textContent = `${this.range.value}%`;
    this.range.setAttribute('aria-valuetext', `${this.range.value}%`);
    this.range.style.setProperty('--range-progress', `${(Number(this.range.value) - Number(this.range.min)) / (Number(this.range.max) - Number(this.range.min)) * 100}%`);
    this.scope.value = this.preferences.scope;
    this.motion.checked = this.preferences.motion;
    this.balance.checked = this.preferences.balance;
    this.sleep.value = String(this.preferences.sleepAfterMs);
    this.machine.sleepAfterMs = this.preferences.sleepAfterMs;
    this.host.dataset.motion = String(this.preferences.motion);
    this.pet.hidden = this.preferences.hidden; this.restore.hidden = !this.preferences.hidden;
    if (this.preferences.hidden) this.closePanel(false);
    this.visibility(); this.reposition();
  }
  reposition() {
    const size = 156 * this.preferences.scale;
    this.pet.style.width = `${size}px`; this.pet.style.height = `${size}px`;
    const top = Math.max(56, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')) || 0);
    this.position = clampPosition(this.preferences.x ?? window.innerWidth - size - 24,
      this.preferences.y ?? window.innerHeight - size - 90, size, size, window.innerWidth, window.innerHeight, top);
    this.pet.style.left = `${this.position.x}px`; this.pet.style.top = `${this.position.y}px`;
    this.positionBubble();
    if (!this.panel.hidden) this.positionPanel();
  }
  positionBubble() {
    if (this.disposed || !this.position || this.preferences.hidden) return;
    this.bubbleSurface.update();
    const size = 156 * this.preferences.scale;
    const button = getComputedStyle(this.button);
    const bottomInset = parseFloat(button.paddingBottom) || 0;
    const artWidth = size - (parseFloat(button.paddingLeft) || 0) - (parseFloat(button.paddingRight) || 0);
    const availableHeight = size - (parseFloat(button.paddingTop) || 0) - bottomInset;
    const ratio = this.image.naturalWidth > 0 && this.image.naturalHeight > 0 ? this.image.naturalWidth / this.image.naturalHeight : 1;
    const layout = bubbleLayout({
      x: this.position.x, y: this.position.y, size,
      width: this.bubble.offsetWidth, height: this.bubble.offsetHeight,
      visibleHeight: Math.min(availableHeight, artWidth / ratio), bottomInset,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      topClearance: Math.max(56, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance')) || 0),
    });
    this.bubble.style.left = `${layout.left - this.position.x}px`;
    this.bubble.style.top = `${layout.top - this.position.y}px`;
    this.bubble.style.bottom = 'auto';
    this.bubble.style.setProperty('--tail-x', `${layout.tailX}px`);
    this.bubble.dataset.side = layout.side;
  }
  positionPanel() {
    const size = 156 * this.preferences.scale;
    const width = this.panel.offsetWidth || Math.min(280, window.innerWidth - 24);
    const height = this.panel.offsetHeight || 310;
    const position = clampPosition(this.position.x + size / 2 - width / 2,
      this.position.y - height - 12, width, height, window.innerWidth, window.innerHeight);
    this.panel.style.left = `${position.x}px`; this.panel.style.top = `${position.y}px`;
  }
  openPanel() { this.panel.hidden = false; this.positionPanel(); this.root.querySelector('.close').focus(); }
  closePanel(focus = true) {
    this.panel.hidden = true;
    if (focus) this.button.focus();
  }
  pointerDown(e) {
    if (e.button !== 0 || !e.isPrimary) return;
    this.suppressClick = false;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, originX: this.position.x, originY: this.position.y, moved: false };
    this.button.setPointerCapture(e.pointerId);
  }
  pointerMove(e) {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
    if (!this.drag.moved) return;
    this.pet.dataset.dragging = 'true';
    this.preferences.x = this.drag.originX + dx; this.preferences.y = this.drag.originY + dy;
    this.reposition();
  }
  pointerEnd(e, cancelled = false) {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    this.suppressClick = this.drag.moved || cancelled;
    if (this.drag.moved) {
      this.preferences.x = this.position.x; this.preferences.y = this.position.y; this.save();
    }
    this.drag = null; delete this.pet.dataset.dragging;
    if (this.button.hasPointerCapture(e.pointerId)) this.button.releasePointerCapture(e.pointerId);
  }
  update(snapshot) { if (!this.disposed) {
    // Session snapshots never carry money; keep the last reading attached so a
    // routine repaint cannot blank an opted-in bubble.
    this.machine.update({ ...snapshot, balance: this.balanceText, balanceStale: this.now() - (this.balanceFrame?.fetchedAt ?? 0) >= BALANCE_STALE_MS }, this.now());
    this.paint();
  } }
  /**
   * Accept one Host balance reading. `available: false` clears the figure so the
   * bubble shows the failure phrase instead of a number from an earlier read.
   * @param {{ available?: boolean, wallets?: Array<{currency?: string, total?: string}>, fetchedAt?: number }} frame - Host reading.
   */
  setBalance(frame) {
    if (this.disposed) return;
    const wallet = frame?.available === true ? frame.wallets?.[0] : undefined;
    this.balanceFrame = frame;
    this.balanceText = wallet === undefined ? undefined : formatBalance(wallet);
    this.machine.snapshot = { ...this.machine.snapshot, balance: this.balanceText, balanceStale: this.now() - (frame?.fetchedAt ?? 0) >= BALANCE_STALE_MS };
    this.paint();
  }
  paint() {
    if (this.disposed) return;
    const view = this.machine.view(this.now());
    if (this.pet.dataset.state !== view.state || !this.image.getAttribute('src')) {
      this.pet.dataset.state = view.state; this.image.src = this.assets[view.state];
    }
    const balanceKey = this.preferences.balance && !view.noticeKey
      ? (view.balance === undefined ? 'pet.balanceUnavailable' : 'pet.balance')
      : undefined;
    this.pet.dataset.notice = String(Boolean(view.noticeKey || balanceKey || ['waiting', 'celebrate', 'error'].includes(view.state) || view.greeting));
    this.pet.dataset.touch = String(Boolean(view.greeting && !view.noticeKey && !balanceKey && !['waiting', 'working', 'celebrate', 'error'].includes(view.state)));
    const count = view.state === 'working' && Number.isFinite(view.workingCount) ? Math.max(0, Math.floor(view.workingCount)) : 0;
    this.countOverlay.toggleAttribute('hidden', count === 0);
    this.countText.textContent = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
    const messageKey = view.noticeKey
      || (balanceKey !== undefined
        ? balanceKey
        : view.greeting && view.state === 'resting' ? 'pet.greeting' : view.messageKey);
    const message = translate(this.language, messageKey, view.balance === undefined ? {} : { amount: view.balance });
    this.bubbleText.textContent = message;
    this.positionBubble();
    // The decorative screen number is announced once, with its actual count,
    // as part of the button label, and never leaks into resting greetings.
    const status = count > 0 ? `${message} ${translate(this.language, count === 1 ? 'pet.workingCountOne' : 'pet.workingCount', { count })}` : message;
    this.button.setAttribute('aria-label', translate(this.language, 'pet.aria', { status }));
    this.onView(view);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    this.root.replaceChildren();
    delete this.host.dataset.paused; delete this.host.dataset.motion;
    if (this.originalLang === null) this.host.removeAttribute('lang');
    else this.host.setAttribute('lang', this.originalLang);
  }
}
