import { db } from '@sim/db'
import { userStats } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkAndBillOverageThreshold } from '@/lib/billing/threshold-billing'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { isBillingEnabled } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('BillingUpdateCostAPI')

const UpdateCostSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  input: z.number().min(0, 'Input tokens must be a non-negative number'),
  output: z.number().min(0, 'Output tokens must be a non-negative number'),
  model: z.string().min(1, 'Model is required'),
  inputMultiplier: z.number().min(0),
  outputMultiplier: z.number().min(0),
})

/**
 * POST /api/billing/update-cost
 * Update user cost based on token usage with internal API key auth
 */
export async function POST(req: NextRequest) {
  const requestId = generateRequestId()
  const startTime = Date.now()

  try {
    logger.info(`[${requestId}] Update cost request started`)

    if (!isBillingEnabled) {
      logger.debug(`[${requestId}] Billing is disabled, skipping cost update`)
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

    // Parse and validate request body
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

    const { userId, input, output, model, inputMultiplier, outputMultiplier } = validation.data

    logger.info(`[${requestId}] Processing cost update`, {
      userId,
      input,
      output,
      model,
      inputMultiplier,
      outputMultiplier,
    })

    const finalPromptTokens = input
    const finalCompletionTokens = output
    const totalTokens = input + output

    // Calculate cost using provided multiplier (required)
    const costResult = calculateCost(
      model,
      finalPromptTokens,
      finalCompletionTokens,
      false,
      inputMultiplier,
      outputMultiplier
    )

    logger.info(`[${requestId}] Cost calculation result`, {
      userId,
      model,
      promptTokens: finalPromptTokens,
      completionTokens: finalCompletionTokens,
      totalTokens: totalTokens,
      inputMultiplier,
      outputMultiplier,
      costResult,
    })

    // Follow the exact same logic as ExecutionLogger.updateUserStats but with direct userId
    const costToStore = costResult.total // No additional multiplier needed since calculateCost already applied it

    // Check if user stats record exists (same as ExecutionLogger)
    const userStatsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))

    if (userStatsRecords.length === 0) {
      logger.error(
        `[${requestId}] User stats record not found - should be created during onboarding`,
        {
          userId,
        }
      )
      return NextResponse.json({ error: 'User stats record not found' }, { status: 500 })
    }
    // Update existing user stats record (same logic as ExecutionLogger)
    const updateFields = {
      totalTokensUsed: sql`total_tokens_used + ${totalTokens}`,
      totalCost: sql`total_cost + ${costToStore}`,
      currentPeriodCost: sql`current_period_cost + ${costToStore}`,
      // Copilot usage tracking increments
      totalCopilotCost: sql`total_copilot_cost + ${costToStore}`,
      totalCopilotTokens: sql`total_copilot_tokens + ${totalTokens}`,
      totalCopilotCalls: sql`total_copilot_calls + 1`,
      totalApiCalls: sql`total_api_calls`,
      lastActive: new Date(),
    }

    await db.update(userStats).set(updateFields).where(eq(userStats.userId, userId))

    logger.info(`[${requestId}] Updated user stats record`, {
      userId,
      addedCost: costToStore,
      addedTokens: totalTokens,
    })

    // Check if user has hit overage threshold and bill incrementally
    await checkAndBillOverageThreshold(userId)

    const duration = Date.now() - startTime

    logger.info(`[${requestId}] Cost update completed successfully`, {
      userId,
      duration,
      cost: costResult.total,
      totalTokens,
    })

    return NextResponse.json({
      success: true,
      data: {
        userId,
        input,
        output,
        totalTokens,
        model,
        cost: {
          input: costResult.input,
          output: costResult.output,
          total: costResult.total,
        },
        tokenBreakdown: {
          prompt: finalPromptTokens,
          completion: finalCompletionTokens,
          total: totalTokens,
        },
        pricing: costResult.pricing,
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
