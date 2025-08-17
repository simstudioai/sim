import { createHmac } from 'crypto'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { copilotApiKeys, userStats } from '@/db/schema'

const logger = createLogger('CopilotApiKeysValidate')

function computeLookup(plaintext: string, keyString: string): string {
  // Deterministic MAC: HMAC-SHA256(DB_KEY, plaintext)
  return createHmac('sha256', Buffer.from(keyString, 'utf8'))
    .update(plaintext, 'utf8')
    .digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    if (!env.AGENT_API_DB_ENCRYPTION_KEY) {
      logger.error('AGENT_API_DB_ENCRYPTION_KEY is not set')
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
    }

    const body = await req.json().catch(() => null)
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey : undefined

    if (!apiKey) {
      return new NextResponse(null, { status: 401 })
    }

    const lookup = computeLookup(apiKey, env.AGENT_API_DB_ENCRYPTION_KEY)

    // Find matching API key and its user
    const rows = await db
      .select({ id: copilotApiKeys.id, userId: copilotApiKeys.userId })
      .from(copilotApiKeys)
      .where(eq(copilotApiKeys.apiKeyLookup, lookup))
      .limit(1)

    if (rows.length === 0) {
      return new NextResponse(null, { status: 401 })
    }

    const { userId } = rows[0]

    // Check usage for the associated user
    const usage = await db
      .select({
        currentPeriodCost: userStats.currentPeriodCost,
        totalCost: userStats.totalCost,
        currentUsageLimit: userStats.currentUsageLimit,
      })
      .from(userStats)
      .where(eq(userStats.userId, userId))
      .limit(1)

    if (usage.length > 0) {
      const currentUsage = Number.parseFloat(
        (usage[0].currentPeriodCost?.toString() as string) ||
          (usage[0].totalCost as unknown as string) ||
          '0'
      )
      const limit = Number.parseFloat((usage[0].currentUsageLimit as unknown as string) || '0')

      if (!Number.isNaN(limit) && limit > 0 && currentUsage >= limit) {
        // Usage exceeded
        logger.info('[API VALIDATION] Usage exceeded', { userId, currentUsage, limit })
        return new NextResponse(null, { status: 402 })
      }
    }

    // Valid and within usage limits
    return new NextResponse(null, { status: 200 })
  } catch (error) {
    logger.error('Error validating copilot API key', { error })
    return NextResponse.json({ error: 'Failed to validate key' }, { status: 500 })
  }
}
