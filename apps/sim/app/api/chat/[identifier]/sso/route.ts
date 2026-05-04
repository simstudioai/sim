import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { chatSSOContract } from '@/lib/api/contracts/chats'
import { parseRequest } from '@/lib/api/server'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { addCorsHeaders, isEmailAllowed } from '@/lib/core/security/deployment'
import { generateRequestId, getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatSSOAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const rateLimiter = new RateLimiter()

const SSO_IP_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 20,
  refillRate: 20,
  refillIntervalMs: 15 * 60_000,
}

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ identifier: string }> }) => {
    const requestId = generateRequestId()

    const ip = getClientIp(request)
    if (ip !== 'unknown') {
      const ipRateLimit = await rateLimiter.checkRateLimitDirect(
        `chat-sso:ip:${ip}`,
        SSO_IP_RATE_LIMIT
      )
      if (!ipRateLimit.allowed) {
        logger.warn(`[${requestId}] SSO eligibility rate limit exceeded from ${ip}`)
        const retryAfter = Math.ceil(
          (ipRateLimit.retryAfterMs ?? SSO_IP_RATE_LIMIT.refillIntervalMs) / 1000
        )
        const response = createErrorResponse('Too many requests. Please try again later.', 429)
        response.headers.set('Retry-After', String(retryAfter))
        return addCorsHeaders(response, request)
      }
    }

    const parsed = await parseRequest(chatSSOContract, request, context)
    if (!parsed.success) return parsed.response

    const { identifier } = parsed.data.params
    const { email } = parsed.data.body

    const [deployment] = await db
      .select({
        authType: chat.authType,
        allowedEmails: chat.allowedEmails,
        isActive: chat.isActive,
      })
      .from(chat)
      .where(and(eq(chat.identifier, identifier), isNull(chat.archivedAt)))
      .limit(1)

    if (!deployment || !deployment.isActive) {
      logger.warn(`[${requestId}] SSO check on missing/inactive chat: ${identifier}`)
      return addCorsHeaders(createErrorResponse('Chat not found', 404), request)
    }

    if (deployment.authType !== 'sso') {
      return addCorsHeaders(
        createErrorResponse('Chat is not configured for SSO authentication', 400),
        request
      )
    }

    const eligible = isEmailAllowed(email, (deployment.allowedEmails as string[]) || [])

    return addCorsHeaders(createSuccessResponse({ eligible }), request)
  }
)
