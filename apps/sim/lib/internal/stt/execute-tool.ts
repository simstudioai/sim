import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { executeSttOperation } from '@/lib/internal/stt/operations'
import { sttOperationInputSchema } from '@/lib/internal/stt/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const logger = createLogger('SttToolExecution')

const STT_TOOL_IDS = new Set([
  'stt_assemblyai',
  'stt_assemblyai_v2',
  'stt_deepgram',
  'stt_deepgram_v2',
  'stt_elevenlabs',
  'stt_elevenlabs_v2',
  'stt_gemini',
  'stt_gemini_v2',
  'stt_whisper',
  'stt_whisper_v2',
])

export const executeSttTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!STT_TOOL_IDS.has(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported STT tool: ${request.toolId}` },
      { status: 500 }
    )
  }

  const userId = request.context.userId
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  const parsed = sttOperationInputSchema.safeParse(request.input)
  if (!parsed.success) {
    logger.warn(`[${request.requestId}] Invalid STT request`, { issues: parsed.error.issues })
    return Response.json(
      { error: 'Invalid request data', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    return await executeSttOperation(parsed.data, {
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
      userId,
    })
  } catch (error) {
    request.signal?.throwIfAborted()
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('STT operation dispatch failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ error: message }, { status: 500 })
  }
}
