import { WhaleWidget } from './widget.js';
import { normalizeLanguage } from './i18n.js';
import { SessionAggregate } from './global-state.js';
import { observeGlobalEvents } from './bridge-client.js';
/** Only this file knows DSH's 0.1.6-alpha.2 client contract. No private DOM/API routes. */
export function readDshLanguage(locale) {
  try { return normalizeLanguage(locale?.getSnapshot?.().active); } catch { return 'en'; }
}
export function observeDshLanguage(locale, onLanguage) {
  let alive = true, previous;
  const publish = () => {
    if (!alive) return;
    const next = readDshLanguage(locale);
    if (next !== previous) { previous = next; onLanguage(next); }
  };
  const unsubscribe = locale?.subscribe?.(publish) || (() => {});
  publish();
  return () => { if (!alive) return; alive = false; unsubscribe(); };
}
export function selectedSessionId(snapshot) {
  return Object.values(snapshot?.byId || {}).find(row => (row?.retainedBy?.mainView ?? 0) > 0)?.id;
}

/** Observe new live turn boundaries only. Baselines/replay are never celebrations. */
export function observeSession(sessions, sessionId, { onBoundary, onReset = () => {}, onHealth = () => {} }) {
  const reference = sessions.retain(sessionId, { source: 'whalePet' });
  let alive = true;
  let stopEvents = () => {}, stopState = () => {};
  let seenSeq = -1;
  let healthy;
  const emitHealth = next => { if (healthy !== next) { healthy = next; onHealth(next); } };
  const cleanup = () => {
    if (!alive) return;
    alive = false;
    try { stopEvents(); } finally { try { stopState(); } finally { reference.release(); } }
  };
  try {
    const session = reference.binding.session;
    const source = session.eventSource;
    if (!source?.getSnapshot || !source?.subscribe) throw new Error('Unsupported session event source');
    const initial = source.getSnapshot();
    let revision = initial.revision;
    const advance = entries => {
      for (const item of entries || []) {
        if (item.type === 'event' && Number.isFinite(item.event?.seq)) seenSeq = Math.max(seenSeq, item.event.seq);
      }
    };
    advance(initial.entries);
    const health = () => {
      try {
        const snapshot = session.getSnapshot?.();
        emitHealth(snapshot?.openState === 'open' && snapshot.removed !== true);
      } catch { emitHealth(false); }
    };
    stopEvents = source.subscribe(() => {
      if (!alive) return;
      try {
        const snapshot = source.getSnapshot();
        health();
        if (revision === snapshot.revision) return;
        revision = snapshot.revision;
        const change = snapshot.change;
        if (change?.kind !== 'append') {
          advance(change?.entries);
          if (change?.entry) advance([change.entry]);
          if (change?.kind === 'replace') onReset();
          return;
        }
        for (const item of change.entries || []) {
          if (item.type !== 'event') continue;
          const event = item.event;
          if (!Number.isFinite(event?.seq) || event.seq <= seenSeq) continue;
          seenSeq = event.seq;
          // Never read, store or forward assistant/user text, tools, or attachments.
          if (event.type === 'turn/start' || event.type === 'turn/end') onBoundary({
            sessionId, id: `${sessionId}:${event.seq}`, type: event.type,
            reason: event.type === 'turn/end' ? event.data?.reason?.kind : undefined,
          });
        }
      } catch { emitHealth(false); }
    });
    if (typeof session.subscribe === 'function') stopState = session.subscribe(() => { if (alive) health(); });
    health();
    Promise.resolve(reference.ready).then(() => { if (alive) health(); }, () => { if (alive) emitHealth(false); });
  } catch (error) { cleanup(); throw error; }
  return cleanup;
}

/** Lifecycle wiring kept outside React so reconnect/teardown can be contract-tested. */
export function connectWhaleState(ctx, widget, getProjection, observeEvents = observeGlobalEvents) {
  const aggregate = new SessionAggregate();
  let alive = true;
  const publish = () => {
    if (!alive) return;
    const projection = getProjection();
    widget.update(aggregate.update({
      ...projection,
      currentSessionId: selectedSessionId(projection.catalog),
      scope: widget.preferences.scope,
      connected: ctx.connection.state.getSnapshot() === 'connected',
    }));
  };
  publish();
  const stopConnection = ctx.connection.state.subscribe(publish);
  let stopEvents = () => {};
  try {
    stopEvents = observeEvents(ctx, {
      onReset(baseline) { if (alive) { aggregate.reset(baseline?.identities); publish(); } },
      onHealth(ready) {
        if (!alive) return;
        if (widget.host) widget.host.dataset.completionFeed = ready ? 'ready' : 'unavailable';
        widget.setCompletionFeed?.(ready);
      },
      onBoundary(event) {
        if (!alive) return;
        publish();
        widget.update(aggregate.boundary(event));
      },
    });
  } catch {
    if (widget.host) widget.host.dataset.completionFeed = 'unavailable';
    widget.setCompletionFeed?.(false);
    console.warn('[whale-pet] Completion feed unavailable; global work and waiting remain observable.');
  }
  return {
    publish,
    dispose() { if (!alive) return; alive = false; try { stopEvents(); } finally { stopConnection(); aggregate.reset(); } },
  };
}

export function createPlugin(require, assets, css, fonts) {
  const React = require('react');
  const { createPortal } = require('react-dom');
  const { IconChevronDownOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives');
  const h = React.createElement;
  return {
    inject: ['slots', 'sessions', 'connection', 'locale', 'remote'],
    apply(ctx) {
      function useWhale(onScopeChange = () => {}) {
        const element = React.useRef(null);
        const widget = React.useRef(null);
        const [iconTargets, setIconTargets] = React.useState([]);
        const changeScope = React.useRef(onScopeChange);
        changeScope.current = onScopeChange;
        React.useEffect(() => {
          const instance = new WhaleWidget(element.current, { assets, css, fonts, language: readDshLanguage(ctx.locale), onScopeChange: scope => changeScope.current(scope) });
          widget.current = instance;
          setIconTargets([...instance.root.querySelectorAll('.select-arrow')]);
          let stopLanguage = () => {};
          try { stopLanguage = observeDshLanguage(ctx.locale, language => instance.setLanguage(language)); }
          catch { instance.setLanguage('en'); }
          return () => { stopLanguage(); instance.dispose(); if (widget.current === instance) widget.current = null; };
        }, []);
        const icons = iconTargets.map((target, index) => createPortal(h(IconChevronDownOutlineRegular, { size: 14 }), target, `whale-chevron-${index}`));
        return [element, widget, icons];
      }
      function QuietPet() {
        const [element, , icons] = useWhale();
        return h(React.Fragment, null, h('div', { ref: element, 'data-whale-pet': 'degraded' }), icons);
      }
      function ConnectedPet({ useSessions, useSessionStatus }) {
        const catalog = useSessions(snapshot => snapshot);
        const statuses = useSessionStatus(map => map);
        const latest = React.useRef({ catalog, statuses });
        latest.current = { catalog, statuses };
        const controller = React.useRef(null);
        const push = () => controller.current?.publish();
        const [element, widget, icons] = useWhale(push);
        React.useEffect(() => {
          const connection = connectWhaleState(ctx, widget.current, () => latest.current);
          controller.current = connection;
          return () => { connection.dispose(); if (controller.current === connection) controller.current = null; };
        }, []);
        React.useEffect(push, [catalog, statuses]);
        return h(React.Fragment, null, h('div', { ref: element, 'data-whale-pet': 'connected' }), icons);
      }
      class Boundary extends React.Component {
        constructor(props) { super(props); this.state = { failed: false }; }
        static getDerivedStateFromError() { return { failed: true }; }
        componentDidCatch() { console.warn('[whale-pet] Unsupported client state; resting mode enabled.'); }
        render() { return this.state.failed ? h(QuietPet) : this.props.children; }
      }
      function PetRoot(props) {
        const supported = typeof props.useSessions === 'function' && typeof props.useSessionStatus === 'function';
        return h(Boundary, null, supported ? h(ConnectedPet, props) : h(QuietPet));
      }
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'whale-pet', order: 90,
      }, PetRoot));
    },
  };
}
