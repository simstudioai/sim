import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { validateAlphanumericId } from '@/lib/security/input-validation'
import { uploadFile } from '@/lib/uploads/storage-client'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('ProxyTTSAPI')

export async function POST(request: NextRequest) {
  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.error('Authentication failed for TTS proxy:', authResult.error)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { text, voiceId, apiKey, modelId = 'eleven_monolingual_v1' } = body

    if (!text || !voiceId || !apiKey) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    const voiceIdValidation = validateAlphanumericId(voiceId, 'voiceId', 255)
    if (!voiceIdValidation.isValid) {
      logger.error(`Invalid voice ID: ${voiceIdValidation.error}`)
      return NextResponse.json({ error: voiceIdValidation.error }, { status: 400 })
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
      return NextResponse.json(
        { error: `Failed to generate TTS: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    const audioBlob = await response.blob()

    if (audioBlob.size === 0) {
      logger.error('Empty audio received from ElevenLabs')
      return NextResponse.json({ error: 'Empty audio received' }, { status: 422 })
    }

    const audioBuffer = Buffer.from(await audioBlob.arrayBuffer())
    const timestamp = Date.now()
    const fileName = `elevenlabs-tts-${timestamp}.mp3`
    const fileInfo = await uploadFile(audioBuffer, fileName, 'audio/mpeg')

    const audioUrl = `${getBaseUrl()}${fileInfo.path}`

    return NextResponse.json({
      audioUrl,
      size: fileInfo.size,
    })
  } catch (error) {
    logger.error('Error proxying TTS:', error)

    return NextResponse.json(
      {
        error: `Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
