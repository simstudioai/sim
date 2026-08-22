import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { KeyedDeliveryDeclaration, KeyedTokenPlacement } from '@/lib/core/http/classes'
import { deriveDeliveryKey } from '@/lib/core/http/derive-key'

const logger = createLogger('OutlookCalendarIdempotency')

/**
 * Where a Graph calendar write carries its idempotency token.
 *
 * Graph takes `transactionId` as a property of the event body — there is no
 * header form — and discards a repeated POST that carries one it has already
 * seen.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/resources/event
 */
const OUTLOOK_TOKEN_PLACEMENT = {
  kind: 'bodyField',
  path: 'transactionId',
} as const satisfies KeyedTokenPlacement

/**
 * Deliberately conservative floor on how long Graph honors a `transactionId`,
 * in seconds.
 *
 * Graph documents the field's purpose but not its retention window, so this is a
 * floor chosen to fail in the safe direction rather than the real number:
 * understating it turns a retry outside the floor into a `DeliveryFailure`,
 * while overstating it turns that same retry into a second invite in every
 * attendee's inbox. Fifteen minutes covers every in-run retry layer — the block
 * executor caps at 5 tries × 5 s of waiting, and `CALENDAR_RETRY` at 3 retries
 * with a 30 s ceiling — with room for a slow request.
 */
export const OUTLOOK_CALENDAR_TRANSACTION_WINDOW_SECONDS = 900

/**
 * The execution identity a Graph token is derived from, injected into tool
 * params by the executor under the reserved `_context` key.
 *
 * Intersected into each tool's own param type at its `ToolConfig` type argument
 * rather than declared on the wire-shape interfaces in `types.ts`, which are
 * type-imported by the client-reachable block definitions.
 */
export interface OutlookCalendarDeliveryContextParams {
  _context?: {
    executionId?: string
    blockId?: string
    invocationId?: string
  }
}

/** One Graph calendar write, paired with the declaration justifying its class. */
export interface OutlookCalendarKeyedSite {
  /** Must equal the owning `ToolConfig.id`; `calendar-idempotency.test.ts` pins it. */
  readonly toolId: string
  readonly declaration: KeyedDeliveryDeclaration
}

/**
 * Declares a Graph calendar write as a `keyed` delivery.
 *
 * Only the create-event endpoint qualifies. Graph exposes no `transactionId` on
 * `accept` / `tentativelyAccept` / `decline`, so a response cannot be declared
 * `keyed` however much we would like it to be — see `CALENDAR_RETRY` for the
 * duplicate-notification tradeoff that leaves in place.
 */
export function defineOutlookCalendarKeyedSite(
  toolId: string,
  why: string
): OutlookCalendarKeyedSite {
  return {
    toolId,
    declaration: {
      deliveryClass: 'keyed',
      tokenPlacement: OUTLOOK_TOKEN_PLACEMENT,
      providerWindowSeconds: OUTLOOK_CALENDAR_TRANSACTION_WINDOW_SECONDS,
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
 * Resolves the `transactionId` for one Graph calendar write.
 *
 * Derived from the execution identity so the transport retry loop,
 * `CALENDAR_RETRY`, and the block executor's retry policy all send the same
 * value and Graph discards the duplicates. `CALENDAR_RETRY` replays 5xx as well
 * as 429, so a failure returned after Graph already committed the event is
 * exactly the case this token has to survive — and a token minted at request
 * build survives only the innermost of those three loops.
 *
 * Falls back to a fresh id — the behavior this replaced — when the executor has
 * not supplied a complete identity, and logs the gap. `executionId` alone is
 * *stable* but not *distinguishing*: two loop iterations creating two different
 * events share it, so deriving from it would give both one token and Graph would
 * create the first event and silently discard the second. A silently dropped
 * event looks like a success, which is worse than the duplicate this exists to
 * prevent. See `KeyedDeliveryContext` for what each field must carry.
 *
 * The derived form is 36 characters, far inside Graph's 256-character ceiling on
 * `transactionId`.
 */
export function resolveOutlookCalendarTransactionId(
  site: OutlookCalendarKeyedSite,
  params: OutlookCalendarDeliveryContextParams
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

  logger.warn('Outlook transactionId could not be derived; a retry may create a second event', {
    toolId: site.toolId,
    why: site.declaration.why,
    missingContextFields: REQUIRED_CONTEXT_FIELDS.filter((field) => !context?.[field]),
  })
  return generateId()
}

/**
 * Returns `event` with the resolved token placed at Graph's `transactionId`.
 *
 * Placed last so the token always wins over a same-named field a caller built
 * into the event body.
 */
export function withOutlookCalendarTransactionId(
  site: OutlookCalendarKeyedSite,
  params: OutlookCalendarDeliveryContextParams,
  event: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...event,
    [OUTLOOK_TOKEN_PLACEMENT.path]: resolveOutlookCalendarTransactionId(site, params),
  }
}
