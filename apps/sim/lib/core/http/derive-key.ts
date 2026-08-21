import { createHash } from 'node:crypto'

/**
 * The identity a provider idempotency token is derived from. Every field is
 * required, because a token is only useful when it is *both* stable and
 * distinguishing, and each field carries one of those halves.
 *
 * Stability comes from the fields never being regenerated: {@link deriveDeliveryKey}
 * is pure, so the transport retry loop, the hosted-key loop, and the block
 * executor's retry policy all derive the same token and the provider collapses
 * them into one write.
 *
 * Distinction comes from {@link KeyedDeliveryContext.invocationId}. Without it a
 * loop body and an agent turn both reuse one `blockId` inside one `executionId`,
 * so five iterations paying five invoices would derive one token — the provider
 * honors the first payment and silently drops four real ones. That failure is
 * strictly worse than the duplicate it was meant to prevent, because it looks
 * like five successes.
 *
 * Supply a value minted once per logical invocation that survives every retry
 * layer: `String(blockLog.executionOrder)` on the block path (assigned before the
 * block executor's retry wrapper, and distinct per loop iteration and parallel
 * branch), or the model's tool-call id on the agent path.
 */
export interface KeyedDeliveryContext {
  readonly executionId: string
  readonly blockId: string
  readonly toolId: string
  readonly invocationId: string
}

const KEY_MATERIAL_FIELDS = ['executionId', 'blockId', 'toolId', 'invocationId'] as const

/**
 * Derives the idempotency token a provider dedupes on.
 *
 * Pure in its inputs, so every layer that re-runs the request — the transport
 * loop, the block executor's retry policy, a queue redelivery — produces the
 * same token and the provider collapses the duplicates. Generating a token at
 * request-build time instead yields a fresh value on each re-entry and buys
 * nothing: that is how eight Square money writes and five Brex ones could charge
 * a real customer twice when a builder enabled retry on the block.
 *
 * Throws on an empty component rather than deriving a weaker key. A token that
 * repeats across independent runs makes the provider drop a second, legitimate
 * request, and one that repeats across loop iterations makes it drop all but the
 * first — both fail as silent success.
 */
export function deriveDeliveryKey(context: KeyedDeliveryContext, label: string): string {
  const missing = KEY_MATERIAL_FIELDS.filter((field) => !context[field])
  if (missing.length > 0) {
    throw new Error(
      `deriveDeliveryKey(${label}): ${missing.join(', ')} must be non-empty — a keyed token that is not both stable across retries and distinct per invocation makes the provider drop real requests`
    )
  }
  /**
   * NUL separates the components because it cannot occur in an id or a label,
   * so no two distinct contexts can flatten to the same material string.
   */
  const material = [
    context.executionId,
    context.blockId,
    context.toolId,
    context.invocationId,
    label,
  ].join('\u0000')
  return `sim_${createHash('sha256').update(material).digest('base64url').slice(0, 32)}`
}
