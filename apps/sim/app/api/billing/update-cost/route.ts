import type { Span } from '@opentelemetry/api'
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode, toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { billingUpdateCostContract } from '@/lib/api/contracts/subscription'
import { parseRequest } from '@/lib/api/server'
import { recordCumulativeUsage, recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import { BillingRouteOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { checkInternalApiKey } from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('BillingUpdateCostAPI')

/**
 * Resolves the request-supplied workspace to one that exists in this
 * deployment. Workspace attribution on the usage ledger is best-effort:
 * self-hosted and headless clients bill through this endpoint with workspace
 * IDs from their own databases, and `usage_log.workspace_id` carries an FK to
 * `workspace`, so stamping a foreign ID would fail the entire flush with an
 * FK violation and strand real cost in the caller's dead-letter queue.
 * Unknown workspaces are recorded unattributed instead — billing is keyed on
 * the user's billing entity and never depends on the workspace.
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

    const attributedWorkspaceId = await resolveAttributableWorkspaceId(requestId, workspaceId)

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
        workspaceId: attributedWorkspaceId,
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
        workspaceId: attributedWorkspaceId,
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

    const duration = Date.now() - startTime

    // Same-or-lower cumulative than already recorded: nothing new to bill. Tell
    // the caller via 409 (its existing "duplicate" outcome) without re-running
    // overage billing.
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
          error: 'Duplicate request: cumulative cost already recorded',
          requestId,
        },
        { status: 409 }
      )
    }

    // Check if user has hit overage threshold and bill incrementally. Reads the
    // (now topped-up) ledger total and is idempotent against billedOverage, so
    // it is safe to run on every flush that records new cost.
    await checkAndBillOverageThreshold(userId)

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
