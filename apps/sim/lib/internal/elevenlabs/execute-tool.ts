import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { ElevenLabsOperationError } from '@/lib/internal/elevenlabs/errors'
import {
  type ElevenLabsOperationContext,
  executeElevenLabsAudioIsolation,
  executeElevenLabsSoundEffects,
  executeElevenLabsSpeechToSpeech,
} from '@/lib/internal/elevenlabs/operations'
import {
  elevenLabsAudioIsolationInputSchema,
  elevenLabsSoundEffectsInputSchema,
  elevenLabsSpeechToSpeechInputSchema,
} from '@/lib/internal/elevenlabs/schema'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const logger = createLogger('ElevenLabsToolExecution')

async function executeOperation<Input>(
  schema: z.ZodType<Input>,
  request: InternalToolOperationCall,
  execute: (input: Input, context: ElevenLabsOperationContext) => Promise<unknown>
): Promise<Response> {
  request.signal?.throwIfAborted()
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
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { error: getValidationErrorMessage(parsed.error, 'Missing required parameters') },
      { status: 400 }
    )
  }
  const userId = request.context.userId
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const result = await execute(parsed.data, {
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
      userId,
      workspaceId: request.context.workspaceId,
      workflowId: request.context.workflowId,
      executionId: request.context.executionId,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof ElevenLabsOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('ElevenLabs operation failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json(
      { error: `Internal Server Error: ${message}` },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
}

export const executeElevenLabsTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  switch (request.toolId) {
    case 'elevenlabs_sound_effects':
      return executeOperation(
        elevenLabsSoundEffectsInputSchema,
        request,
        executeElevenLabsSoundEffects
      )
    case 'elevenlabs_speech_to_speech':
      return executeOperation(
        elevenLabsSpeechToSpeechInputSchema,
        request,
        executeElevenLabsSpeechToSpeech
      )
    case 'elevenlabs_audio_isolation':
      return executeOperation(
        elevenLabsAudioIsolationInputSchema,
        request,
        executeElevenLabsAudioIsolation
      )
    default:
      return Response.json(
        { error: `Unsupported ElevenLabs tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
