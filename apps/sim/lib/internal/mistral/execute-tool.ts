import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { MistralOperationError } from '@/lib/internal/mistral/errors'
import {
  MISTRAL_MAX_OPERATION_INPUT_BYTES,
  mistralParseInputSchema,
} from '@/lib/internal/mistral/input'
import { isMistralInputWithinLimit } from '@/lib/internal/mistral/input-size'
import { executeMistralParse } from '@/lib/internal/mistral/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'

const logger = createLogger('MistralToolExecution')

function validationResponse(error: z.ZodError): Response {
  return Response.json(
    {
      success: false,
      error: error.issues[0]?.message || 'Invalid request data',
      details: error.issues,
    },
    { status: 400 }
  )
}

export const executeMistralTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!['mistral_parser', 'mistral_parser_v2', 'mistral_parser_v3'].includes(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported Mistral tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  try {
    if (!isMistralInputWithinLimit(request.input, MISTRAL_MAX_OPERATION_INPUT_BYTES)) {
      return Response.json(
        {
          success: false,
          error: `Request body exceeds the maximum allowed size of ${MISTRAL_MAX_OPERATION_INPUT_BYTES} bytes`,
        },
        { status: 413 }
      )
    }
  } catch {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  const parsed = mistralParseInputSchema.safeParse(request.input)
  if (!parsed.success) return validationResponse(parsed.error)

  try {
    const result = await executeMistralParse(parsed.data, {
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
      userId: request.context.userId,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof ProviderCapacityDeferredError) {
      return Response.json(
        { success: false, error: 'Mistral OCR is at capacity. Retry after the indicated delay.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((error.retryAfterMs ?? 60_000) / 1000)) },
        }
      )
    }
    if (error instanceof MistralOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    if (isDocNotReadyError(error)) {
      return Response.json({ success: false, error: docNotReadyMessage() }, { status: 409 })
    }
    if (isPayloadSizeLimitError(error)) {
      return Response.json(
        { success: false, error: 'Mistral API response exceeded the safe size limit' },
        { status: 502 }
      )
    }
    const message = getErrorMessage(error, 'Internal server error')
    logger.error('Mistral operation failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
