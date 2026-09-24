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
    // $mount installs LOCAL descriptors only; it does not check Host readiness.
    entry.ready = Promise.resolve(previous).catch(() => {}).then(() => remote.$mount(WhaleBridgeContract.TYPERT_REMOTE)).catch(() => {
      entry.failed = true;
      throw new Error('Local whale mount failed');
    });
    // A disconnected observer can own the lease without awaiting it yet.
    entry.ready.catch(() => {});
    whaleRemoteMounts.set(owner, entry);
  }
  entry.refs += 1;
  let released = false;
  return {
    ready: entry.ready,
    get failed() { return entry.failed; },
    release() {
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs !== 0) return;
      // Zero-ref transitions can overlap before ready settles. Serialize their
      // cleanup promises so a successor also waits for the actual unmount, and
      // never call the same unmount twice after a pending lease is reacquired.
      entry.closing = Promise.resolve(entry.closing).then(() => entry.ready).then(async unmount => {
        if (entry.refs !== 0 || entry.closed) return;
        entry.closed = true;
        await unmount();
      }).catch(() => {}).finally(() => {
        if ((entry.closed || entry.failed) && whaleRemoteMounts.get(owner) === entry) whaleRemoteMounts.delete(owner);
      });
    },
  };
}

// A mounted namespace is a separate Cordis capability. Inject it in a child
// AFTER mounting; requiring it in the mount owner would prevent that owner loading.
function acquireWhaleNamespace(ctx, abort) {
  return new Promise((resolve, reject) => {
    let fiber, disposed = false, closing;
    const dispose = () => {
      if (disposed) return closing;
      disposed = true;
      abort.signal.removeEventListener('abort', cancelled);
      closing = Promise.resolve(fiber?.dispose());
      return closing;
    };
    const cancelled = () => {
      reject(new Error('Whale namespace unavailable'));
      Promise.resolve(dispose()).catch(() => {});
    };
    if (abort.signal.aborted) { cancelled(); return; }
    abort.signal.addEventListener('abort', cancelled, { once: true });
    try {
      fiber = ctx.inject(['remote.whalePet'], scope => {
        if (disposed || abort.signal.aborted) return;
        // Dependency withdrawal cancels the established stream.
        scope.effect(() => () => abort.abort(), 'whale-pet.namespace');
        resolve({ service: scope.remote.whalePet, dispose });
      });
      // A synchronously activated child can be cancelled before inject returns.
      if (disposed) Promise.resolve(fiber.dispose()).catch(() => {});
      Promise.resolve(fiber).catch(error => { reject(error); Promise.resolve(dispose()).catch(() => {}); });
    } catch (error) {
      reject(error);
      Promise.resolve(dispose()).catch(() => {});
    }
  });
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
  const reset = value => call(onReset, value);
  const setHealth = value => { if (health !== value) { health = value; call(onHealth, value); } };
  const remote = ctx.remote;
  if (!remote || typeof remote.$mount !== 'function') {
    setHealth(false);
    reset({ reason: 'unavailable' });
    return () => { disposed = true; };
  }
  let lease = acquireWhaleRemote(ctx, remote);
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
    reset({ reason: 'connecting' });
    const active = () => !disposed && token === revision && connected();
    void (async () => {
      let epoch;
      let watermark = -1;
      try {
        // A rejected LOCAL registration is not reusable. Reacquire through the
        // shared root map so simultaneous retries still install one namespace.
        // Ordinary watch failures retain a successful lease and never remount.
        if (lease.failed) {
          lease.release();
          lease = acquireWhaleRemote(ctx, remote);
        }
        await lease.ready;
        if (!active()) return;
        const waiting = setTimeout(() => current.abort.abort(), 3000);
        try { current.scope = await acquireWhaleNamespace(ctx, current.abort); }
        finally { clearTimeout(waiting); }
        if (!active() || current.abort.signal.aborted) return;
        current.handle = current.scope.service.watch(current.abort.signal);
        for await (const value of current.handle) {
          if (!active()) return;
          const frame = WhaleBridgeContract.WHALE_FRAME_SCHEMA.parse(value);
          if (frame.type === 'baseline') {
            epoch = frame.hostEpoch;
            watermark = frame.streamSeq;
            reset(frame);
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
      } catch { /* Fail closed and retry without forwarding errors or raw frames. */ }
      finally {
        current.abort.abort();
        try { await current.handle?.dispose?.(); } catch { /* already closed */ }
        try { await current.scope?.dispose(); } catch { /* already withdrawn */ }
        if (active()) {
          run = undefined;
          setHealth(false);
          reset({ reason: 'stream-ended' });
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
    reset({ reason: key === null ? 'disconnected' : 'generation' });
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
