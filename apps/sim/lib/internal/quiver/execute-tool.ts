import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { QuiverOperationError } from '@/lib/internal/quiver/errors'
import {
  executeQuiverImageToSvg,
  executeQuiverTextToSvg,
  type QuiverOperationContext,
} from '@/lib/internal/quiver/operations'
import {
  quiverImageToSvgInputSchema,
  quiverTextToSvgInputSchema,
} from '@/lib/internal/quiver/schema'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const logger = createLogger('QuiverToolExecution')

function validateInputSize(input: unknown): Response | null {
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(input) ?? ''
  } catch {
    return Response.json(
      { success: false, error: 'Invalid request data', details: [] },
      { status: 400 }
    )
  }
  if (Buffer.byteLength(serializedInput, 'utf8') <= DEFAULT_MAX_JSON_BODY_BYTES) return null
  return Response.json(
    {
      error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
    },
    { status: 413 }
  )
}

async function executeOperation<Input>(
  request: InternalToolOperationCall,
  schema: z.ZodType<Input>,
  execute: (input: Input, context: QuiverOperationContext) => Promise<unknown>
): Promise<Response> {
  request.signal?.throwIfAborted()
  const sizeError = validateInputSize(request.input)
  if (sizeError) return sizeError
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
        details: parsed.error.issues,
      },
      { status: 400 }
    )
  }
  const userId = request.context.userId
  if (!userId) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const result = await execute(parsed.data, {
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
      userId,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof QuiverOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('Quiver operation failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json(
      { success: false, error: message },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
}

export const executeQuiverTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  switch (request.toolId) {
    case 'quiver_text_to_svg':
      return executeOperation(request, quiverTextToSvgInputSchema, executeQuiverTextToSvg)
    case 'quiver_image_to_svg':
      return executeOperation(request, quiverImageToSvgInputSchema, executeQuiverImageToSvg)
    default:
      return Response.json(
        { success: false, error: `Unsupported Quiver tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}
