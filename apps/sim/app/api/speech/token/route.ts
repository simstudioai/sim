import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { speechTokenBodySchema } from '@/lib/api/contracts/media/speech'
import { parseOptionalJsonBody } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  resolveBillingAttribution,
  resolveSystemBillingAttribution,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier, isBillingEnabled } from '@/lib/core/config/env-flags'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { validateAuthToken } from '@/lib/core/security/deployment'
import { getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

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

/**
 * This body only ever carries an optional chatId/workspaceId string, so a
 * tight cap keeps an unauthenticated caller from forcing a large in-memory
 * allocation before the auth checks below run.
 */
const MAX_SPEECH_TOKEN_BODY_BYTES = 16 * 1024

function hashVoiceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const rateLimiter = new RateLimiter()

async function validateChatAuth(
  request: NextRequest,
  chatId: string
): Promise<{ valid: boolean; ownerId?: string; workspaceId?: string | null }> {
  try {
    const chatResult = await db
      .select({
        id: chat.id,
        userId: chat.userId,
        isActive: chat.isActive,
        authType: chat.authType,
        password: chat.password,
        workspaceId: workflow.workspaceId,
      })
      .from(chat)
      .leftJoin(workflow, eq(workflow.id, chat.workflowId))
      .where(eq(chat.id, chatId))
      .limit(1)

    if (chatResult.length === 0 || !chatResult[0].isActive) {
      return { valid: false }
    }

    const chatData = chatResult[0]

    if (chatData.authType === 'public') {
      return { valid: true, ownerId: chatData.userId, workspaceId: chatData.workspaceId }
    }

    const cookieName = `chat_auth_${chatId}`
    const authCookie = request.cookies.get(cookieName)
    if (
      authCookie &&
      validateAuthToken(authCookie.value, chatId, chatData.authType, chatData.password)
    ) {
      return { valid: true, ownerId: chatData.userId, workspaceId: chatData.workspaceId }
    }

    return { valid: false }
  } catch (error) {
    logger.error('Error validating chat auth for STT:', error)
    return { valid: false }
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const parsedBody = await parseOptionalJsonBody(request, MAX_SPEECH_TOKEN_BODY_BYTES)
    if (!parsedBody.success) return parsedBody.response
    const body = speechTokenBodySchema.safeParse(parsedBody.data ?? {})
    const chatId =
      body.success && typeof body.data.chatId === 'string' ? body.data.chatId : undefined

    let actorUserId: string | undefined
    let workspaceId: string | undefined
    let billingAttribution: BillingAttributionSnapshot | undefined

    if (chatId) {
      const chatAuth = await validateChatAuth(request, chatId)
      if (!chatAuth.valid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      /**
       * Anonymous deployed chats have no human request actor, so resolve the
       * system actor and immutable workspace payer together.
       */
      workspaceId = chatAuth.workspaceId ?? undefined
      if (workspaceId) {
        billingAttribution = await resolveSystemBillingAttribution(workspaceId)
        actorUserId = billingAttribution.actorUserId
      } else {
        actorUserId = chatAuth.ownerId
      }
    } else {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      actorUserId = session.user.id
      /**
       * Editor voice accepts only a workspace the caller belongs to, preventing
       * client-supplied IDs from misattributing or bypassing member usage.
       */
      const requestedWorkspaceId =
        body.success && typeof body.data.workspaceId === 'string'
          ? body.data.workspaceId
          : undefined
      if (requestedWorkspaceId) {
        const permission = await verifyWorkspaceMembership(session.user.id, requestedWorkspaceId)
        if (permission) workspaceId = requestedWorkspaceId
      }
      /**
       * Editor voice is workspace-scoped so every charge has a payer and member
       * cap attribution.
       */
      if (!workspaceId) {
        return NextResponse.json({ error: 'Workspace context is required.' }, { status: 400 })
      }
    }

    if (!billingAttribution && actorUserId && workspaceId) {
      billingAttribution = await resolveBillingAttribution({
        actorUserId,
        workspaceId,
      })
    }

    if (isBillingEnabled) {
      const rateLimitKey = chatId
        ? `stt-token:chat:${chatId}:${getClientIp(request)}`
        : `stt-token:user:${actorUserId}`

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

    if (actorUserId) {
      const usageCheck = billingAttribution
        ? await checkAttributedUsageLimits(billingAttribution)
        : await checkActorUsageLimits(actorUserId)
      if (usageCheck.isExceeded) {
        return NextResponse.json(
          {
            error:
              usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
            scope: usageCheck.scope,
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

    if (actorUserId) {
      const maxMinutes = chatId ? CHAT_SESSION_MAX_MINUTES : WORKSPACE_SESSION_MAX_MINUTES
      const sessionCost = VOICE_SESSION_COST_PER_MIN * maxMinutes

      try {
        await recordUsage({
          userId: actorUserId,
          workspaceId,
          ...(billingAttribution ? toBillingContext(billingAttribution) : {}),
          entries: [
            {
              category: 'fixed',
              source: 'voice-input',
              description: `Voice input session (${maxMinutes} min)`,
              cost: sessionCost * getCostMultiplier(),
              sourceReference: `voice-input:${hashVoiceToken(data.token)}`,
            },
          ],
        })
        if (billingAttribution) {
          await checkAndBillPayerOverageThreshold(billingAttribution.billingEntity)
        }
      } catch (err) {
        logger.warn('Failed to record voice input usage, continuing:', err)
      }
    }

    return NextResponse.json({ token: data.token })
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to generate speech token')
    logger.error('Speech token error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
})
