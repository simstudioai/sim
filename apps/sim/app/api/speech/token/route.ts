import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier, isBillingEnabled } from '@/lib/core/config/feature-flags'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { validateAuthToken } from '@/lib/core/security/deployment'
import { getClientIp } from '@/lib/core/utils/request'

const logger = createLogger('SpeechTokenAPI')

export const dynamic = 'force-dynamic'

const ELEVENLABS_TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'

const VOICE_SESSION_COST_PER_MIN = 0.008
const WORKSPACE_SESSION_MAX_MINUTES = 3
const CHAT_SESSION_MAX_MINUTES = 1

const STT_TOKEN_RATE_LIMIT = {
  maxTokens: 30,
  refillRate: 3,
  refillIntervalMs: 72 * 1000,
} as const

const rateLimiter = new RateLimiter()

async function validateChatAuth(
  request: NextRequest,
  chatId: string
): Promise<{ valid: boolean; ownerId?: string }> {
  try {
    const chatResult = await db
      .select({
        id: chat.id,
        userId: chat.userId,
        isActive: chat.isActive,
        authType: chat.authType,
        password: chat.password,
      })
      .from(chat)
      .where(eq(chat.id, chatId))
      .limit(1)

    if (chatResult.length === 0 || !chatResult[0].isActive) {
      return { valid: false }
    }

    const chatData = chatResult[0]

    if (chatData.authType === 'public') {
      return { valid: true, ownerId: chatData.userId }
    }

    const cookieName = `chat_auth_${chatId}`
    const authCookie = request.cookies.get(cookieName)
    if (authCookie && validateAuthToken(authCookie.value, chatId, chatData.password)) {
      return { valid: true, ownerId: chatData.userId }
    }

    return { valid: false }
  } catch (error) {
    logger.error('Error validating chat auth for STT:', error)
    return { valid: false }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const chatId = body?.chatId as string | undefined

    let billingUserId: string | undefined

    if (chatId) {
      const chatAuth = await validateChatAuth(request, chatId)
      if (!chatAuth.valid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      billingUserId = chatAuth.ownerId
    } else {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      billingUserId = session.user.id
    }

    if (isBillingEnabled) {
      const rateLimitKey = chatId
        ? `stt-token:chat:${chatId}:${getClientIp(request)}`
        : `stt-token:user:${billingUserId}`

      const rateCheck = await rateLimiter.checkRateLimitDirect(rateLimitKey, STT_TOKEN_RATE_LIMIT)
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: 'Voice input rate limit exceeded. Please try again later.' },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil((rateCheck.retryAfterMs ?? 60000) / 1000)),
            },
          }
        )
      }
    }

    if (billingUserId) {
      const usageCheck = await checkServerSideUsageLimits(billingUserId)
      if (usageCheck.isExceeded) {
        return NextResponse.json(
          {
            error:
              usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
          },
          { status: 402 }
        )
      }
    }

    const apiKey = env.ELEVENLABS_API_KEY
    if (!apiKey?.trim()) {
      return NextResponse.json(
        { error: 'Speech-to-text service is not configured' },
        { status: 503 }
      )
    }

    const response = await fetch(ELEVENLABS_TOKEN_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
    })

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}))
      const message =
        errBody.detail || errBody.message || `Token request failed (${response.status})`
      logger.error('ElevenLabs token request failed', { status: response.status, message })
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const data = await response.json()

    if (billingUserId) {
      const maxMinutes = chatId ? CHAT_SESSION_MAX_MINUTES : WORKSPACE_SESSION_MAX_MINUTES
      const sessionCost = VOICE_SESSION_COST_PER_MIN * maxMinutes

      await recordUsage({
        userId: billingUserId,
        entries: [
          {
            category: 'fixed',
            source: 'voice-input',
            description: `Voice input session (${maxMinutes} min)`,
            cost: sessionCost * getCostMultiplier(),
          },
        ],
      }).catch((err) => {
        logger.warn('Failed to record voice input usage, continuing:', err)
      })
    }

    return NextResponse.json({ token: data.token })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate speech token'
    logger.error('Speech token error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
