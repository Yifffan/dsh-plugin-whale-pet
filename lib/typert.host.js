// Authored strict reflection, validated against the installed DSH Typert loader.
import { WHALE_WATCH_DESCRIPTOR, WHALE_FRAME_SCHEMA, WHALE_DIAGNOSTICS_DESCRIPTOR, WHALE_DIAGNOSTICS_SCHEMA } from './remote.js';
export const TYPERT = {
  package: 'dsh-plugin-whale-pet', face: 'host',
  schemas: [
    { name: 'WhaleBoundaryFrame', create: () => WHALE_FRAME_SCHEMA },
    { name: 'WhaleDiagnosticsSnapshot', create: () => WHALE_DIAGNOSTICS_SCHEMA },
  ],
  invocations: [WHALE_WATCH_DESCRIPTOR, WHALE_DIAGNOSTICS_DESCRIPTOR],
  model: {
    services: [{
      key: 'whalePet', exportName: 'WhalePetBoundaryService',
      description: 'Read-only live turn boundaries; no content, history, approval handling or model calls.',
      summary: 'Whale companion live boundaries', tags: [],
      members: [
        { kind: 'method', name: 'watch', signature: 'watch(signal: AbortSignal): AsyncIterable<WhaleBoundaryFrame>' },
        { kind: 'method', name: 'diagnostics', signature: 'diagnostics(signal: AbortSignal): WhaleDiagnosticsSnapshot' },
      ],
      types: [],
    }],
    events: [], objects: [],
  },
};
export default TYPERT;
