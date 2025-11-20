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

const logger = createLogger('BillingUpdateCostAPI')

const UpdateCostSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  cost: z.number().min(0, 'Cost must be a non-negative number'),
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

    const { userId, cost } = validation.data

    logger.info(`[${requestId}] Processing cost update`, {
      userId,
      cost,
    })

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
    // Update existing user stats record
    const updateFields = {
      totalCost: sql`total_cost + ${cost}`,
      currentPeriodCost: sql`current_period_cost + ${cost}`,
      // Copilot usage tracking increments
      totalCopilotCost: sql`total_copilot_cost + ${cost}`,
      currentPeriodCopilotCost: sql`current_period_copilot_cost + ${cost}`,
      totalCopilotCalls: sql`total_copilot_calls + 1`,
      lastActive: new Date(),
    }

    await db.update(userStats).set(updateFields).where(eq(userStats.userId, userId))

    logger.info(`[${requestId}] Updated user stats record`, {
      userId,
      addedCost: cost,
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
