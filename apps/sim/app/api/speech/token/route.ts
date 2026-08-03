import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { speechTokenBodySchema } from '@/lib/api/contracts/media/speech'
import { parseOptionalJsonBody } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  checkAttributedUsageLimits,
  resolveBillingAttribution,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier, isBillingEnabled } from '@/lib/core/config/env-flags'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'

const logger = createLogger('SpeechTokenAPI')

export const dynamic = 'force-dynamic'

const ELEVENLABS_TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'

const VOICE_SESSION_COST_PER_MIN = 0.008
const WORKSPACE_SESSION_MAX_MINUTES = 3

const STT_TOKEN_RATE_LIMIT = {
  maxTokens: 30,
  refillRate: 3,
  refillIntervalMs: 72 * 1000,
} as const

/**
 * This body only ever carries an optional workspaceId string, so a
 * tight cap keeps an unauthenticated caller from forcing a large in-memory
 * allocation before the auth checks below run.
 */
const MAX_SPEECH_TOKEN_BODY_BYTES = 16 * 1024

function hashVoiceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const rateLimiter = new RateLimiter()

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const parsedBody = await parseOptionalJsonBody(request, MAX_SPEECH_TOKEN_BODY_BYTES)
    if (!parsedBody.success) return parsedBody.response
    const body = speechTokenBodySchema.safeParse(parsedBody.data ?? {})

    let workspaceId: string | undefined

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const actorUserId = session.user.id
    /**
     * Accepts only a workspace the caller belongs to, preventing client-supplied
     * IDs from misattributing or bypassing member usage.
     */
    const requestedWorkspaceId =
      body.success && typeof body.data.workspaceId === 'string' ? body.data.workspaceId : undefined
    if (requestedWorkspaceId) {
      const permission = await verifyWorkspaceMembership(session.user.id, requestedWorkspaceId)
      if (permission) workspaceId = requestedWorkspaceId
    }
    /**
     * Workspace-scoped so every charge has a payer and member cap attribution.
     */
    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace context is required.' }, { status: 400 })
    }

    const billingAttribution = await resolveBillingAttribution({ actorUserId, workspaceId })

    if (isBillingEnabled) {
      const rateCheck = await rateLimiter.checkRateLimitDirect(
        `stt-token:user:${actorUserId}`,
        STT_TOKEN_RATE_LIMIT
      )
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

    /**
     * Read-then-act, as every metered route in the repo does: concurrent calls
     * can pass against the same balance and overshoot the payer's limit. Making
     * this atomic needs a reservation primitive in `lib/billing` that fixes the
     * class everywhere, not a one-off here.
     *
     * Accepted as bounded rather than eliminated: this route is session-gated
     * and rate limited per user, so the overshoot is a knowable ceiling against
     * an identified payer.
     */
    const usageCheck = await checkAttributedUsageLimits(billingAttribution)
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

    const sessionCost = VOICE_SESSION_COST_PER_MIN * WORKSPACE_SESSION_MAX_MINUTES

    try {
      await recordUsage({
        userId: actorUserId,
        workspaceId,
        ...toBillingContext(billingAttribution),
        entries: [
          {
            category: 'fixed',
            source: 'voice-input',
            description: `Voice input session (${WORKSPACE_SESSION_MAX_MINUTES} min)`,
            cost: sessionCost * getCostMultiplier(),
            sourceReference: `voice-input:${hashVoiceToken(data.token)}`,
          },
        ],
      })
      await checkAndBillPayerOverageThreshold(billingAttribution.billingEntity)
    } catch (err) {
      logger.warn('Failed to record voice input usage, continuing:', err)
    }

    return NextResponse.json({ token: data.token })
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to generate speech token')
    logger.error('Speech token error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
})
