import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { KeyedDeliveryDeclaration, KeyedTokenPlacement } from '@/lib/core/http/classes'
import { deriveDeliveryKey } from '@/lib/core/http/derive-key'

const logger = createLogger('SquareIdempotency')

/**
 * Where every Square write carries its idempotency token.
 *
 * Square takes it as a body field rather than a header, and the name is the same
 * on `/v2/payments`, `/v2/refunds`, `/v2/orders`, `/v2/invoices`,
 * `/v2/customers`, and `/v2/catalog/*`.
 */
const SQUARE_TOKEN_PLACEMENT = {
  kind: 'bodyField',
  path: 'idempotency_key',
} as const satisfies KeyedTokenPlacement

/**
 * Deliberately conservative floor on how long Square honors an
 * `idempotency_key`, in seconds.
 *
 * Square documents that a repeated key returns the original response but does
 * not publish a retention window, so this is not the real number — it is a floor
 * chosen to fail in the safe direction. Understating it makes a retry *outside*
 * the floor surface as a `DeliveryFailure` an operator must reconcile;
 * overstating it makes that same retry a second real charge. Fifteen minutes
 * covers every in-run retry layer — the block executor caps at 5 tries × 5 s of
 * waiting and the transport loop at seconds — with room for a slow request.
 */
export const SQUARE_IDEMPOTENCY_WINDOW_SECONDS = 900

/**
 * The execution identity a Square token is derived from, injected into tool
 * params by the executor under the reserved `_context` key.
 *
 * Intersected into each tool's own param type at its `ToolConfig` type argument
 * rather than declared on the wire-shape interfaces in `types.ts`, which are
 * type-imported by the client-reachable block definitions.
 */
export interface SquareDeliveryContextParams {
  _context?: {
    executionId?: string
    blockId?: string
    invocationId?: string
  }
}

/** Params every keyed Square write accepts, beyond its own request fields. */
export interface SquareIdempotencyParams extends SquareDeliveryContextParams {
  /** Caller-supplied token. Always wins, so a builder can pin their own. */
  idempotencyKey?: string
}

/** One Square write, paired with the declaration that justifies its class. */
export interface SquareKeyedSite {
  /** Must equal the owning `ToolConfig.id`; `idempotency.test.ts` pins it. */
  readonly toolId: string
  readonly declaration: KeyedDeliveryDeclaration
}

/**
 * Declares a Square write as a `keyed` delivery.
 *
 * Placement and provider window are identical for every Square endpoint, so they
 * live here once and each call site supplies only what differs: which tool it is,
 * and what a duplicate would mean to the user.
 */
export function defineSquareKeyedSite(toolId: string, why: string): SquareKeyedSite {
  return {
    toolId,
    declaration: {
      deliveryClass: 'keyed',
      tokenPlacement: SQUARE_TOKEN_PLACEMENT,
      providerWindowSeconds: SQUARE_IDEMPOTENCY_WINDOW_SECONDS,
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
 * Resolves the `idempotency_key` for one Square write.
 *
 * Precedence is caller-supplied, then derived, then fresh:
 *
 * 1. An explicit `idempotencyKey` param is honored untouched.
 * 2. Otherwise the token is derived from the execution identity, so the transport
 *    retry loop, the block executor's retry policy, and a queue redelivery all
 *    produce the same value and Square collapses them into one charge.
 * 3. When the executor has not supplied a complete identity the token falls back
 *    to a fresh id — the behavior this replaced — and the gap is logged.
 *
 * The fallback exists because the two halves of a useful token come from
 * different fields. `executionId` alone is *stable* but not *distinguishing*:
 * five loop iterations paying five different invoices share it, so deriving from
 * it would give all five one token and Square would honor the first payment and
 * silently drop four real ones. That failure looks like five successes, which is
 * strictly worse than the duplicate this function exists to prevent. Deriving
 * from the request payload instead does not help either — a retry and a
 * legitimate identical repeat are the same observation, so no payload-derived
 * discriminator can separate them.
 *
 * `blockId` and `invocationId` are therefore required, and until the executor
 * threads them into `_context` this degrades to exactly what it replaced rather
 * than guessing. See `KeyedDeliveryContext` for what each field must carry.
 *
 * The derived form is `sim_` plus 32 base64url characters, so 36 in all — inside
 * the 45-character ceiling `/v2/payments` and `/v2/customers` put on
 * `idempotency_key`, the tightest of the Square endpoints used here.
 */
export function resolveSquareIdempotencyKey(
  site: SquareKeyedSite,
  params: SquareIdempotencyParams
): string {
  if (params.idempotencyKey) return params.idempotencyKey

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

  logger.warn('Square idempotency token could not be derived; a retry may charge twice', {
    toolId: site.toolId,
    why: site.declaration.why,
    missingContextFields: REQUIRED_CONTEXT_FIELDS.filter((field) => !context?.[field]),
  })
  return generateId()
}

/**
 * Returns `body` with the resolved token placed at Square's `idempotency_key`.
 *
 * Placed last so the token always wins over a same-named field a caller built
 * into the body.
 */
export function withSquareIdempotencyKey(
  site: SquareKeyedSite,
  params: SquareIdempotencyParams,
  body: Record<string, unknown>
): Record<string, unknown> {
  return { ...body, [SQUARE_TOKEN_PLACEMENT.path]: resolveSquareIdempotencyKey(site, params) }
}
