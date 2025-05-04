import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('ProxyTTSAPI')

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { text, voiceId, apiKey, modelId = 'eleven_monolingual_v1' } = body
    
    if (!text || !voiceId || !apiKey) {
      return new NextResponse('Missing required parameters', { status: 400 })
    }
    
    logger.info('Proxying TTS request for voice:', voiceId)
    
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
      }),
      // Set a reasonable timeout
      signal: AbortSignal.timeout(20000),
    })
    
    if (!response.ok) {
      logger.error(`Failed to generate TTS: ${response.status} ${response.statusText}`)
      return new NextResponse(`Failed to generate TTS: ${response.status} ${response.statusText}`, {
        status: response.status
      })
    }
    
    const audioBlob = await response.blob()
    
    if (audioBlob.size === 0) {
      logger.error('Empty audio received from ElevenLabs')
      return new NextResponse('Empty audio received', { status: 422 })
    }
    
    return new NextResponse(audioBlob, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400', // Cache for a day
        'Access-Control-Allow-Origin': '*', // CORS support
      },
    })
  } catch (error) {
    logger.error('Error proxying TTS:', error)
    
    return new NextResponse(
      `Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    )
  }
}
