import type { NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ProxyTTSStreamAPI')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text, voiceId, modelId = 'eleven_turbo_v2_5' } = body

    if (!text || !voiceId) {
      return new Response('Missing required parameters', { status: 400 })
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
        // Maximum performance settings
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
        // Use auto mode for fastest possible streaming
        // Note: This may sacrifice some quality for speed
        use_pvc_as_ivc: false, // Use fastest voice processing
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

    // Create optimized streaming response
    const { readable, writable } = new TransformStream({
      transform(chunk, controller) {
        // Pass through chunks immediately without buffering
        controller.enqueue(chunk)
      },
      flush(controller) {
        // Ensure all data is flushed immediately
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
          // Write immediately without waiting
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
        // Stream headers for better streaming
        'X-Accel-Buffering': 'no', // Disable nginx buffering
        'X-Stream-Type': 'real-time',
      },
    })
  } catch (error) {
    logger.error('Error in Stream TTS:', error)

    return new Response(
      `Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    )
  }
}
