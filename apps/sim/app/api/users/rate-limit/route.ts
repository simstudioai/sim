import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

export const dynamic = 'force-dynamic'

import { db } from '@/db'
import { apiKey as apiKeyTable, subscription } from '@/db/schema'
import { RateLimiter } from '@/services/queue'
import { createErrorResponse } from '../../workflows/utils'

const logger = createLogger('RateLimitAPI')

export async function GET(request: NextRequest) {
  try {
    // Try session auth first (for web UI)
    const session = await getSession()
    let authenticatedUserId: string | null = session?.user?.id || null

    // If no session, check for API key auth
    if (!authenticatedUserId) {
      const apiKeyHeader = request.headers.get('x-api-key')
      if (apiKeyHeader) {
        // Verify API key
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

    // Get user subscription
    const [subscriptionRecord] = await db
      .select({ plan: subscription.plan })
      .from(subscription)
      .where(eq(subscription.referenceId, authenticatedUserId))
      .limit(1)

    const subscriptionPlan = (subscriptionRecord?.plan || 'free') as
      | 'free'
      | 'pro'
      | 'team'
      | 'enterprise'

    const rateLimiter = new RateLimiter()
    const isApiAuth = !session?.user?.id
    const triggerType = isApiAuth ? 'api' : 'manual'

    const syncStatus = await rateLimiter.getRateLimitStatus(
      authenticatedUserId,
      subscriptionPlan,
      triggerType,
      false
    )
    const asyncStatus = await rateLimiter.getRateLimitStatus(
      authenticatedUserId,
      subscriptionPlan,
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
