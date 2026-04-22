import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import { BillingRouteOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { checkInternalApiKey } from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { type AtomicClaimResult, billingIdempotency } from '@/lib/core/idempotency/service'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('BillingUpdateCostAPI')

const UpdateCostSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  cost: z.number().min(0, 'Cost must be a non-negative number'),
  model: z.string().min(1, 'Model is required'),
  inputTokens: z.number().min(0).default(0),
  outputTokens: z.number().min(0).default(0),
  source: z
    .enum(['copilot', 'workspace-chat', 'mcp_copilot', 'mothership_block'])
    .default('copilot'),
  idempotencyKey: z.string().min(1).optional(),
})

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

async function updateCostInner(
  req: NextRequest,
  span: import('@opentelemetry/api').Span
): Promise<NextResponse> {
  const requestId = generateRequestId()
  const startTime = Date.now()
  let claim: AtomicClaimResult | null = null
  let usageCommitted = false

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

    const body = await req.json()
    const validation = UpdateCostSchema.safeParse(body)

    if (!validation.success) {
      logger.warn(`[${requestId}] Invalid request body`, {
        errors: validation.error.issues,
      })
      span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.InvalidBody)
      span.setAttribute(TraceAttr.HttpStatusCode, 400)
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }

    const { userId, cost, model, inputTokens, outputTokens, source, idempotencyKey } =
      validation.data
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

    claim = idempotencyKey
      ? await billingIdempotency.atomicallyClaim('update-cost', idempotencyKey)
      : null

    if (claim && !claim.claimed) {
      logger.warn(`[${requestId}] Duplicate billing update rejected`, {
        idempotencyKey,
        userId,
        source,
      })
      span.setAttribute(TraceAttr.BillingOutcome, BillingRouteOutcome.DuplicateIdempotencyKey)
      span.setAttribute(TraceAttr.HttpStatusCode, 409)
      return NextResponse.json(
        {
          success: false,
          error: 'Duplicate request: idempotency key already processed',
          requestId,
        },
        { status: 409 }
      )
    }

    logger.info(`[${requestId}] Processing cost update`, {
      userId,
      cost,
      model,
      source,
    })

    const totalTokens = inputTokens + outputTokens

    const additionalStats: Record<string, ReturnType<typeof sql>> = {
      totalCopilotCost: sql`total_copilot_cost + ${cost}`,
      currentPeriodCopilotCost: sql`current_period_copilot_cost + ${cost}`,
      totalCopilotCalls: sql`total_copilot_calls + 1`,
      totalCopilotTokens: sql`total_copilot_tokens + ${totalTokens}`,
    }

    if (isMcp) {
      additionalStats.totalMcpCopilotCost = sql`total_mcp_copilot_cost + ${cost}`
      additionalStats.currentPeriodMcpCopilotCost = sql`current_period_mcp_copilot_cost + ${cost}`
      additionalStats.totalMcpCopilotCalls = sql`total_mcp_copilot_calls + 1`
    }

    await recordUsage({
      userId,
      entries: [
        {
          category: 'model',
          source,
          description: model,
          cost,
          metadata: { inputTokens, outputTokens },
        },
      ],
      additionalStats,
    })
    usageCommitted = true

    logger.info(`[${requestId}] Recorded usage`, {
      userId,
      addedCost: cost,
      source,
    })

    // Check if user has hit overage threshold and bill incrementally
    await checkAndBillOverageThreshold(userId)

    const duration = Date.now() - startTime

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

    logger.error(`[${requestId}] Cost update failed`, {
      error: toError(error).message,
      stack: error instanceof Error ? error.stack : undefined,
      duration,
    })

    if (claim?.claimed && !usageCommitted) {
      await billingIdempotency
        .release(claim.normalizedKey, claim.storageMethod)
        .catch((releaseErr) => {
          logger.warn(`[${requestId}] Failed to release idempotency claim`, {
            error: toError(releaseErr).message,
            normalizedKey: claim?.normalizedKey,
          })
        })
    } else if (claim?.claimed && usageCommitted) {
      logger.warn(
        `[${requestId}] Error occurred after usage committed; retaining idempotency claim to prevent double-billing`,
        { normalizedKey: claim.normalizedKey }
      )
    }

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
