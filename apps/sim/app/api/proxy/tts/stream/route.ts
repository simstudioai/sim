import type { NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('ProxyTTSStreamAPI')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text, voiceId, modelId = 'eleven_turbo_v2_5' } = body

    if (!text || !voiceId) {
      return new Response('Missing required parameters', { status: 400 })
    }

    // Use server-side API key instead of client-provided key
    const apiKey = env.ELEVENLABS_API_KEY
    if (!apiKey) {
      logger.error('ELEVENLABS_API_KEY not configured on server')
      logger.error(
        'Available env vars:',
        Object.keys(process.env).filter((key) => key.includes('ELEVEN'))
      )
      logger.error('env.ELEVENLABS_API_KEY:', env.ELEVENLABS_API_KEY)
      return new Response(
        'ElevenLabs service not configured. Please ensure ELEVENLABS_API_KEY is set in your environment.',
        { status: 503 }
      )
    }

    logger.info('Starting streaming TTS request for voice:', voiceId)

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
        // Aggressive latency optimizations
        optimize_streaming_latency: 4, // Maximum latency optimization (turns off text normalizer)
        output_format: 'mp3_22050_32', // Lower sample rate for faster streaming
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.0, // Disable style for faster processing
          use_speaker_boost: false, // Disable for speed
        },
        // Experimental: use auto mode for even lower latency
        // Note: This might not be available in all API versions
        enable_ssml_parsing: false, // Disable SSML for speed
        apply_text_normalization: 'off', // Turn off text normalization for max speed
      }),
    })

    if (!response.ok) {
      logger.error(`Failed to generate streaming TTS: ${response.status} ${response.statusText}`)
      return new Response(`Failed to generate TTS: ${response.status} ${response.statusText}`, {
        status: response.status,
      })
    }

    // Check if we got a streaming response
    if (!response.body) {
      logger.error('No response body received from ElevenLabs')
      return new Response('No audio stream received', { status: 422 })
    }

    logger.info('Streaming audio from ElevenLabs...')

    // Create a TransformStream to pass through the audio chunks
    const { readable, writable } = new TransformStream()

    // Pipe the response body to our transform stream
    const writer = writable.getWriter()
    const reader = response.body.getReader()

    // Start streaming in the background

    ;(async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            await writer.close()
            break
          }
          await writer.write(value)
        }
        logger.info('Finished streaming audio')
      } catch (error) {
        logger.error('Error during streaming:', error)
        await writer.abort(error)
      }
    })()

    // Return the readable stream with appropriate headers
    return new Response(readable, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        // Add connection keep-alive for better streaming performance
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    logger.error('Error in streaming TTS:', error)

    return new Response(
      `Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    )
  }
}
