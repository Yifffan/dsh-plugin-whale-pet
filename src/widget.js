import { PetStateMachine, cleanPreferences, clampPosition, STORAGE_KEY } from './state.js';
import { normalizeLanguage, translate } from './i18n.js';
import { acquireBubbleFonts } from './fonts.js';
import { bubbleLayout } from './bubble-layout.js';
import { attachBubbleSurface } from './bubble-surface.js';
import { WhaleDiagnostics } from './diagnostics.js';

/** Framework-independent UI shared by the real plugin and offline preview. */
export class WhaleWidget {
  constructor(host, { assets, css, fonts, storage, language = 'en', now = () => Date.now(), onView = () => {}, onScopeChange = () => {} } = {}) {
    this.host = host;
    this.language = normalizeLanguage(language);
    this.originalLang = host.getAttribute('lang');
    this.now = now;
    this.onView = onView;
    this.onScopeChange = onScopeChange;
    this.assets = assets;
    this.cleanups = [];
    this.disposed = false;
    this.diagnostics = new WhaleDiagnostics();
    this.diagnosticsRequest = 0;
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
        <div class="setting"><label for="whale-sleep" data-i18n="setting.sleep"></label><span class="select-control"><select id="whale-sleep"><option value="30000" data-i18n="setting.seconds30"></option><option value="120000" data-i18n="setting.minutes2"></option><option value="300000" data-i18n="setting.minutes5"></option></select><span class="select-arrow" aria-hidden="true"></span></span></div>
        <div class="panel-actions"><button class="action reset" type="button" data-i18n="action.reset"></button><button class="action hide" type="button" data-i18n="action.hide"></button></div>
        <button class="action diagnostics-toggle" type="button" aria-expanded="false" aria-controls="whale-diagnostics" data-i18n="diagnostics.title"></button>
        <section id="whale-diagnostics" class="diagnostics" aria-labelledby="whale-diagnostics-title" hidden>
          <h2 id="whale-diagnostics-title" data-i18n="diagnostics.title"></h2>
          <p class="diagnostics-notice" id="whale-diagnostics-privacy" data-i18n="diagnostics.privacy"></p>
          <textarea class="diagnostics-text" readonly spellcheck="false" wrap="off" data-i18n-aria="diagnostics.json" aria-describedby="whale-diagnostics-privacy"></textarea>
          <div class="diagnostics-actions"><button class="action diagnostics-refresh" type="button" data-i18n="diagnostics.refresh"></button><button class="action diagnostics-copy" type="button" data-i18n="diagnostics.copy"></button></div>
          <p class="diagnostics-status" role="status" aria-live="polite" aria-atomic="true"></p>
        </section>
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
    this.diagnosticsPanel = this.root.querySelector('.diagnostics');
    this.diagnosticsToggle = this.root.querySelector('.diagnostics-toggle');
    this.diagnosticsText = this.root.querySelector('.diagnostics-text');
    this.diagnosticsRefresh = this.root.querySelector('.diagnostics-refresh');
    this.diagnosticsCopy = this.root.querySelector('.diagnostics-copy');
    this.diagnosticsStatus = this.root.querySelector('.diagnostics-status');
    this.completionFeedReady = false;
    this.restore = this.root.querySelector('.restore');
    this.range = this.root.querySelector('#whale-size');
    this.motion = this.root.querySelector('#whale-motion');
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
      else { this.machine.touch(this.now()); this.paint(); }
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
    this.listen(this.diagnosticsToggle, 'click', () => {
      if (this.diagnosticsPanel.hidden) this.openDiagnostics();
      else this.closeDiagnostics();
    });
    this.listen(this.diagnosticsRefresh, 'click', () => { void this.refreshDiagnostics(); });
    this.listen(this.diagnosticsCopy, 'click', () => { void this.refreshDiagnostics(true); });
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
    if (this.diagnosticsStatusKey) this.setDiagnosticsStatus(this.diagnosticsStatusKey);
    // Update text in place: keep pointer capture, focus, timers, phase and preferences.
    this.paint();
    if (!this.panel.hidden) this.positionPanel();
  }
  listen(target, event, callback, options) {
    target.addEventListener(event, callback, options);
    this.cleanups.push(() => target.removeEventListener(event, callback, options));
  }
  save() { try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.preferences)); } catch { /* storage denial does not break the pet */ } }
  visibility() { this.host.dataset.paused = String(document.hidden || this.preferences.hidden); }
  applyPreferences() {
    this.range.value = String(Math.round(this.preferences.scale * 100));
    this.root.querySelector('.size-value').textContent = `${this.range.value}%`;
    this.range.setAttribute('aria-valuetext', `${this.range.value}%`);
    this.range.style.setProperty('--range-progress', `${(Number(this.range.value) - Number(this.range.min)) / (Number(this.range.max) - Number(this.range.min)) * 100}%`);
    this.scope.value = this.preferences.scope;
    this.motion.checked = this.preferences.motion;
    this.sleep.value = String(this.preferences.sleepAfterMs);
    this.machine.sleepAfterMs = this.preferences.sleepAfterMs;
    this.host.dataset.motion = String(this.preferences.motion);
    this.pet.hidden = this.preferences.hidden; this.restore.hidden = !this.preferences.hidden;
    if (this.preferences.hidden) this.closePanel(false);
    this.syncDiagnosticsView();
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
  setCompletionFeed(ready) {
    if (this.disposed) return;
    // Keep health inspectable for troubleshooting, never as user-facing menu copy.
    this.completionFeedReady = ready === true;
    this.host.dataset.completionFeed = this.completionFeedReady ? 'ready' : 'unavailable';
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
    this.closeDiagnostics(false);
    this.panel.hidden = true;
    if (focus) this.button.focus();
  }
  syncDiagnosticsView(view = this.machine.view(this.now())) {
    const options = { hidden: this.preferences.hidden, scope: this.preferences.scope };
    const key = JSON.stringify([view, options]);
    if (key === this.diagnosticsViewKey) return;
    this.diagnosticsViewKey = key;
    this.diagnostics.setView(view, options);
  }
  setDiagnosticsStatus(key) {
    this.diagnosticsStatusKey = key;
    this.diagnosticsStatus.textContent = key ? translate(this.language, key) : '';
    if (!this.panel.hidden) this.positionPanel();
  }
  setDiagnosticsBusy(busy) {
    this.diagnosticsRefresh.disabled = busy;
    this.diagnosticsCopy.disabled = busy;
    this.diagnosticsText.setAttribute('aria-busy', String(busy));
  }
  openDiagnostics() {
    if (this.disposed) return;
    this.diagnosticsPanel.hidden = false;
    this.diagnosticsToggle.setAttribute('aria-expanded', 'true');
    this.positionPanel();
    this.diagnosticsText.focus();
    void this.refreshDiagnostics();
  }
  closeDiagnostics(focus = true) {
    ++this.diagnosticsRequest;
    this.cancelDiagnosticsRefresh?.();
    this.diagnosticsPanel.hidden = true;
    this.diagnosticsToggle.setAttribute('aria-expanded', 'false');
    this.setDiagnosticsBusy(false);
    if (focus) { this.positionPanel(); this.diagnosticsToggle.focus(); }
  }
  async refreshDiagnostics(copy = false) {
    if (this.disposed || this.panel.hidden || this.diagnosticsPanel.hidden) return;
    this.cancelDiagnosticsRefresh?.();
    const request = ++this.diagnosticsRequest;
    const current = () => !this.disposed && request === this.diagnosticsRequest && !this.panel.hidden && !this.diagnosticsPanel.hidden;
    this.setDiagnosticsBusy(true);
    this.setDiagnosticsStatus('diagnostics.refreshing');
    try {
      let refreshed = true;
      const callback = this.onDiagnosticsRefresh;
      if (typeof callback === 'function') {
        // Read-only host queries are explicit, bounded and never coupled to paint.
        // Handle late rejection even after close/disposal or our timeout wins.
        refreshed = await new Promise(resolve => {
          let settled = false;
          const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (this.cancelDiagnosticsRefresh === cancel) this.cancelDiagnosticsRefresh = null;
            resolve(result);
          };
          const cancel = () => finish(false);
          const timer = setTimeout(cancel, 4000);
          this.cancelDiagnosticsRefresh = cancel;
          Promise.resolve().then(() => current() ? callback.call(this) : undefined).then(() => finish(true), () => finish(false));
        });
      }
      if (!current()) return;
      // Snapshot text changes only on an explicit open, refresh or copy, so a
      // normal reply and the 500ms paint timer cannot disturb manual selection.
      this.diagnosticsText.value = this.diagnostics.text();
      this.setDiagnosticsStatus(refreshed ? 'diagnostics.updated' : 'diagnostics.refreshError');
      if (copy) {
        try {
          if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('clipboard unavailable');
          await navigator.clipboard.writeText(this.diagnosticsText.value);
          if (current()) this.setDiagnosticsStatus(refreshed ? 'diagnostics.copied' : 'diagnostics.copiedLocal');
        } catch {
          if (!current()) return;
          this.diagnosticsText.focus();
          this.diagnosticsText.select();
          this.setDiagnosticsStatus(refreshed ? 'diagnostics.manualCopy' : 'diagnostics.manualCopyLocal');
        }
      }
    } catch {
      // Never display raw transport/clipboard errors: they may contain IDs.
      if (current()) this.setDiagnosticsStatus('diagnostics.unavailable');
    } finally {
      if (current()) this.setDiagnosticsBusy(false);
    }
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
  update(snapshot) { if (!this.disposed) { this.machine.update(snapshot, this.now()); this.paint(); } }
  paint() {
    if (this.disposed) return;
    const view = this.machine.view(this.now());
    this.syncDiagnosticsView(view);
    if (this.pet.dataset.state !== view.state || !this.image.getAttribute('src')) {
      this.pet.dataset.state = view.state; this.image.src = this.assets[view.state];
    }
    this.pet.dataset.notice = String(Boolean(view.noticeKey || ['waiting', 'celebrate', 'error'].includes(view.state) || view.greeting));
    this.pet.dataset.touch = String(Boolean(view.greeting && !view.noticeKey && !['waiting', 'working', 'celebrate', 'error'].includes(view.state)));
    const count = view.state === 'working' && Number.isFinite(view.workingCount) ? Math.max(0, Math.floor(view.workingCount)) : 0;
    this.countOverlay.toggleAttribute('hidden', count === 0);
    this.countText.textContent = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
    const messageKey = view.noticeKey || (view.greeting && view.state === 'resting' ? 'pet.greeting' : view.messageKey);
    const message = translate(this.language, messageKey);
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
    ++this.diagnosticsRequest;
    this.cancelDiagnosticsRefresh?.();
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    this.root.replaceChildren();
    delete this.host.dataset.paused; delete this.host.dataset.motion;
    if (this.originalLang === null) this.host.removeAttribute('lang');
    else this.host.setAttribute('lang', this.originalLang);
  }
}
