import * as WhaleBridgeContract from '../lib/remote.js';

// Shared only for overlapping mounts of this widget; never duplicate a Remote method.
const whaleRemoteMounts = new WeakMap();
function acquireWhaleRemote(ctx, remote) {
  // Cordis returns a fresh traced service wrapper on each get; root Context is stable.
  const owner = ctx.root ?? remote;
  let entry = whaleRemoteMounts.get(owner);
  if (!entry || entry.closed || entry.failed) {
    const previous = entry?.closing;
    entry = { refs: 0, closed: false, failed: false };
    entry.ready = Promise.resolve(previous).catch(() => {}).then(() => remote.$mount(WhaleBridgeContract.TYPERT_REMOTE));
    entry.ready.catch(() => { entry.failed = true; });
    whaleRemoteMounts.set(owner, entry);
  }
  entry.refs += 1;
  let released = false;
  return {
    ready: entry.ready,
    release() {
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs !== 0) return;
      entry.closing = entry.ready.then(async unmount => {
        if (entry.refs !== 0) return;
        entry.closed = true;
        await unmount();
      }).catch(() => {}).finally(() => {
        if ((entry.closed || entry.failed) && whaleRemoteMounts.get(owner) === entry) whaleRemoteMounts.delete(owner);
      });
    },
  };
}

/**
 * Observe live global boundaries. Returns synchronous, idempotent cleanup.
 * onBoundary({sessionId,id,seq,type,reason?,time,hostEpoch,streamSeq,isSubagent?})
 * onReset({reason?,hostEpoch?,streamSeq?,identities?}) discards unplayed notifications.
 * onHealth(boolean) concerns this completion stream only, NOT root running/pending.
 */
export function observeGlobalEvents(ctx, { onBoundary, onReset, onHealth } = {}) {
  let disposed = false;
  let generationKey;
  let revision = 0;
  let run;
  let retry;
  let retryDelay = 1000;
  let health;
  const subscriptions = [];
  const call = (fn, value) => { if (!disposed) { try { fn?.(value); } catch { /* UI callbacks cannot poison transport. */ } } };
  const setHealth = value => { if (health !== value) { health = value; call(onHealth, value); } };
  const remote = ctx.remote;
  if (!remote || typeof remote.$mount !== 'function') {
    setHealth(false);
    call(onReset, { reason: 'unavailable' });
    return () => { disposed = true; };
  }
  const lease = acquireWhaleRemote(ctx, remote);
  const connected = () => ctx.connection?.state?.getSnapshot?.() === 'connected';
  const retire = () => {
    revision += 1;
    if (retry !== undefined) { clearTimeout(retry); retry = undefined; }
    if (run) {
      const old = run; run = undefined;
      old.abort.abort();
      try { Promise.resolve(old.handle?.dispose?.()).catch(() => {}); } catch { /* already withdrawn */ }
    }
  };
  const start = () => {
    if (disposed || !connected()) return;
    retire();
    const token = revision;
    const current = { abort: new AbortController(), handle: undefined };
    run = current;
    setHealth(false);
    call(onReset, { reason: 'connecting' });
    const active = () => !disposed && token === revision && connected();
    void (async () => {
      let epoch;
      let watermark = -1;
      try {
        await lease.ready;
        if (!active()) return;
        current.handle = remote.whalePet.watch(current.abort.signal);
        for await (const value of current.handle) {
          if (!active()) return;
          const frame = WhaleBridgeContract.WHALE_FRAME_SCHEMA.parse(value);
          if (frame.type === 'baseline') {
            epoch = frame.hostEpoch;
            watermark = frame.streamSeq;
            call(onReset, frame);
            setHealth(true);
            retryDelay = 1000;
            continue;
          }
          if (epoch === undefined || frame.hostEpoch !== epoch) throw new Error('Bridge baseline required');
          if (frame.streamSeq <= watermark) continue;
          if (frame.streamSeq !== watermark + 1) throw new Error('Bridge sequence gap');
          watermark = frame.streamSeq;
          call(onBoundary, { ...frame, id: `${epoch}:${frame.streamSeq}` });
        }
      } catch { /* health/reset describe failure; never forward transport details or data. */ }
      finally {
        current.abort.abort();
        try { await current.handle?.dispose?.(); } catch { /* already closed */ }
        if (active()) {
          run = undefined;
          setHealth(false);
          call(onReset, { reason: 'stream-ended' });
          retry = setTimeout(() => { retry = undefined; start(); }, retryDelay);
          retryDelay = Math.min(10000, retryDelay * 2);
        }
      }
    })();
  };
  const reconcile = () => {
    if (disposed) return;
    const key = connected() ? (ctx.connection?.generation?.getSnapshot?.() ?? true) : null;
    if (key === generationKey) return;
    generationKey = key;
    retryDelay = 1000;
    retire();
    setHealth(false);
    call(onReset, { reason: key === null ? 'disconnected' : 'generation' });
    if (key !== null) start();
  };
  for (const store of [ctx.connection?.state, ctx.connection?.generation]) {
    if (typeof store?.subscribe === 'function') subscriptions.push(store.subscribe(reconcile));
  }
  reconcile();
  return () => {
    if (disposed) return;
    disposed = true;
    retire();
    for (const unsubscribe of subscriptions) unsubscribe();
    lease.release();
  };
}
