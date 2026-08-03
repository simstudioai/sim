import { randomUUID } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { ttsStreamContract } from '@/lib/api/contracts/media/tts-stream'
import { parseRequest } from '@/lib/api/server'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import {
  checkAttributedUsageLimits,
  resolveSystemBillingAttribution,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage } from '@/lib/billing/core/usage-log'
import { resolveDeployedChatCaller } from '@/lib/chat/deployed-chat-caller'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier } from '@/lib/core/config/env-flags'
import { enforceChatRateLimit, enforceIpRateLimit } from '@/lib/core/rate-limiter/route-helpers'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ProxyTTSStreamAPI')

/**
 * Filters naive floods only: `getClientIp` trusts the leftmost
 * `X-Forwarded-For` value, which the caller controls, so a deliberate attacker
 * rotates past this bucket. See {@link TTS_CHAT_RATE_LIMIT}.
 *
 * Deployed chat synthesizes sentence by sentence, so a real conversation issues
 * several requests per answer — hence the generous burst.
 */
const TTS_IP_RATE_LIMIT = {
  maxTokens: 60,
  refillRate: 30,
  refillIntervalMs: 60 * 1000,
} as const

/**
 * The load-bearing spend control. Public chats hand their id to every visitor,
 * so the id alone cannot gate use of the platform ElevenLabs key. This bucket
 * is keyed on server-held state, bounding total spend per chat regardless of
 * how many source addresses the traffic claims to come from.
 */
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

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    // Throttle per IP before any database work so a flood cannot be amplified into chat lookups.
    const ipLimited = await enforceIpRateLimit('tts-stream', request, TTS_IP_RATE_LIMIT)
    if (ipLimited) return ipLimited

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

    const caller = await resolveDeployedChatCaller(request, chatId)
    if (!caller.authorized) {
      logger.warn('Chat authentication failed for TTS, chatId:', chatId)
      return new Response('Unauthorized', { status: 401 })
    }

    const chatLimited = await enforceChatRateLimit('tts-stream', chatId, TTS_CHAT_RATE_LIMIT)
    if (chatLimited) return chatLimited

    // Anonymous deployed chats have no human request actor, so the workspace payer is charged.
    const workspaceId = caller.workspaceId ?? undefined
    const billingAttribution = workspaceId
      ? await resolveSystemBillingAttribution(workspaceId)
      : undefined
    const actorUserId = billingAttribution?.actorUserId ?? caller.ownerId

    const usageCheck = billingAttribution
      ? await checkAttributedUsageLimits(billingAttribution)
      : await checkActorUsageLimits(actorUserId)
    if (usageCheck.isExceeded) {
      return new Response(usageCheck.message || 'Usage limit exceeded.', { status: 402 })
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
     * its own row rather than being deduplicated. `randomUUID` rather than
     * `generateRequestId`, whose fallback truncates to 8 characters.
     *
     * No threshold settlement here: it runs per metered event elsewhere and is
     * far too heavy for a per-sentence realtime path. The workflow execution
     * that produced this text already settles the payer.
     */
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
