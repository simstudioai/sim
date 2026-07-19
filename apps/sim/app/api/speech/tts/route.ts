import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SpeechTTSAPI')

export const dynamic = 'force-dynamic'

/** Default ElevenLabs voice (Rachel) — natural, conversational. */
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'
/** Low-latency streaming model used for conversational read-back. */
const DEFAULT_MODEL_ID = 'eleven_flash_v2_5'
const MAX_TTS_TEXT_LENGTH = 5000
const MAX_TTS_BODY_BYTES = 32 * 1024

const TTS_RATE_LIMIT = {
  maxTokens: 120,
  refillRate: 6,
  refillIntervalMs: 10 * 1000,
} as const

const rateLimiter = new RateLimiter()

/**
 * Session-authed streaming text-to-speech for in-app surfaces (e.g. Quick Ask
 * voice mode). Mirrors the deployed-chat TTS proxy but gates on the app
 * session instead of a chat-auth cookie. Streams ElevenLabs MP3 straight
 * through so playback can start before the whole clip is generated.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const raw = await request.text()
    if (raw.length > MAX_TTS_BODY_BYTES) {
      return NextResponse.json({ error: 'Request too large' }, { status: 413 })
    }
    let parsed: { text?: unknown; voiceId?: unknown; modelId?: unknown }
    try {
      parsed = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }
    if (text.length > MAX_TTS_TEXT_LENGTH) {
      return NextResponse.json({ error: 'text is too long' }, { status: 400 })
    }

    const voiceId =
      typeof parsed.voiceId === 'string' && parsed.voiceId ? parsed.voiceId : DEFAULT_VOICE_ID
    const modelId =
      typeof parsed.modelId === 'string' && parsed.modelId ? parsed.modelId : DEFAULT_MODEL_ID

    const voiceIdValidation = validateAlphanumericId(voiceId, 'voiceId', 255)
    if (!voiceIdValidation.isValid) {
      return NextResponse.json({ error: voiceIdValidation.error }, { status: 400 })
    }

    if (isBillingEnabled) {
      const rateCheck = await rateLimiter.checkRateLimitDirect(
        `tts:user:${session.user.id}`,
        TTS_RATE_LIMIT
      )
      if (!rateCheck.allowed) {
        return NextResponse.json(
          { error: 'Voice output rate limit exceeded. Please try again shortly.' },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil((rateCheck.retryAfterMs ?? 10000) / 1000)),
            },
          }
        )
      }
    }

    const apiKey = env.ELEVENLABS_API_KEY
    if (!apiKey?.trim()) {
      return NextResponse.json({ error: 'Text-to-speech is not configured' }, { status: 503 })
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
          // Native ElevenLabs speed-up (no pitch artifact). ~1.15x reads
          // noticeably snappier while staying natural (valid range 0.7–1.2).
          speed: 1.15,
        },
        apply_text_normalization: 'auto',
      }),
    })

    if (!response.ok || !response.body) {
      const message = await response.text().catch(() => '')
      logger.error('ElevenLabs TTS request failed', { status: response.status, message })
      return NextResponse.json(
        { error: `Text-to-speech failed (${response.status})` },
        { status: 502 }
      )
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    logger.error('Speech TTS error', error)
    return NextResponse.json({ error: 'Failed to generate speech' }, { status: 500 })
  }
})
