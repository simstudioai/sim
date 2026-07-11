import type { Span } from '@opentelemetry/api'
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode, toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { billingUpdateCostContract } from '@/lib/api/contracts/subscription'
import { parseRequest } from '@/lib/api/server'
import {
  type AccountBillingDecision,
  BILLING_ACCOUNT_DECISION_HEADER,
  BILLING_ATTRIBUTION_HEADER,
  BILLING_REQUEST_ID_HEADER,
  type BillingAttributionSnapshot,
  COPILOT_BILLING_PROTOCOL,
  COPILOT_BILLING_PROTOCOL_HEADER,
  type CopilotBillingProtocol,
  requireAccountBillingDecisionHeader,
  requireBillingAttributionHeader,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { getCachedBillingAttribution } from '@/lib/billing/core/billing-attribution-cache'
import {
  type CumulativeUsageContextField,
  CumulativeUsageContextMismatchError,
  recordCumulativeUsage,
  recordUsage,
} from '@/lib/billing/core/usage-log'
import {
  checkAndBillOverageThreshold,
  checkAndBillPayerOverageThreshold,
} from '@/lib/billing/threshold-billing'
import { BILLING_CALLBACK_OUTCOME } from '@/lib/copilot/generated/billing-protocol-v1'
import { BillingRouteOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { checkInternalApiKey } from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import { isBillingEnabled, isCopilotBillingAttributionV1Enabled } from '@/lib/core/config/env-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('BillingUpdateCostAPI')

function invalidBillingProtocolResponse(requestId: string, span: Span): NextResponse {
  span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.InvalidBody)
  span.setAttribute(TraceAttr.HttpStatusCode, 400)
  return NextResponse.json(
    {
      success: false,
      error: 'Invalid billing protocol',
      requestId,
    },
    { status: 400 }
  )
}

/**
 * Resolves the request-supplied workspace to one that exists in this
 * deployment. Workspace attribution on the usage ledger is best-effort:
 * self-hosted and headless clients bill through this endpoint with workspace
 * IDs from their own databases, and `usage_log.workspace_id` carries an FK to
 * `workspace`, so stamping a foreign ID would fail the entire flush with an
 * FK violation and strand real cost in the caller's dead-letter queue.
 * Unknown workspaces are recorded without local workspace attribution because
 * this deployment cannot resolve their payer. Direct-v1 account callbacks do
 * not call this helper at all: their self-hosted workspace is not hosted payer
 * identity.
 */
async function resolveAttributableWorkspaceId(
  requestId: string,
  workspaceId: string | undefined
): Promise<string | undefined> {
  if (!workspaceId) return undefined

  const [row] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  if (row) return row.id

  logger.warn(`[${requestId}] Workspace not found in this deployment; recording unattributed`, {
    workspaceId,
  })
  return undefined
}

/**
 * POST /api/billing/update-cost
 * Update user cost with a pre-calculated cost value (internal API key auth required)
 *
 * Parented under the Go-side `sim.update_cost` span via W3C traceparent
 * propagation. Every mothership request that bills should therefore show
 * the Go client span AND this Sim server span sharing one trace, with
 * the actual usage/overage work nested below.
 */
export const POST = withRouteHandler((req: NextRequest) =>
  withIncomingGoSpan(
    req.headers,
    TraceSpan.CopilotBillingUpdateCost,
    {
      [TraceAttr.HttpMethod]: 'POST',
      [TraceAttr.HttpRoute]: '/api/billing/update-cost',
    },
    async (span) => updateCostInner(req, span)
  )
)

async function updateCostInner(req: NextRequest, span: Span): Promise<NextResponse> {
  const requestId = generateRequestId()
  const startTime = Date.now()

  try {
    logger.info(`[${requestId}] Update cost request started`)

    // Check authentication (internal API key)
    const authResult = checkInternalApiKey(req)
    if (!authResult.success) {
      logger.warn(`[${requestId}] Authentication failed: ${authResult.error}`)
      span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.AuthFailed)
      span.setAttribute(TraceAttr.HttpStatusCode, 401)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication failed',
        },
        { status: 401 }
      )
    }

    if (!isBillingEnabled) {
      span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.BillingDisabled)
      span.setAttribute(TraceAttr.HttpStatusCode, 200)
      return NextResponse.json({
        success: true,
        message: 'Billing disabled, cost update skipped',
        data: {
          billingEnabled: false,
          processedAt: new Date().toISOString(),
          requestId,
        },
      })
    }

    const parsed = await parseRequest(
      billingUpdateCostContract,
      req,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid request body`, {
            errors: error.issues,
          })
          span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.InvalidBody)
          span.setAttribute(TraceAttr.HttpStatusCode, 400)
          return NextResponse.json(
            {
              success: false,
              error: 'Invalid request body',
              details: error.issues,
            },
            { status: 400 }
          )
        },
        invalidJsonResponse: () => {
          span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.InvalidBody)
          span.setAttribute(TraceAttr.HttpStatusCode, 400)
          return NextResponse.json(
            { success: false, error: 'Request body must be valid JSON' },
            { status: 400 }
          )
        },
      }
    )

    if (!parsed.success) return parsed.response

    const { userId, cost, model, inputTokens, outputTokens, source, idempotencyKey, workspaceId } =
      parsed.data.body
    const requestedProtocol = parsed.data.headers?.[COPILOT_BILLING_PROTOCOL_HEADER]
    const billingRequestId = parsed.data.headers?.[BILLING_REQUEST_ID_HEADER]
    const suppliedAttributionHeader = parsed.data.headers?.[BILLING_ATTRIBUTION_HEADER]
    const suppliedAccountDecisionHeader = parsed.data.headers?.[BILLING_ACCOUNT_DECISION_HEADER]
    const protocol: CopilotBillingProtocol | undefined =
      requestedProtocol ??
      (isCopilotBillingAttributionV1Enabled ? undefined : COPILOT_BILLING_PROTOCOL.legacy)
    if (!protocol) {
      return invalidBillingProtocolResponse(requestId, span)
    }

    const isModernProtocol =
      protocol === COPILOT_BILLING_PROTOCOL.attributed ||
      protocol === COPILOT_BILLING_PROTOCOL.direct
    const isAttributedProtocol = protocol === COPILOT_BILLING_PROTOCOL.attributed
    const isDirectProtocol = protocol === COPILOT_BILLING_PROTOCOL.direct
    if (
      (isModernProtocol &&
        (!billingRequestId || !idempotencyKey || billingRequestId !== idempotencyKey)) ||
      (protocol === COPILOT_BILLING_PROTOCOL.legacy && billingRequestId) ||
      (isAttributedProtocol && !suppliedAttributionHeader) ||
      (isDirectProtocol && !suppliedAccountDecisionHeader) ||
      (isDirectProtocol && Boolean(suppliedAttributionHeader)) ||
      (!isDirectProtocol && Boolean(suppliedAccountDecisionHeader))
    ) {
      return invalidBillingProtocolResponse(requestId, span)
    }
    const isMcp = source === 'mcp_copilot'

    span.setAttributes({
      [TraceAttr.UserId]: userId,
      [TraceAttr.GenAiRequestModel]: model,
      [TraceAttr.BillingSource]: source,
      [TraceAttr.BillingCostUsd]: cost,
      [TraceAttr.GenAiUsageInputTokens]: inputTokens,
      [TraceAttr.GenAiUsageOutputTokens]: outputTokens,
      [TraceAttr.BillingIsMcp]: isMcp,
      ...(idempotencyKey ? { [TraceAttr.BillingIdempotencyKey]: idempotencyKey } : {}),
    })

    logger.info(`[${requestId}] Processing cost update`, {
      userId,
      cost,
      model,
      source,
    })

    let suppliedBillingAttribution: BillingAttributionSnapshot | undefined
    let suppliedAccountDecision: AccountBillingDecision | undefined
    try {
      if (suppliedAttributionHeader) {
        if (!workspaceId) {
          return invalidBillingProtocolResponse(requestId, span)
        }
        suppliedBillingAttribution = requireBillingAttributionHeader(req.headers, {
          actorUserId: userId,
          workspaceId,
        })
      }
      if (suppliedAccountDecisionHeader) {
        suppliedAccountDecision = requireAccountBillingDecisionHeader(req.headers)
      }
    } catch {
      return invalidBillingProtocolResponse(requestId, span)
    }

    const attributionCacheKey =
      protocol === COPILOT_BILLING_PROTOCOL.legacy ? idempotencyKey : undefined
    const cachedBillingAttribution = attributionCacheKey
      ? await getCachedBillingAttribution(attributionCacheKey)
      : undefined
    const billingAttribution = suppliedBillingAttribution ?? cachedBillingAttribution
    const accountDecision = suppliedAccountDecision
    if (isAttributedProtocol && !billingAttribution) {
      throw new Error(`Immutable ${protocol} billing attribution is missing`)
    }
    if (isDirectProtocol && !accountDecision) {
      throw new Error(`Immutable ${protocol} account billing decision is missing`)
    }
    if (accountDecision && accountDecision.userId !== userId) {
      throw new CumulativeUsageContextMismatchError(`update-cost:${idempotencyKey}`, ['actor'])
    }
    if (billingAttribution) {
      const mismatchedFields: CumulativeUsageContextField[] = []
      if (billingAttribution.actorUserId !== userId) {
        mismatchedFields.push('actor')
      }
      if (
        (isAttributedProtocol && billingAttribution.workspaceId !== workspaceId) ||
        (!isAttributedProtocol && workspaceId && billingAttribution.workspaceId !== workspaceId)
      ) {
        mismatchedFields.push('workspace')
      }
      if (mismatchedFields.length > 0) {
        throw new CumulativeUsageContextMismatchError(
          `update-cost:${idempotencyKey}`,
          mismatchedFields
        )
      }
    }

    const resolvedWorkspaceId = isDirectProtocol
      ? undefined
      : await resolveAttributableWorkspaceId(
          requestId,
          workspaceId ?? billingAttribution?.workspaceId
        )
    const billingContext = billingAttribution
      ? toBillingContext(billingAttribution)
      : accountDecision
        ? {
            billingEntity: accountDecision.billingEntity,
            billingPeriod: {
              start: new Date(accountDecision.billingPeriod.start),
              end: new Date(accountDecision.billingPeriod.end),
            },
          }
        : undefined

    // Go sends the request's CUMULATIVE cost, possibly more than once (a
    // mid-loop provider-error flush, then the recovered terminal flush, plus
    // abort-race duplicates). Record it as a monotonic top-up: one ledger row
    // per request holds the MAX cumulative and we bill only the delta, so
    // partial + complete flushes converge to the true total exactly once — no
    // under-billing on recovery, no over-billing on duplicates. When there is
    // no idempotency key (shouldn't happen for real requests) we fall back to a
    // plain append so cost is never silently dropped.
    let billed = true
    if (idempotencyKey) {
      const result = await recordCumulativeUsage({
        userId,
        workspaceId: resolvedWorkspaceId,
        ...billingContext,
        source,
        model,
        cost,
        eventKey: `update-cost:${idempotencyKey}`,
        metadata: { inputTokens, outputTokens },
      })
      billed = result.billed
      logger.info(`[${requestId}] Cumulative cost top-up`, {
        userId,
        source,
        cumulativeCost: cost,
        billedDelta: result.delta,
        newTotal: result.total,
        billed: result.billed,
      })
    } else {
      await recordUsage({
        userId,
        workspaceId: resolvedWorkspaceId,
        ...billingContext,
        entries: [
          {
            category: 'model',
            source,
            description: model,
            cost,
            sourceReference: requestId,
            metadata: { inputTokens, outputTokens },
          },
        ],
      })
      logger.info(`[${requestId}] Recorded usage (no idempotency key)`, {
        userId,
        addedCost: cost,
        source,
      })
    }

    // Reconcile the payer's ledger-backed threshold after every cumulative
    // callback, including duplicate retries after a prior settlement failure.
    // Strict error handling lets Go retry until the committed usage is settled.
    if (billingContext) {
      await checkAndBillPayerOverageThreshold(billingContext.billingEntity, {
        onError: 'throw',
      })
    } else {
      await checkAndBillOverageThreshold(userId, undefined, { onError: 'throw' })
    }

    const duration = Date.now() - startTime

    // Same-or-lower cumulative than already recorded: nothing new to bill.
    // Reconciliation has completed, so preserve Go's established 409 outcome.
    if (!billed) {
      logger.info(`[${requestId}] Duplicate/non-increasing cumulative cost; no new charge`, {
        idempotencyKey,
        userId,
        cost,
      })
      span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.DuplicateIdempotencyKey)
      span.setAttribute(TraceAttr.HttpStatusCode, 409)
      span.setAttribute(TraceAttr.BillingDurationMs, duration)
      return NextResponse.json(
        {
          success: false,
          code: BILLING_CALLBACK_OUTCOME.duplicateBillingEvent.code,
          error: BILLING_CALLBACK_OUTCOME.duplicateBillingEvent.message,
          requestId,
        },
        { status: 409 }
      )
    }

    logger.info(`[${requestId}] Cost update completed successfully`, {
      userId,
      duration,
      cost,
    })

    span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.Billed)
    span.setAttribute(TraceAttr.HttpStatusCode, 200)
    span.setAttribute(TraceAttr.BillingDurationMs, duration)
    return NextResponse.json({
      success: true,
      data: {
        userId,
        cost,
        processedAt: new Date().toISOString(),
        requestId,
      },
    })
  } catch (error) {
    const duration = Date.now() - startTime

    const isMarkerlessLegacy = !req.headers.get(COPILOT_BILLING_PROTOCOL_HEADER)
    if (error instanceof CumulativeUsageContextMismatchError && !isMarkerlessLegacy) {
      logger.error(`[${requestId}] Billing context mismatch`, {
        eventKey: error.eventKey,
        mismatchedFields: error.mismatchedFields,
        duration,
      })
      span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.InvalidBody)
      span.setAttribute(TraceAttr.HttpStatusCode, 409)
      span.setAttribute(TraceAttr.BillingDurationMs, duration)
      return NextResponse.json(
        {
          success: false,
          code: BILLING_CALLBACK_OUTCOME.billingContextMismatch.code,
          error: BILLING_CALLBACK_OUTCOME.billingContextMismatch.message,
          requestId,
        },
        { status: 409 }
      )
    }

    // Surface the underlying Postgres failure (e.g. 23503 FK violation vs a
    // lock timeout) — Drizzle's "Failed query" wrapper alone cannot
    // distinguish them, which made the dead-workspace incident undiagnosable
    // from logs.
    const pgCode = getPostgresErrorCode(error)
    const pgConstraint = getPostgresConstraintName(error)
    logger.error(`[${requestId}] Cost update failed`, {
      error: toError(error).message,
      ...(pgCode && { pgCode }),
      ...(pgConstraint && { pgConstraint }),
      stack: error instanceof Error ? error.stack : undefined,
      duration,
    })

    // The cumulative top-up runs in a single transaction (and a plain append is
    // a single insert), so a failure here leaves nothing partially committed —
    // a retry re-evaluates the max idempotently. No claim to release.
    span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.InternalError)
    span.setAttribute(TraceAttr.HttpStatusCode, 500)
    span.setAttribute(TraceAttr.BillingDurationMs, duration)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        requestId,
      },
      { status: 500 }
    )
  }
}
