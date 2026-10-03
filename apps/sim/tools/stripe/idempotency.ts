import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type {
  KeyedDeliveryDeclaration,
  KeyedTokenPlacement,
  UnkeyedDeliveryDeclaration,
} from '@/lib/core/http/classes'
import { deriveDeliveryKey } from '@/lib/core/http/derive-key'

const logger = createLogger('StripeIdempotency')

/**
 * Where every Stripe write carries its idempotency token.
 *
 * A header, which is both what Stripe documents — "Idempotency keys are sent in
 * the `Idempotency-Key` header. Use them for all `POST` requests to the Stripe
 * API." — and the only placement that could work here: every Stripe request
 * body is `application/x-www-form-urlencoded`, and `bodyField` placement parses
 * and re-serializes a *JSON* body, so it would throw before the request left.
 *
 * @see https://docs.stripe.com/error-low-level#idempotency
 */
const STRIPE_TOKEN_PLACEMENT = {
  kind: 'header',
  name: 'Idempotency-Key',
} as const satisfies KeyedTokenPlacement

/**
 * How long Stripe honors an `Idempotency-Key`, in seconds.
 *
 * Unlike the Square and Brex windows, this is not a conservative guess standing
 * in for a number the provider declines to publish. Stripe states it outright:
 * "Clients can safely retry requests that include an idempotency key as long as
 * the second request occurs within 24 hours from when you first receive the key
 * (keys expire out of the system after 24 hours)."
 *
 * The window bounds the attempt span of a single delivery, so at 24 hours it
 * never binds inside a block execution — every retry layer above the transport
 * finishes in seconds. It is recorded at the real value anyway, because the
 * field's job is to say what the provider guarantees, not to encode the retry
 * budget that happens to sit under it.
 *
 * @see https://docs.stripe.com/error-low-level#idempotency
 */
export const STRIPE_IDEMPOTENCY_WINDOW_SECONDS = 24 * 60 * 60

/**
 * The delivery classes Stripe's own guarantee assigns to its non-`POST` verbs.
 *
 * Stripe is explicit that a token buys nothing here — "Don't send idempotency
 * keys in `GET` and `DELETE` requests because it has no effect. These requests
 * are idempotent by definition." — and that the guarantee is the API's own:
 * "The Stripe API guarantees the idempotency of `GET` and `DELETE` requests, so
 * it's always safe to retry them."
 *
 * So these verbs are declared for what they are rather than dressed up as
 * `keyed`. A `keyed` declaration with no provider dedupe behind it reads as a
 * safety property to everyone downstream while providing none, which is worse
 * than the honest class.
 *
 * Keyed by request method so the set is exhaustive by construction:
 * `idempotency.test.ts` walks every exported Stripe tool and requires each
 * non-`POST` verb to appear here, so a Stripe tool added on a verb nobody has
 * classified fails rather than passing unclassified.
 *
 * @see https://docs.stripe.com/api/idempotent_requests
 */
export const STRIPE_UNKEYED_DELIVERY = {
  GET: {
    deliveryClass: 'read',
    why: 'a duplicate re-reads the same object; nothing in the Stripe account changes and no customer is charged or emailed',
  },
  DELETE: {
    deliveryClass: 'converge',
    why: 'deleting an already-deleted object leaves the account in the same state, which is the idempotency Stripe guarantees for DELETE',
  },
} as const satisfies Record<string, UnkeyedDeliveryDeclaration>

/**
 * The execution identity a Stripe token is derived from, injected into tool
 * params by the executor under the reserved `_context` key.
 *
 * Intersected into each tool's own param type at its `ToolConfig` type argument
 * rather than declared on the wire-shape interfaces in `types.ts`, which are
 * type-imported by the client-reachable block definition.
 */
export interface StripeDeliveryContextParams {
  _context?: {
    executionId?: string
    blockId?: string
    invocationId?: string
  }
}

/** One Stripe write, paired with the declaration that justifies its class. */
export interface StripeKeyedSite {
  /** Must equal the owning `ToolConfig.id`; `idempotency.test.ts` pins it. */
  readonly toolId: string
  readonly declaration: KeyedDeliveryDeclaration
}

/**
 * Declares a Stripe write as a `keyed` delivery.
 *
 * Placement and provider window are identical for every Stripe `POST`, so they
 * live here once and each call site supplies only what differs: which tool it
 * is, and what a duplicate would mean to the user.
 */
export function defineStripeKeyedSite(toolId: string, why: string): StripeKeyedSite {
  return {
    toolId,
    declaration: {
      deliveryClass: 'keyed',
      tokenPlacement: STRIPE_TOKEN_PLACEMENT,
      providerWindowSeconds: STRIPE_IDEMPOTENCY_WINDOW_SECONDS,
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
 * Builds the token for one Stripe write.
 *
 * Derived from the execution identity, so the transport retry loop, the block
 * executor's retry policy, and a queue redelivery all send the same value and
 * Stripe replays its first answer instead of charging the card again. Minting a
 * fresh token at request-build time is the inverse of what the header is for: it
 * is stable only inside the transport loop, and every retry layer above it
 * re-enters tool preparation and produces a brand-new instruction.
 *
 * Falls back to a fresh id — the no-token behavior this replaced, but at least
 * scoped to one attempt — when the executor has not supplied a complete
 * identity, and logs the gap. `executionId` alone is *stable* but not
 * *distinguishing*: five loop iterations paying five different invoices share
 * it, so deriving from it would give all five one token and Stripe would pay the
 * first invoice and silently replay that same response for the other four. Four
 * unpaid invoices reported as four successes is strictly worse than the
 * duplicate this exists to prevent, so an incomplete identity degrades rather
 * than guesses. See `KeyedDeliveryContext` for what each field must carry.
 *
 * The derived form is `sim_` plus 32 base64url characters, so 36 in all, well
 * inside the 255-character ceiling Stripe puts on an idempotency key. It carries
 * no account data, which is what Stripe asks for: "Avoid using sensitive data
 * (for example, email addresses or personal identifiers) as idempotency keys."
 */
export function resolveStripeIdempotencyKey(
  site: StripeKeyedSite,
  params: StripeDeliveryContextParams
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

  logger.warn('Stripe idempotency token could not be derived; a retry may charge twice', {
    toolId: site.toolId,
    why: site.declaration.why,
    missingContextFields: REQUIRED_CONTEXT_FIELDS.filter((field) => !context?.[field]),
  })
  return generateId()
}

/**
 * The `Idempotency-Key` header carrying {@link resolveStripeIdempotencyKey}'s
 * token, spread into a Stripe write's headers.
 *
 * Stripe compares a repeated key's parameters against the original and rejects a
 * mismatch, so a block-level retry whose inputs resolved differently — a
 * re-evaluated `<current_time>` in a description, say — surfaces as a Stripe
 * error rather than as a second charge. That is the safe direction to fail in,
 * and the reason the token is derived from identity rather than from the payload.
 */
export function stripeIdempotencyHeader(
  site: StripeKeyedSite,
  params: StripeDeliveryContextParams
): Record<string, string> {
  return { [STRIPE_TOKEN_PLACEMENT.name]: resolveStripeIdempotencyKey(site, params) }
}
