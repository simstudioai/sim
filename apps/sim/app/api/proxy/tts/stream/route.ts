import { randomUUID } from 'node:crypto'
import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { ttsStreamContract } from '@/lib/api/contracts/media/tts-stream'
import { parseRequest } from '@/lib/api/server'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import {
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  resolveSystemBillingAttribution,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier } from '@/lib/core/config/env-flags'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { validateAuthToken } from '@/lib/core/security/deployment'
import { getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ProxyTTSStreamAPI')

const rateLimiter = new RateLimiter()

/**
 * Public chats hand their id to every visitor, so the id alone cannot gate
 * spend on the platform ElevenLabs key.
 *
 * The per-IP bucket only filters naive floods: `getClientIp` trusts the
 * leftmost `X-Forwarded-For` value, which the caller controls, so a deliberate
 * attacker rotates past it. The per-chat bucket is the load-bearing control —
 * it is keyed on server-held state and bounds total spend per chat regardless
 * of how many source addresses the traffic claims to come from.
 *
 * Deployed chat synthesizes sentence by sentence, so a real conversation issues
 * several requests per answer — hence the generous burst.
 */
const TTS_IP_RATE_LIMIT = {
  maxTokens: 60,
  refillRate: 30,
  refillIntervalMs: 60 * 1000,
} as const

const TTS_CHAT_RATE_LIMIT = {
  maxTokens: 120,
  refillRate: 60,
  refillIntervalMs: 60 * 1000,
} as const

/**
 * Published ElevenLabs API rate for Flash/Turbo text-to-speech, in USD per
 * 1,000 characters. This is the vendor cost; `getCostMultiplier()` applies the
 * platform markup, matching how other metered sources are priced.
 */
const TTS_COST_PER_1K_CHARS = 0.05

/**
 * The body carries at most `MAX_TTS_TEXT_LENGTH` characters of text plus two
 * short ids, so a tight cap keeps an anonymous caller from making the route
 * buffer a large payload before validation runs. Without it the shared default
 * is 50 MB.
 */
const MAX_TTS_BODY_BYTES = 16 * 1024

interface ChatAuthResult {
  valid: boolean
  ownerId?: string
  workspaceId?: string | null
}

/**
 * Validates chat-based authentication for deployed chat voice mode, resolving
 * the owning workspace so the synthesis can be attributed to a payer.
 */
async function validateChatAuth(request: NextRequest, chatId: string): Promise<ChatAuthResult> {
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
      logger.warn('Chat not found or inactive for TTS auth:', chatId)
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
    logger.error('Error validating chat auth for TTS:', error)
    return { valid: false }
  }
}

function rateLimitResponse(retryAfterMs: number | undefined): Response {
  return new NextResponse('Rate limit exceeded', {
    status: 429,
    headers: { 'Retry-After': String(Math.ceil((retryAfterMs ?? 60_000) / 1000)) },
  })
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    /**
     * Throttle per IP before any database work so an anonymous flood cannot be
     * amplified into chat lookups.
     */
    const clientIp = getClientIp(request)
    const ipRateCheck = await rateLimiter.checkRateLimitDirect(
      `tts-stream:ip:${clientIp}`,
      TTS_IP_RATE_LIMIT
    )
    if (!ipRateCheck.allowed) {
      return rateLimitResponse(ipRateCheck.retryAfterMs)
    }

    const parsed = await parseRequest(
      ttsStreamContract,
      request,
      {},
      {
        maxBodyBytes: MAX_TTS_BODY_BYTES,
        invalidJsonResponse: () => new NextResponse('Invalid request body', { status: 400 }),
        validationErrorResponse: (error) => {
          if (error.issues.some((issue) => issue.path[0] === 'chatId')) {
            return new NextResponse('chatId is required', { status: 400 })
          }
          return new NextResponse('Missing required parameters', { status: 400 })
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { text, voiceId, modelId, chatId } = parsed.data.body

    const chatAuth = await validateChatAuth(request, chatId)
    if (!chatAuth.valid) {
      logger.warn('Chat authentication failed for TTS, chatId:', chatId)
      return new Response('Unauthorized', { status: 401 })
    }

    const chatRateCheck = await rateLimiter.checkRateLimitDirect(
      `tts-stream:chat:${chatId}`,
      TTS_CHAT_RATE_LIMIT
    )
    if (!chatRateCheck.allowed) {
      return rateLimitResponse(chatRateCheck.retryAfterMs)
    }

    /**
     * Anonymous deployed chats have no human request actor, so resolve the
     * system actor and immutable workspace payer together.
     */
    const workspaceId = chatAuth.workspaceId ?? undefined
    let billingAttribution: BillingAttributionSnapshot | undefined
    let actorUserId = chatAuth.ownerId
    if (workspaceId) {
      billingAttribution = await resolveSystemBillingAttribution(workspaceId)
      actorUserId = billingAttribution.actorUserId
    }

    if (actorUserId) {
      const usageCheck = billingAttribution
        ? await checkAttributedUsageLimits(billingAttribution)
        : await checkActorUsageLimits(actorUserId)
      if (usageCheck.isExceeded) {
        return new Response(usageCheck.message || 'Usage limit exceeded.', { status: 402 })
      }
    }

    const apiKey = env.ELEVENLABS_API_KEY
    if (!apiKey) {
      logger.error('ELEVENLABS_API_KEY not configured on server')
      return new Response('ElevenLabs service not configured', { status: 503 })
    }

    const query = new URLSearchParams({ output_format: 'mp3_44100_128' })
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?${query.toString()}`

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.0,
          use_speaker_boost: false,
        },
        apply_text_normalization: 'auto',
      }),
    })

    if (!response.ok) {
      logger.error(`Failed to generate Stream TTS: ${response.status} ${response.statusText}`)
      return new Response(`Failed to generate TTS: ${response.status} ${response.statusText}`, {
        status: response.status,
      })
    }

    if (!response.body) {
      logger.error('No response body received from ElevenLabs')
      return new Response('No audio stream received', { status: 422 })
    }

    /**
     * Meter once ElevenLabs has accepted the request — the characters are billed
     * to us at that point regardless of whether the client drains the stream.
     *
     * `sourceReference` must be unique per call. `usage_log.event_key` is
     * unique and inserts conflict-do-nothing, and the key is derived from the
     * entry's stable fields — without this, two synthesis calls of equal length
     * in the same workspace would collide and the second would silently go
     * unbilled. Each call is a separate charge from ElevenLabs, so each needs
     * its own row rather than being deduplicated.
     *
     * No threshold settlement here: it runs per metered event elsewhere and is
     * far too heavy for a per-sentence realtime path. The workflow execution
     * that produced this text already settles the payer.
     */
    if (actorUserId) {
      try {
        await recordUsage({
          userId: actorUserId,
          workspaceId,
          ...(billingAttribution ? toBillingContext(billingAttribution) : {}),
          entries: [
            {
              category: 'fixed',
              source: 'voice-output',
              description: `Voice output (${text.length} characters)`,
              cost: (text.length / 1000) * TTS_COST_PER_1K_CHARS * getCostMultiplier(),
              sourceReference: `voice-output:${chatId}:${randomUUID()}`,
            },
          ],
        })
      } catch (err) {
        logger.warn('Failed to record voice output usage, continuing:', err)
      }
    }

    const { readable, writable } = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk)
      },
      flush(controller) {
        controller.terminate()
      },
    })

    const writer = writable.getWriter()
    const reader = response.body.getReader()

    ;(async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            await writer.close()
            break
          }
          writer.write(value).catch(logger.error)
        }
      } catch (error) {
        logger.error('Error during Stream streaming:', error)
        await writer.abort(error)
      }
    })()

    return new Response(readable, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'X-Content-Type-Options': 'nosniff',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Stream-Type': 'real-time',
      },
    })
  } catch (error) {
    logger.error('Error in Stream TTS:', error)

    return new Response('Internal Server Error', {
      status: 500,
    })
  }
})
