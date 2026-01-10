import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/core/config/env'
import { validateAuthToken } from '@/lib/core/security/deployment'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'

const logger = createLogger('ProxyTTSStreamAPI')

/**
 * Validates chat-based authentication for deployed chat voice mode
 * Checks if the user has a valid chat auth cookie for the given chatId
 */
async function validateChatAuth(request: NextRequest, chatId: string): Promise<boolean> {
  try {
    const chatResult = await db
      .select({
        id: chat.id,
        isActive: chat.isActive,
        authType: chat.authType,
        password: chat.password,
      })
      .from(chat)
      .where(eq(chat.id, chatId))
      .limit(1)

    if (chatResult.length === 0 || !chatResult[0].isActive) {
      logger.warn('Chat not found or inactive for TTS auth:', chatId)
      return false
    }

    const chatData = chatResult[0]

    if (chatData.authType === 'public') {
      return true
    }

    const cookieName = `chat_auth_${chatId}`
    const authCookie = request.cookies.get(cookieName)

    if (authCookie && validateAuthToken(authCookie.value, chatId, chatData.password)) {
      return true
    }

    return false
  } catch (error) {
    logger.error('Error validating chat auth for TTS:', error)
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: any
    try {
      body = await request.json()
    } catch {
      return new Response('Invalid request body', { status: 400 })
    }

    const { text, voiceId, modelId = 'eleven_turbo_v2_5', chatId } = body

    if (!chatId) {
      return new Response('chatId is required', { status: 400 })
    }

    if (!text || !voiceId) {
      return new Response('Missing required parameters', { status: 400 })
    }

    const isChatAuthed = await validateChatAuth(request, chatId)
    if (!isChatAuthed) {
      logger.warn('Chat authentication failed for TTS, chatId:', chatId)
      return new Response('Unauthorized', { status: 401 })
    }

    const voiceIdValidation = validateAlphanumericId(voiceId, 'voiceId', 255)
    if (!voiceIdValidation.isValid) {
      logger.error(`Invalid voice ID: ${voiceIdValidation.error}`)
      return new Response(voiceIdValidation.error, { status: 400 })
    }

    const apiKey = env.ELEVENLABS_API_KEY
    if (!apiKey) {
      logger.error('ELEVENLABS_API_KEY not configured on server')
      return new Response('ElevenLabs service not configured', { status: 503 })
    }

    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`

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
        optimize_streaming_latency: 4,
        output_format: 'mp3_22050_32', // Fastest format
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.0,
          use_speaker_boost: false,
        },
        enable_ssml_parsing: false,
        apply_text_normalization: 'off',
        use_pvc_as_ivc: false,
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
        'Access-Control-Allow-Origin': '*',
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
}
