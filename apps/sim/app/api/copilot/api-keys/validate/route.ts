import { db } from '@sim/db'
import { userStats } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotApiKeysValidate')

export async function POST(req: NextRequest) {
  try {
    // Authenticate via internal API key header
    const auth = checkInternalApiKey(req)
    if (!auth.success) {
      return new NextResponse(null, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const userId = typeof body?.userId === 'string' ? body.userId : undefined

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    logger.info('[API VALIDATION] Validating usage limit', { userId })

    const usage = await db
      .select({
        currentPeriodCost: userStats.currentPeriodCost,
        totalCost: userStats.totalCost,
        currentUsageLimit: userStats.currentUsageLimit,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    logger.info('[API VALIDATION] Usage limit validated', { userId, usage })

    if (usage.length > 0) {
      const currentUsage = Number.parseFloat(
        (usage[0].currentPeriodCost?.toString() as string) ||
          (usage[0].totalCost as unknown as string) ||
          '0'
      )
      const limit = Number.parseFloat((usage[0].currentUsageLimit as unknown as string) || '0')

      if (!Number.isNaN(limit) && limit > 0 && currentUsage >= limit) {
        logger.info('[API VALIDATION] Usage exceeded', { userId, currentUsage, limit })
        return new NextResponse(null, { status: 402 })
      }
    }

    return new NextResponse(null, { status: 200 })
  } catch (error) {
    logger.error('Error validating usage limit', { error })
    return NextResponse.json({ error: 'Failed to validate usage' }, { status: 500 })
  }
}
