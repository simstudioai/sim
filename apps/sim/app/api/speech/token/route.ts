import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { speechTokenBodySchema } from '@/lib/api/contracts/media/speech'
import { getSession } from '@/lib/auth'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier, isBillingEnabled } from '@/lib/core/config/env-flags'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { validateAuthToken } from '@/lib/core/security/deployment'
import { getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
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
    const rawBody = await request.json().catch(() => ({}))
    const body = speechTokenBodySchema.safeParse(rawBody)
    const chatId =
      body.success && typeof body.data.chatId === 'string' ? body.data.chatId : undefined

    let billingUserId: string | undefined
    let workspaceId: string | undefined

    if (chatId) {
      const chatAuth = await validateChatAuth(request, chatId)
      if (!chatAuth.valid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      // A deployed chat is used by anonymous end-users, so the cost belongs to the
      // workspace's billed account (the deployment's payer) — matching how the
      // chat's workflow execution bills. Fall back to the chat owner only when no
      // billed account resolves.
      workspaceId = chatAuth.workspaceId ?? undefined
      const billedAccountUserId = workspaceId
        ? await getWorkspaceBilledAccountUserId(workspaceId)
        : null
      billingUserId = billedAccountUserId ?? chatAuth.ownerId
    } else {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      billingUserId = session.user.id
      // Editor voice: only attribute to a workspace the caller actually belongs to,
      // so a client-supplied id can't misattribute (or dodge) per-member usage.
      const requestedWorkspaceId =
        body.success && typeof body.data.workspaceId === 'string'
          ? body.data.workspaceId
          : undefined
      if (requestedWorkspaceId) {
        const permission = await verifyWorkspaceMembership(session.user.id, requestedWorkspaceId)
        if (permission) workspaceId = requestedWorkspaceId
      }
      // Editor voice is always workspace-scoped; require an attributable workspace
      // so per-member usage can't be skipped and the cost stamped workspace-less.
      if (!workspaceId) {
        return NextResponse.json({ error: 'Workspace context is required.' }, { status: 400 })
      }
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
      const usageCheck = await checkActorUsageLimits(billingUserId, workspaceId)
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

    if (billingUserId) {
      const maxMinutes = chatId ? CHAT_SESSION_MAX_MINUTES : WORKSPACE_SESSION_MAX_MINUTES
      const sessionCost = VOICE_SESSION_COST_PER_MIN * maxMinutes

      await recordUsage({
        userId: billingUserId,
        workspaceId,
        entries: [
          {
            category: 'fixed',
            source: 'voice-input',
            description: `Voice input session (${maxMinutes} min)`,
            cost: sessionCost * getCostMultiplier(),
            sourceReference: `voice-input:${hashVoiceToken(data.token)}`,
          },
        ],
      }).catch((err) => {
        logger.warn('Failed to record voice input usage, continuing:', err)
      })
    }

    return NextResponse.json({ token: data.token })
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to generate speech token')
    logger.error('Speech token error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
})
