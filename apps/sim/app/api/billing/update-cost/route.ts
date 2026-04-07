import { createLogger } from '@sim/logger'
import { sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { generateRequestId } from '@/lib/core/utils/request'

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
})

/**
 * POST /api/billing/update-cost
 * Update user cost with a pre-calculated cost value (internal API key auth required)
 */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId()
  const startTime = Date.now()

  try {
    logger.info(`[${requestId}] Update cost request started`)

    if (!isBillingEnabled) {
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
        body,
      })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }

    const { userId, cost, model, inputTokens, outputTokens, source } = validation.data
    const isMcp = source === 'mcp_copilot'

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
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      duration,
    })

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
