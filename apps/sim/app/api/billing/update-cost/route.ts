import crypto from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/env'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { userStats } from '@/db/schema'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('billing-update-cost')

// Schema for the request body
const UpdateCostSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  input: z.number().min(0, 'Input tokens must be a non-negative number'),
  output: z.number().min(0, 'Output tokens must be a non-negative number'),
  model: z.string().min(1, 'Model is required'),
})

// Authentication function (reused from copilot/methods route)
function checkInternalApiKey(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  const expectedApiKey = env.INTERNAL_API_SECRET

  if (!expectedApiKey) {
    return { success: false, error: 'Internal API key not configured' }
  }

  if (!apiKey) {
    return { success: false, error: 'API key required' }
  }

  if (apiKey !== expectedApiKey) {
    return { success: false, error: 'Invalid API key' }
  }

  return { success: true }
}

/**
 * POST /api/billing/update-cost
 * Update user cost based on token usage with internal API key auth
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()

  try {
    logger.info(`[${requestId}] Update cost request started`)

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

    const { userId, input, output, model } = validation.data

    logger.info(`[${requestId}] Processing cost update`, {
      userId,
      input,
      output,
      model,
    })

    const finalPromptTokens = input
    const finalCompletionTokens = output
    const totalTokens = input + output

    // Calculate cost using COPILOT_COST_MULTIPLIER (only in production, like normal executions)
    const copilotMultiplier = isProd ? env.COPILOT_COST_MULTIPLIER || 1 : 1
    const costResult = calculateCost(
      model,
      finalPromptTokens,
      finalCompletionTokens,
      false,
      copilotMultiplier
    )

    logger.info(`[${requestId}] Cost calculation result`, {
      userId,
      model,
      promptTokens: finalPromptTokens,
      completionTokens: finalCompletionTokens,
      totalTokens: totalTokens,
      copilotMultiplier,
      costResult,
    })

    // Follow the exact same logic as ExecutionLogger.updateUserStats but with direct userId
    const costToStore = costResult.total // No additional multiplier needed since calculateCost already applied it

    // Check if user stats record exists (same as ExecutionLogger)
    const userStatsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))

    if (userStatsRecords.length === 0) {
      // Create new user stats record (same logic as ExecutionLogger)
      await db.insert(userStats).values({
        id: crypto.randomUUID(),
        userId: userId,
        totalManualExecutions: 0,
        totalApiCalls: 0,
        totalWebhookTriggers: 0,
        totalScheduledExecutions: 0,
        totalChatExecutions: 0,
        totalTokensUsed: totalTokens,
        totalCost: costToStore.toString(),
        currentPeriodCost: costToStore.toString(),
        lastActive: new Date(),
      })

      logger.info(`[${requestId}] Created new user stats record`, {
        userId,
        totalCost: costToStore,
        totalTokens,
      })
    } else {
      // Update existing user stats record (same logic as ExecutionLogger)
      const updateFields = {
        totalTokensUsed: sql`total_tokens_used + ${totalTokens}`,
        totalCost: sql`total_cost + ${costToStore}`,
        currentPeriodCost: sql`current_period_cost + ${costToStore}`,
        totalApiCalls: sql`total_api_calls`,
        lastActive: new Date(),
      }

      await db.update(userStats).set(updateFields).where(eq(userStats.userId, userId))

      logger.info(`[${requestId}] Updated user stats record`, {
        userId,
        addedCost: costToStore,
        addedTokens: totalTokens,
      })
    }

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
