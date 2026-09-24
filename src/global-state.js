/** Pure cross-session projection. No transcript retention, I/O, navigation or approvals. */
export class SessionAggregate {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.input = { catalog: { byId: {} }, statuses: new Map(), connected: false, scope: 'global' };
    this.records = new Map();
    this.notice = undefined;
    this.scopeKey = undefined;
    this.epoch = 0;
  }
  reset(identities = []) {
    this.records.clear(); this.notice = undefined; this.epoch++;
    for (const identity of Array.isArray(identities) ? identities.slice(0, 4096) : []) {
      if (typeof identity?.sessionId === 'string' && typeof identity.isSubagent === 'boolean') {
        this.record(identity.sessionId).isSubagent = identity.isSubagent;
      }
    }
  }
  update(input) {
    const key = input.scope === 'current' ? `current:${input.currentSessionId || ''}` : 'global';
    if (key !== this.scopeKey || input.connected !== this.input.connected) {
      this.reset(); this.scopeKey = key;
    }
    this.input = input;
    if (input.connected) {
      // Remember observed running, but never infer success from a falling edge.
      for (const [id, status] of input.statuses || []) {
        if (status?.running === true && this.inScope(id)) this.record(id).observed = true;
      }
      for (const [id, record] of this.records) {
        if (record.catalogued && !input.catalog?.byId?.[id]) {
          this.records.delete(id);
          if (this.notice?.sessionId === id) this.notice = undefined;
          continue;
        }
        if (input.catalog?.byId?.[id]) record.catalogued = true;
        this.settle(id, record);
      }
    }
    this.trim();
    return this.snapshot();
  }
  inScope(id) { return this.input.scope !== 'current' || id === this.input.currentSessionId; }
  record(id) {
    let record = this.records.get(id);
    if (!record) {
      record = { seq: -1, observed: false, candidate: undefined, catalogued: Boolean(this.input.catalog?.byId?.[id]) };
      this.records.set(id, record);
    }
    return record;
  }
  subagent(id, record = this.records.get(id)) {
    // Historical subagent sessions are never counted as additional user sessions.
    return this.input.catalog?.byId?.[id]?.origin === 'subagent' || record?.isSubagent === true;
  }
  running(id) {
    const status = this.input.statuses?.get(id);
    return typeof status?.running === 'boolean' ? status.running : this.input.catalog?.byId?.[id]?.running;
  }
  boundary(event) {
    if (!this.input.connected || !event || typeof event.sessionId !== 'string'
      || !this.inScope(event.sessionId) || !Number.isSafeInteger(event.seq)
      || !['turn/start', 'turn/end'].includes(event.type)) return this.snapshot();
    const record = this.record(event.sessionId);
    if (event.seq <= record.seq) return this.snapshot();
    record.seq = event.seq;
    if (typeof event.isSubagent === 'boolean') record.isSubagent = event.isSubagent;
    if (event.type === 'turn/start') {
      record.observed = true; record.candidate = undefined;
      // A fresh turn may start immediately after a complete reply. Keep its
      // already published celebration for the remaining display window.
      if (this.notice?.sessionId === event.sessionId && this.notice.reason !== 'completed') this.notice = undefined;
    } else {
      const accepted = event.reason === 'completed' || event.reason === 'error';
      record.candidate = accepted && record.observed && !this.subagent(event.sessionId, record)
        ? { id: event.id || `${this.epoch}:${event.sessionId}:${event.seq}`, reason: event.reason, at: this.now() } : undefined;
      // A later cancelled/failed turn cannot preserve an earlier success notice.
      // Keep an active error until settle() applies its existing priority rule.
      if (this.notice?.sessionId === event.sessionId
        && (event.reason !== 'completed' || this.notice.reason !== 'error')) this.notice = undefined;
      if (!accepted) record.observed = false;
      this.settle(event.sessionId, record);
    }
    this.trim();
    return this.snapshot();
  }
  settle(id, record) {
    const candidate = record.candidate;
    if (!candidate) return;
    // Error candidates still wait for driver idle and expire rather than report late.
    // A successful complete reply is eligible immediately, even during auto-continue.
    const expired = this.now() - candidate.at > 10000;
    if (expired || this.subagent(id, record)) {
      record.candidate = undefined; record.observed = false; return;
    }
    if (candidate.reason !== 'completed' && this.running(id) !== false) return;
    record.candidate = undefined; record.observed = false;
    // Bounded, non-queued notices: an active error wins over nearby successes.
    if (this.notice?.reason === 'error' && this.now() - this.notice.at < 4200 && candidate.reason !== 'error') return;
    this.notice = { id: candidate.id, reason: candidate.reason, sessionId: id, at: this.now() };
  }
  snapshot() {
    const { catalog, statuses, connected, currentSessionId, scope } = this.input;
    let workingCount = 0, waitingCount = 0, runningCount = 0;
    const ids = new Set([...Object.keys(catalog?.byId || {}), ...(statuses?.keys() || [])]);
    for (const id of ids) {
      if (!this.inScope(id)) continue;
      const status = statuses?.get(id);
      const pending = status?.pendingInteraction != null;
      // A real human request may precede the catalog or belong to a restored child.
      if (pending) waitingCount++;
      const knownMain = Boolean(catalog?.byId?.[id]) || this.records.get(id)?.isSubagent === false;
      if (knownMain && !this.subagent(id) && this.running(id) === true) {
        runningCount++;
        if (!pending) workingCount++;
      }
    }
    const ready = catalog?.phase === 'ready';
    const available = connected === true && (ready || workingCount > 0 || waitingCount > 0)
      && (scope !== 'current' || Boolean(currentSessionId));
    const notice = available && this.notice && this.now() - this.notice.at < 4200 ? this.notice : undefined;
    return {
      sessionId: this.scopeKey,
      available, running: runningCount > 0, pending: waitingCount > 0,
      workingCount, waitingCount, notice,
    };
  }
  trim() {
    // Do not keep per-session terminal metadata forever in a long-lived browser.
    if (this.records.size <= 2048) return;
    for (const [id, record] of this.records) {
      if (this.running(id) !== true && !record.candidate && this.notice?.sessionId !== id) this.records.delete(id);
      if (this.records.size <= 1024) break;
    }
  }
}
