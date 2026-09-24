// Authored strict Typert contract, checked against Desktop 0.1.6-alpha.2.
// Bundled into lib/remote.js so the browser needs no external schema module.
import * as z from 'zod/mini';
const counter = z.int().check(z.minimum(0), z.maximum(Number.MAX_SAFE_INTEGER));
const sessionId = z.string().check(z.minLength(1), z.maxLength(512));
const identity = z.strictObject({ sessionId, isSubagent: z.optional(z.boolean()) });
const shared = {
  hostEpoch: z.string().check(z.minLength(1), z.maxLength(128)), streamSeq: counter,
};
const boundary = {
  ...shared, sessionId, seq: counter,
  time: z.union([z.string().check(z.maxLength(64)), z.number()]),
  isSubagent: z.optional(z.boolean()),
};
export const WHALE_FRAME_SCHEMA = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('baseline'), ...shared, identities: z.array(identity).check(z.maxLength(4096)) }),
  z.strictObject({ type: z.literal('turn/start'), ...boundary }),
  z.strictObject({ type: z.literal('turn/end'), ...boundary, reason: z.string().check(z.maxLength(80)) }),
]);
export const WHALE_WATCH_DESCRIPTOR = {
  id: 'dsh-plugin-whale-pet#whalePet/watch', service: 'whalePet', namespace: 'whalePet', method: 'watch',
  mode: 'stream', invocation: { kind: 'direct' }, parameters: [],
  cancellation: { parameter: 'signal' },
  result: { mode: 'strict', typeSymbol: 'dsh-plugin-whale-pet#WhaleBoundaryFrame', create: () => WHALE_FRAME_SCHEMA },
};
export const TYPERT_REMOTE = { package: 'dsh-plugin-whale-pet', descriptors: [WHALE_WATCH_DESCRIPTOR] };
