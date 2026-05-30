import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ttsToolContract } from '@/lib/api/contracts/tools/media/tts'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import {
  isPayloadSizeLimitError,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { StorageService } from '@/lib/uploads'

const logger = createLogger('ProxyTTSAPI')
const MAX_TTS_AUDIO_BYTES = 25 * 1024 * 1024

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.error('Authentication failed for TTS proxy:', authResult.error)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(
      ttsToolContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { error: getValidationErrorMessage(error, 'Missing required parameters') },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const {
      text,
      voiceId,
      apiKey,
      modelId,
      stability,
      similarityBoost,
      workspaceId,
      workflowId,
      executionId,
    } = parsed.data.body

    const voiceIdValidation = validateAlphanumericId(voiceId, 'voiceId', 255)
    if (!voiceIdValidation.isValid) {
      logger.error(`Invalid voice ID: ${voiceIdValidation.error}`)
      return NextResponse.json({ error: voiceIdValidation.error }, { status: 400 })
    }

    // Check if this is an execution context (from workflow tool execution)
    const executionContext =
      workspaceId && workflowId && executionId ? { workspaceId, workflowId, executionId } : null
    logger.info('Proxying TTS request for voice:', {
      voiceId,
      hasExecutionContext: Boolean(executionContext),
      workspaceId,
      workflowId,
      executionId,
    })

    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`

    const hasVoiceSetting = stability !== undefined || similarityBoost !== undefined
    const voiceSettings = hasVoiceSetting
      ? {
          stability: stability ?? 0.5,
          similarity_boost: similarityBoost ?? 0.75,
        }
      : undefined

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
        ...(voiceSettings ? { voice_settings: voiceSettings } : {}),
      }),
      signal: AbortSignal.timeout(DEFAULT_EXECUTION_TIMEOUT_MS),
    })

    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      logger.error(`Failed to generate TTS: ${response.status} ${response.statusText}`)
      return NextResponse.json(
        { error: `Failed to generate TTS: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    const audioBuffer = await readResponseToBufferWithLimit(response, {
      maxBytes: MAX_TTS_AUDIO_BYTES,
      label: 'TTS audio response',
      signal: request.signal,
    })

    if (audioBuffer.length === 0) {
      logger.error('Empty audio received from ElevenLabs')
      return NextResponse.json({ error: 'Empty audio received' }, { status: 422 })
    }

    const timestamp = Date.now()

    // Use execution storage for workflow tool calls, copilot for chat UI
    if (executionContext) {
      const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
      const fileName = `tts-${timestamp}.mp3`

      const userFile = await uploadExecutionFile(
        executionContext,
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
        error: `Internal Server Error: ${getErrorMessage(error, 'Unknown error')}`,
      },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})
