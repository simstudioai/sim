import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { elevenLabsAudioToolContract } from '@/lib/api/contracts/tools/media/elevenlabs'
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
import { getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('ElevenLabsAudioAPI')
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const BASE_URL = 'https://api.elevenlabs.io/v1'

type AudioOperation = 'sound_effects' | 'speech_to_speech' | 'audio_isolation'

interface SourceAudio {
  buffer: Buffer
  fileName: string
  mimeType: string
}

/** Builds the upstream ElevenLabs request for an audio-producing operation. */
function buildElevenLabsRequest(
  operation: AudioOperation,
  body: {
    apiKey: string
    voiceId?: string
    text?: string
    modelId?: string
    durationSeconds?: number
    promptInfluence?: number
    loop?: boolean
    removeBackgroundNoise?: boolean
  },
  source: SourceAudio | null
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = { 'xi-api-key': body.apiKey, Accept: 'audio/mpeg' }
  const signal = AbortSignal.timeout(DEFAULT_EXECUTION_TIMEOUT_MS)

  if (operation === 'sound_effects') {
    const payload: Record<string, unknown> = { text: body.text }
    if (body.modelId) payload.model_id = body.modelId
    if (body.durationSeconds !== undefined) payload.duration_seconds = body.durationSeconds
    if (body.promptInfluence !== undefined) payload.prompt_influence = body.promptInfluence
    if (body.loop !== undefined) payload.loop = body.loop
    return {
      url: `${BASE_URL}/sound-generation`,
      init: {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      },
    }
  }

  const formData = new FormData()
  const file = source as SourceAudio
  formData.append(
    'audio',
    new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
    file.fileName
  )

  if (operation === 'speech_to_speech') {
    if (body.modelId) formData.append('model_id', body.modelId)
    if (body.removeBackgroundNoise !== undefined) {
      formData.append('remove_background_noise', String(body.removeBackgroundNoise))
    }
    return {
      url: `${BASE_URL}/speech-to-speech/${body.voiceId}`,
      init: { method: 'POST', headers, body: formData, signal },
    }
  }

  return {
    url: `${BASE_URL}/audio-isolation`,
    init: { method: 'POST', headers, body: formData, signal },
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId()
  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = authResult.userId

    const parsed = await parseRequest(
      elevenLabsAudioToolContract,
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

    const body = parsed.data.body
    const operation = body.operation as AudioOperation

    if (operation === 'sound_effects' && !body.text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }

    let source: SourceAudio | null = null
    if (operation === 'speech_to_speech' || operation === 'audio_isolation') {
      if (!body.audioFile) {
        return NextResponse.json({ error: 'audioFile is required' }, { status: 400 })
      }
      const file = body.audioFile
      const denied = await assertToolFileAccess(file.key, userId, requestId, logger)
      if (denied) return denied
      const buffer = await downloadFileFromStorage(file, requestId, logger)
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      source = {
        buffer,
        fileName: file.name,
        mimeType: file.type || getMimeTypeFromExtension(ext),
      }
    }

    if (operation === 'speech_to_speech') {
      if (!body.voiceId) {
        return NextResponse.json({ error: 'voiceId is required' }, { status: 400 })
      }
      const voiceIdValidation = validateAlphanumericId(body.voiceId, 'voiceId', 255)
      if (!voiceIdValidation.isValid) {
        return NextResponse.json({ error: voiceIdValidation.error }, { status: 400 })
      }
    }

    const { url, init } = buildElevenLabsRequest(operation, body, source)
    const response = await fetch(url, init)

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      logger.error(`[${requestId}] ElevenLabs ${operation} failed: ${response.status}`, errorBody)
      return NextResponse.json(
        { error: `ElevenLabs request failed: ${response.status} ${response.statusText}` },
        { status: response.status }
      )
    }

    const outputBuffer = await readResponseToBufferWithLimit(response, {
      maxBytes: MAX_AUDIO_BYTES,
      label: `ElevenLabs ${operation} response`,
      signal: request.signal,
    })

    if (outputBuffer.length === 0) {
      return NextResponse.json({ error: 'Empty audio received' }, { status: 422 })
    }

    const fileName = `elevenlabs-${operation}-${Date.now()}.mp3`
    const executionContext =
      body.workspaceId && body.workflowId && body.executionId
        ? {
            workspaceId: body.workspaceId,
            workflowId: body.workflowId,
            executionId: body.executionId,
          }
        : null

    if (executionContext) {
      const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
      const userFile = await uploadExecutionFile(
        executionContext,
        outputBuffer,
        fileName,
        'audio/mpeg',
        userId
      )
      return NextResponse.json({ audioFile: userFile, audioUrl: userFile.url })
    }

    const fileInfo = await StorageService.uploadFile({
      file: outputBuffer,
      fileName,
      contentType: 'audio/mpeg',
      context: 'copilot',
    })
    return NextResponse.json({ audioUrl: `${getBaseUrl()}${fileInfo.path}`, size: fileInfo.size })
  } catch (error) {
    logger.error(`[${requestId}] ElevenLabs audio proxy error:`, error)
    return NextResponse.json(
      { error: `Internal Server Error: ${getErrorMessage(error, 'Unknown error')}` },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})
