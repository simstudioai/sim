import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { uploadFile } from '@/lib/uploads/storage-client'
import { getBaseUrl } from '@/lib/urls/utils'

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
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!response.ok) {
      logger.error(`Failed to generate TTS: ${response.status} ${response.statusText}`)
      return new NextResponse(`Failed to generate TTS: ${response.status} ${response.statusText}`, {
        status: response.status,
      })
    }

    const audioBlob = await response.blob()

    if (audioBlob.size === 0) {
      logger.error('Empty audio received from ElevenLabs')
      return new NextResponse('Empty audio received', { status: 422 })
    }

    // Upload the audio file to storage and return multiple URL options
    const audioBuffer = Buffer.from(await audioBlob.arrayBuffer())
    const timestamp = Date.now()
    const fileName = `elevenlabs-tts-${timestamp}.mp3`
    const fileInfo = await uploadFile(audioBuffer, fileName, 'audio/mpeg')

    // Generate the full URL for external use using the configured base URL
    const audioUrl = `${getBaseUrl()}${fileInfo.path}`

    return NextResponse.json({
      audioUrl,
      size: fileInfo.size,
    })
  } catch (error) {
    logger.error('Error proxying TTS:', error)

    return new NextResponse(
      `Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    )
  }
}
