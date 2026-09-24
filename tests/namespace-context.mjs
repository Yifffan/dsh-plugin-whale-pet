import assert from 'node:assert/strict';

// Narrow Cordis capability/lifetime fixture. It deliberately rejects the bug
// that permissive plain-object Remote mocks used to accept.
export function withNamespaceInjection(ctx, namespace = ctx.remote?.whalePet) {
  let available = true;
  const children = new Set();
  ctx.namespace = namespace;
  if (ctx.remote) Object.defineProperty(ctx.remote, 'whalePet', {
    configurable: true,
    get() { throw new Error('cannot get property "remote.whalePet" without inject'); },
  });
  ctx.inject = (keys, callback) => {
    assert.deepEqual(keys, ['remote.whalePet']);
    let disposed = false, active = false, cleanups = [];
    const deactivate = () => {
      if (!active) return;
      active = false;
      const current = cleanups; cleanups = [];
      for (const cleanup of current.reverse()) cleanup();
    };
    const fiber = {
      activate() {
        if (disposed || active || !available) return;
        active = true;
        const child = Object.create(ctx);
        Object.defineProperty(child, 'remote', { value: { whalePet: namespace } });
        child.effect = factory => {
          const cleanup = factory();
          cleanups.push(cleanup);
          return cleanup;
        };
        callback(child);
      },
      deactivate,
      dispose() {
        if (disposed) return Promise.resolve();
        disposed = true;
        children.delete(fiber);
        deactivate();
        return Promise.resolve();
      },
    };
    children.add(fiber);
    fiber.activate();
    return fiber;
  };
  ctx.setNamespaceAvailable = value => {
    available = value;
    for (const child of [...children]) value ? child.activate() : child.deactivate();
  };
  ctx.namespaceChildren = () => children.size;
  return ctx;
}
