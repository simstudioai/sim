import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { createLogger } from '@/lib/logs/console/logger'
import { createErrorResponse } from '@/app/api/workflows/utils'
import { db } from '@/db'
import { apiKey as apiKeyTable } from '@/db/schema'
import { RateLimiter } from '@/services/queue'

const logger = createLogger('RateLimitAPI')

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    let authenticatedUserId: string | null = session?.user?.id || null

    if (!authenticatedUserId) {
      const apiKeyHeader = request.headers.get('x-api-key')
      if (apiKeyHeader) {
        const [apiKeyRecord] = await db
          .select({ userId: apiKeyTable.userId })
          .from(apiKeyTable)
          .where(eq(apiKeyTable.key, apiKeyHeader))
          .limit(1)

        if (apiKeyRecord) {
          authenticatedUserId = apiKeyRecord.userId
        }
      }
    }

    if (!authenticatedUserId) {
      return createErrorResponse('Authentication required', 401)
    }

    // Get user subscription (checks both personal and org subscriptions)
    const userSubscription = await getHighestPrioritySubscription(authenticatedUserId)

    const rateLimiter = new RateLimiter()
    const isApiAuth = !session?.user?.id
    const triggerType = isApiAuth ? 'api' : 'manual'

    const syncStatus = await rateLimiter.getRateLimitStatusWithSubscription(
      authenticatedUserId,
      userSubscription,
      triggerType,
      false
    )
    const asyncStatus = await rateLimiter.getRateLimitStatusWithSubscription(
      authenticatedUserId,
      userSubscription,
      triggerType,
      true
    )

    return NextResponse.json({
      success: true,
      rateLimit: {
        sync: {
          isLimited: syncStatus.remaining === 0,
          limit: syncStatus.limit,
          remaining: syncStatus.remaining,
          resetAt: syncStatus.resetAt,
        },
        async: {
          isLimited: asyncStatus.remaining === 0,
          limit: asyncStatus.limit,
          remaining: asyncStatus.remaining,
          resetAt: asyncStatus.resetAt,
        },
        authType: triggerType,
      },
    })
  } catch (error: any) {
    logger.error('Error checking rate limit:', error)
    return createErrorResponse(error.message || 'Failed to check rate limit', 500)
  }
}
