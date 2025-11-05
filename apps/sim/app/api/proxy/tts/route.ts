import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { validateAlphanumericId } from '@/lib/security/input-validation'
import { StorageService } from '@/lib/uploads'
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
    const {
      text,
      voiceId,
      apiKey,
      modelId = 'eleven_monolingual_v1',
      workspaceId,
      workflowId,
      executionId,
    } = body

    if (!text || !voiceId || !apiKey) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    const voiceIdValidation = validateAlphanumericId(voiceId, 'voiceId', 255)
    if (!voiceIdValidation.isValid) {
      logger.error(`Invalid voice ID: ${voiceIdValidation.error}`)
      return NextResponse.json({ error: voiceIdValidation.error }, { status: 400 })
    }

    // Check if this is an execution context (from workflow tool execution)
    const hasExecutionContext = workspaceId && workflowId && executionId
    logger.info('Proxying TTS request for voice:', {
      voiceId,
      hasExecutionContext,
      workspaceId,
      workflowId,
      executionId,
    })

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

    // Use execution storage for workflow tool calls, copilot for chat UI
    if (hasExecutionContext) {
      const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
      const fileName = `tts-${timestamp}.mp3`

      const userFile = await uploadExecutionFile(
        {
          workspaceId,
          workflowId,
          executionId,
        },
        audioBuffer,
        fileName,
        'audio/mpeg',
        authResult.userId
      )

      logger.info('TTS audio stored in execution context:', {
        executionId,
        fileName,
        size: userFile.size,
      })

      return NextResponse.json({
        audioFile: userFile,
        audioUrl: userFile.url,
      })
    }

    // Chat UI usage - no execution context, use copilot context
    const fileName = `tts-${timestamp}.mp3`
    const fileInfo = await StorageService.uploadFile({
      file: audioBuffer,
      fileName,
      contentType: 'audio/mpeg',
      context: 'copilot',
    })

    const audioUrl = `${getBaseUrl()}${fileInfo.path}`

    logger.info('TTS audio stored in copilot context (chat UI):', {
      fileName,
      size: fileInfo.size,
    })

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
