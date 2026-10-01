import type { Span } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode, toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type BillingUpdateCostResponse,
  type BillingUsageVerdict,
  billingUpdateCostContract,
} from '@/lib/api/contracts/subscription'
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
  requireBillingCallbackAttribution,
  resolveLegacyV0BillingAttribution,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import {
  type MidRunUsageVerdict,
  readMidRunAccountUsageVerdict,
  readMidRunUsageVerdict,
} from '@/lib/billing/core/mid-run-usage'
import {
  type CumulativeUsageContextField,
  CumulativeUsageContextMismatchError,
  CumulativeUsagePeriodClosedError,
  recordCumulativeUsage,
} from '@/lib/billing/core/usage-log'
import {
  checkAndBillOverageThreshold,
  checkAndBillPayerOverageThreshold,
  ThresholdSettlementError,
} from '@/lib/billing/threshold-billing'
import { resolveUsageUpgradePayload } from '@/lib/billing/usage-upgrade'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'
import { withinDeadline } from '@/lib/core/utils/deadline'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { BILLING_CALLBACK_OUTCOME } from '@/lib/mothership/generated/billing-protocol-v1'
import { BillingRouteOutcome } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { checkInternalApiKey } from '@/lib/mothership/request/http'
import { withIncomingGoSpan } from '@/lib/mothership/request/otel'

const logger = createLogger('BillingUpdateCostAPI')
/**
 * How long a cost callback waits on the payer's standing. The worker gives up on the whole
 * callback after 5 s, and a cold gate read can wait on the ledger far longer; past this the
 * callback answers not-exceeded. The abandoned read keeps running and caches its admission, and
 * the next step or re-check reads a refusal again.
 */
const USAGE_STANDING_TIMEOUT_MS = 1000

const RETRYABLE_SETTLEMENT_RESPONSE = {
  code: 'BILLING_SETTLEMENT_RETRYABLE',
  error: 'Billing settlement temporarily unavailable',
} as const

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
 * Reads the run payer's standing after a cost callback, so a long run stops at its next step
 * once it crosses the limit instead of at its next admission, with the card the worker writes
 * to its log. The payer is the attributed run's, or the one a direct-v1 run was admitted with.
 * A duplicate callback answers too: it is often a retry whose first answer was lost. An
 * admission is cached per payer and actor for the gate TTL and a refusal is always re-read, so
 * steady-state steps cost no ledger read. The charge is
 * already recorded when this runs; a gate that cannot answer reports not-exceeded and leaves the
 * refusal to the next step or re-check rather than ending a paying run on a database blip,
 * and so does a verdict read that outlasts {@link USAGE_STANDING_TIMEOUT_MS}. An exceeded
 * verdict always pauses the run.
 */
async function readUsageStanding(
  userId: string,
  billingAttribution: BillingAttributionSnapshot | undefined,
  accountDecision: AccountBillingDecision | undefined
): Promise<BillingUsageVerdict> {
  const readVerdict = billingAttribution
    ? () => readMidRunUsageVerdict(billingAttribution)
    : accountDecision
      ? () => readMidRunAccountUsageVerdict(accountDecision)
      : null
  if (!isHosted || !readVerdict) return { usageExceeded: false }
  let verdict: MidRunUsageVerdict
  try {
    verdict = await withinDeadline(readVerdict, Date.now() + USAGE_STANDING_TIMEOUT_MS)
  } catch {
    logger.warn('Usage standing read outlasted the callback budget; answering not exceeded')
    return { usageExceeded: false }
  }
  // Only a spent limit pauses the run. A blocked account is refused at the run's next
  // continuation or re-check, with blocked-account copy rather than the upgrade card.
  if (verdict.status !== 'exceeded') return { usageExceeded: false }
  return {
    usageExceeded: true,
    usageUpgrade: await resolveUsageUpgradePayload(
      userId,
      billingAttribution ?? verdict.payer,
      verdict.scope
    ),
  }
}

function getBillingResolution(
  isMarkerlessLegacy: boolean,
  billingAttribution: BillingAttributionSnapshot | undefined
): 'callback-time-mutable-workspace' | 'callback-time-mutable-account' | 'immutable-envelope' {
  if (!isMarkerlessLegacy) return 'immutable-envelope'
  if (billingAttribution) return 'callback-time-mutable-workspace'
  return 'callback-time-mutable-account'
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
      return NextResponse.json<BillingUpdateCostResponse>({
        success: true,
        message: 'Billing disabled, cost update skipped',
        usageExceeded: false,
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

    const {
      userId,
      cost,
      model,
      inputTokens,
      outputTokens,
      source,
      idempotencyKey,
      workspaceId,
      organizationId,
    } = parsed.data.body
    const requestedProtocol = parsed.data.headers?.[COPILOT_BILLING_PROTOCOL_HEADER]
    const billingRequestId = parsed.data.headers?.[BILLING_REQUEST_ID_HEADER]
    const suppliedAttributionHeader = parsed.data.headers?.[BILLING_ATTRIBUTION_HEADER]
    const suppliedAccountDecisionHeader = parsed.data.headers?.[BILLING_ACCOUNT_DECISION_HEADER]
    const isMarkerlessLegacy = requestedProtocol === undefined
    if (isMarkerlessLegacy && isHosted) {
      return invalidBillingProtocolResponse(requestId, span)
    }
    const protocol: CopilotBillingProtocol = requestedProtocol ?? COPILOT_BILLING_PROTOCOL.legacy

    const isModernProtocol =
      protocol === COPILOT_BILLING_PROTOCOL.attributed ||
      protocol === COPILOT_BILLING_PROTOCOL.direct
    const isExplicitLegacyProtocol = requestedProtocol === COPILOT_BILLING_PROTOCOL.legacy
    const isAttributedProtocol = protocol === COPILOT_BILLING_PROTOCOL.attributed
    const isDirectProtocol = protocol === COPILOT_BILLING_PROTOCOL.direct
    if (
      (isModernProtocol &&
        (!billingRequestId || !idempotencyKey || billingRequestId !== idempotencyKey)) ||
      (protocol === COPILOT_BILLING_PROTOCOL.legacy && billingRequestId) ||
      (isExplicitLegacyProtocol && !suppliedAttributionHeader) ||
      (isMarkerlessLegacy &&
        Boolean(
          organizationId ||
            billingRequestId ||
            suppliedAttributionHeader ||
            suppliedAccountDecisionHeader
        )) ||
      (isAttributedProtocol && !suppliedAttributionHeader) ||
      (isDirectProtocol && !suppliedAccountDecisionHeader) ||
      (isDirectProtocol && Boolean(suppliedAttributionHeader)) ||
      (!isDirectProtocol && Boolean(suppliedAccountDecisionHeader))
    ) {
      return invalidBillingProtocolResponse(requestId, span)
    }
    // `@` is reserved for the ledger's per-period rows of one request (`<key>@<n>`).
    if (idempotencyKey?.includes('@')) {
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
        suppliedBillingAttribution = requireBillingCallbackAttribution(req.headers, {
          actorUserId: userId,
          workspaceId,
          ...(organizationId ? { organizationId } : {}),
        })
      }
      if (suppliedAccountDecisionHeader) {
        suppliedAccountDecision = requireAccountBillingDecisionHeader(req.headers)
      }
    } catch {
      return invalidBillingProtocolResponse(requestId, span)
    }

    let billingAttribution = suppliedBillingAttribution
    /**
     * Local self-hosted markerless callbacks have no immutable payer envelope,
     * so they re-resolve a locally known workspace at callback time. Hosted
     * attributed-v1/direct-v1 callbacks can never reach this mutable path.
     */
    if (isMarkerlessLegacy && workspaceId) {
      billingAttribution =
        (await resolveLegacyV0BillingAttribution({
          actorUserId: userId,
          workspaceId,
        })) ?? undefined
    }
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
        (isAttributedProtocol && billingAttribution.workspaceId !== (workspaceId ?? null)) ||
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
      : (billingAttribution?.workspaceId ?? undefined)
    const billingContext = billingAttribution
      ? toBillingContext(billingAttribution)
      : accountDecision
        ? {
            billingEntity: accountDecision.billingEntity,
            billingPeriod: {
              start: new Date(accountDecision.billingPeriod.start),
              end: new Date(accountDecision.billingPeriod.end),
              ...(accountDecision.billingPeriod.source
                ? { source: accountDecision.billingPeriod.source }
                : {}),
            },
          }
        : undefined

    logger.info(`[${requestId}] Billing payer resolved`, {
      userId,
      billingProtocol: protocol,
      billingResolution: getBillingResolution(isMarkerlessLegacy, billingAttribution),
      billingPayer: billingContext?.billingEntity ?? { type: 'user', id: userId },
      workspaceId: resolvedWorkspaceId,
    })

    /**
     * Go sends cumulative cost across partial, terminal, and retry flushes.
     * Every accepted callback has a stable key, so the maximum cumulative cost
     * converges on one ledger event without underbilling or double-billing.
     */
    // A run that outlives its admitted Stripe period records later spend in the payer's current
    // period (see `payerSubscriptionId`), so a closed period is never topped up. Reporting-window
    // payers are closed from live anchors, and free payers have no close to miss.
    const rolloverSubscriptionId =
      billingContext?.billingPeriod.source === 'stripe'
        ? (billingAttribution?.payerSubscription?.id ?? accountDecision?.payerSubscriptionId)
        : undefined
    const usageStartedAt = Date.now()
    const result = await recordCumulativeUsage({
      userId,
      workspaceId: resolvedWorkspaceId,
      ...billingContext,
      source,
      model,
      cost,
      eventKey: `update-cost:${idempotencyKey}`,
      metadata: { inputTokens, outputTokens },
      ...(rolloverSubscriptionId ? { payerSubscriptionId: rolloverSubscriptionId } : {}),
    })
    const billed = result.billed
    logger.info(`[${requestId}] Cumulative cost top-up`, {
      userId,
      source,
      cumulativeCost: cost,
      billedDelta: result.delta,
      newTotal: result.total,
      billed: result.billed,
      durationMs: Date.now() - usageStartedAt,
    })

    // Reconcile the payer's ledger-backed threshold after every cumulative
    // callback, including duplicate retries after a prior settlement failure.
    // Strict error handling lets Go retry until the committed usage is settled.
    if (billingContext) {
      try {
        await checkAndBillPayerOverageThreshold(billingContext.billingEntity, {
          onError: 'throw',
          expectedBillingPeriod: rolloverSubscriptionId
            ? result.billingPeriod
            : billingContext.billingPeriod,
        })
      } catch (error) {
        // The charge committed while its period was still current (the subscription row was
        // share-locked), so the period's close, which waits out its grace after the rollover,
        // invoices it. Refusing here would make the worker drop the run's later charges.
        if (
          !rolloverSubscriptionId ||
          !(error instanceof ThresholdSettlementError) ||
          error.code !== 'billing_period_elapsed'
        ) {
          throw error
        }
        logger.info(`[${requestId}] Charge landed in a period that has since rolled over`, {
          billingPeriodEnd: result.billingPeriod.end.toISOString(),
        })
      }
    } else {
      await checkAndBillOverageThreshold(userId, undefined, { onError: 'throw' })
    }

    const usageVerdict = await readUsageStanding(userId, billingAttribution, accountDecision)
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
          ...usageVerdict,
        },
        { status: 409 }
      )
    }

    logger.info(`[${requestId}] Cost update completed successfully`, {
      userId,
      duration,
      cost,
      usageExceeded: usageVerdict.usageExceeded,
    })

    span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.Billed)
    span.setAttribute(TraceAttr.HttpStatusCode, 200)
    span.setAttribute(TraceAttr.BillingDurationMs, duration)
    return NextResponse.json<BillingUpdateCostResponse>({
      success: true,
      ...usageVerdict,
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

    const pgCode = getPostgresErrorCode(error)
    const pgConstraint = getPostgresConstraintName(error)
    const reconciliationOutcome =
      (error instanceof ThresholdSettlementError && !error.retryable) ||
      error instanceof CumulativeUsagePeriodClosedError
        ? BILLING_CALLBACK_OUTCOME.billingPeriodElapsed
        : pgCode === '23503' && pgConstraint === 'usage_log_user_id_user_id_fk'
          ? BILLING_CALLBACK_OUTCOME.billingUserNotFound
          : undefined

    /** Old markerless clients treat every 409 as a successful duplicate. */
    if (reconciliationOutcome && !isMarkerlessLegacy) {
      logger.warn(`[${requestId}] Billing callback requires reconciliation`, {
        code: reconciliationOutcome.code,
        duration,
        billingProtocol:
          req.headers.get(COPILOT_BILLING_PROTOCOL_HEADER) ?? COPILOT_BILLING_PROTOCOL.legacy,
      })
      span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.ReconciliationRequired)
      span.setAttribute(TraceAttr.HttpStatusCode, 409)
      span.setAttribute(TraceAttr.BillingDurationMs, duration)
      return NextResponse.json(
        {
          success: false,
          code: reconciliationOutcome.code,
          error: reconciliationOutcome.message,
          retryable: false,
          requestId,
        },
        { status: 409 }
      )
    }

    if (error instanceof ThresholdSettlementError) {
      logger.error(`[${requestId}] Retryable threshold settlement failure`, {
        settlementErrorCode: error.code,
        retryable: error.retryable,
        duration,
        billingProtocol:
          req.headers.get(COPILOT_BILLING_PROTOCOL_HEADER) ?? COPILOT_BILLING_PROTOCOL.legacy,
      })
      span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.InternalError)
      span.setAttribute(TraceAttr.HttpStatusCode, 503)
      span.setAttribute(TraceAttr.BillingDurationMs, duration)
      return NextResponse.json(
        {
          success: false,
          ...RETRYABLE_SETTLEMENT_RESPONSE,
          retryable: true,
          requestId,
        },
        {
          status: 503,
          headers: { 'Retry-After': '1' },
        }
      )
    }

    // Surface the underlying Postgres failure (e.g. 23503 FK violation vs a
    // lock timeout) — Drizzle's "Failed query" wrapper alone cannot
    // distinguish them, which made the dead-workspace incident undiagnosable
    // from logs.
    logger.error(`[${requestId}] Cost update failed`, {
      error: toError(error).message,
      ...(pgCode && { pgCode }),
      ...(pgConstraint && { pgConstraint }),
      stack: error instanceof Error ? error.stack : undefined,
      duration,
      billingProtocol:
        req.headers.get(COPILOT_BILLING_PROTOCOL_HEADER) ?? COPILOT_BILLING_PROTOCOL.legacy,
      billingResolution: isMarkerlessLegacy ? 'callback-time-mutable' : 'immutable-envelope',
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
