// Authored strict reflection, validated against the installed DSH Typert loader.
import { WHALE_WATCH_DESCRIPTOR, WHALE_FRAME_SCHEMA, WHALE_BALANCE_DESCRIPTOR, WHALE_BALANCE_SCHEMA } from './remote.js';
export const TYPERT = {
  package: 'dsh-plugin-whale-pet', face: 'host',
  schemas: [
    { name: 'WhaleBoundaryFrame', create: () => WHALE_FRAME_SCHEMA },
    { name: 'WhaleBalance', create: () => WHALE_BALANCE_SCHEMA },
  ],
  invocations: [WHALE_WATCH_DESCRIPTOR, WHALE_BALANCE_DESCRIPTOR],
  model: {
    services: [{
      key: 'whalePet', exportName: 'WhalePetBoundaryService',
      description: 'Read-only live turn boundaries and one account balance reading; no content, history, approval handling or model calls.',
      summary: 'Whale companion live boundaries and balance', tags: [],
      members: [
        { kind: 'method', name: 'watch', signature: 'watch(signal: AbortSignal): AsyncIterable<WhaleBoundaryFrame>' },
        { kind: 'method', name: 'balance', signature: 'balance(signal: AbortSignal): AsyncIterable<WhaleBalance>' },
      ],
      types: [],
    }],
    events: [], objects: [],
  },
};
export default TYPERT;
