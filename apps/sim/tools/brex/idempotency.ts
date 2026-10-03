import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { KeyedDeliveryDeclaration, KeyedTokenPlacement } from '@/lib/core/http/classes'
import { deriveDeliveryKey } from '@/lib/core/http/derive-key'

const logger = createLogger('BrexIdempotency')

/**
 * Where every Brex write carries its idempotency token.
 *
 * A header rather than a body field, which is what a signed or hashed payload
 * would require anyway — placing a token in a JSON body re-serializes it.
 */
const BREX_TOKEN_PLACEMENT = {
  kind: 'header',
  name: 'Idempotency-Key',
} as const satisfies KeyedTokenPlacement

/**
 * Deliberately conservative floor on how long Brex honors an `Idempotency-Key`,
 * in seconds.
 *
 * Brex does not publish a retention window, so this is a floor chosen to fail in
 * the safe direction rather than the real number: understating it turns a retry
 * outside the floor into a `DeliveryFailure` an operator must reconcile, while
 * overstating it turns that same retry into a second real transfer. Fifteen
 * minutes covers every in-run retry layer — the block executor caps at 5 tries ×
 * 5 s of waiting and the transport loop at seconds — with room for a slow
 * request.
 */
export const BREX_IDEMPOTENCY_WINDOW_SECONDS = 900

/**
 * The execution identity a Brex token is derived from, injected into tool params
 * by the executor under the reserved `_context` key.
 *
 * Intersected into each tool's own param type at its `ToolConfig` type argument
 * rather than declared on the wire-shape interfaces in `types.ts`, which are
 * type-imported by the client-reachable block definitions.
 */
export interface BrexDeliveryContextParams {
  _context?: {
    executionId?: string
    blockId?: string
    invocationId?: string
  }
}

/** One Brex write, paired with the declaration that justifies its class. */
export interface BrexKeyedSite {
  /** Must equal the owning `ToolConfig.id`; `idempotency.test.ts` pins it. */
  readonly toolId: string
  readonly declaration: KeyedDeliveryDeclaration
}

/**
 * Declares a Brex write as a `keyed` delivery.
 *
 * Placement and provider window are identical for every Brex endpoint, so they
 * live here once and each call site supplies only what differs: which tool it is,
 * and what a duplicate would mean to the user.
 */
export function defineBrexKeyedSite(toolId: string, why: string): BrexKeyedSite {
  return {
    toolId,
    declaration: {
      deliveryClass: 'keyed',
      tokenPlacement: BREX_TOKEN_PLACEMENT,
      providerWindowSeconds: BREX_IDEMPOTENCY_WINDOW_SECONDS,
      why,
    },
  }
}

/**
 * Executor-supplied identity fields a derived token needs.
 *
 * `toolId` is absent because it comes from the site rather than the executor, so
 * it can never be the missing one.
 */
const REQUIRED_CONTEXT_FIELDS = ['executionId', 'blockId', 'invocationId'] as const

/**
 * Builds the `Idempotency-Key` header for one Brex write.
 *
 * The token is derived from the execution identity, so the transport retry loop,
 * the block executor's retry policy, and a queue redelivery all send the same
 * value and Brex collapses them into one transfer. Minting a fresh token per
 * request build is the opposite of what this header is for: it makes every retry
 * layer above the transport look like a brand-new instruction.
 *
 * Falls back to a fresh id — the behavior this replaced — when the executor has
 * not supplied a complete identity, and logs the gap. `executionId` alone is
 * *stable* but not *distinguishing*: two loop iterations transferring to two
 * different vendors share it, so deriving from it would give both one token and
 * Brex would move money once and silently drop the second instruction. A
 * silently dropped transfer looks like a success, which is worse than the
 * duplicate this exists to prevent, so an incomplete identity degrades rather
 * than guesses. See `KeyedDeliveryContext` for what each field must carry.
 */
export function resolveBrexIdempotencyKey(
  site: BrexKeyedSite,
  params: BrexDeliveryContextParams
): string {
  const context = params._context
  const executionId = context?.executionId
  const blockId = context?.blockId
  const invocationId = context?.invocationId

  if (executionId && blockId && invocationId) {
    return deriveDeliveryKey(
      { executionId, blockId, toolId: site.toolId, invocationId },
      site.toolId
    )
  }

  logger.warn('Brex idempotency token could not be derived; a retry may duplicate the write', {
    toolId: site.toolId,
    why: site.declaration.why,
    missingContextFields: REQUIRED_CONTEXT_FIELDS.filter((field) => !context?.[field]),
  })
  return generateId()
}

/** The `Idempotency-Key` header carrying {@link resolveBrexIdempotencyKey}'s token. */
export function brexIdempotencyHeader(
  site: BrexKeyedSite,
  params: BrexDeliveryContextParams
): Record<string, string> {
  return { [BREX_TOKEN_PLACEMENT.name]: resolveBrexIdempotencyKey(site, params) }
}
