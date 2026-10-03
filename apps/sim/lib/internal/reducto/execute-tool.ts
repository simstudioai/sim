import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { ReductoOperationError } from '@/lib/internal/reducto/errors'
import { reductoParseInputSchema } from '@/lib/internal/reducto/input'
import { executeReductoParse } from '@/lib/internal/reducto/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const logger = createLogger('ReductoToolExecution')

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

export const executeReductoTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!['reducto_parser', 'reducto_parser_v2'].includes(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported Reducto tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  let serialized: string
  try {
    serialized = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serialized, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        success: false,
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }
  const parsed = reductoParseInputSchema.safeParse(request.input)
  if (!parsed.success) return validationResponse(parsed.error)

  try {
    const result = await executeReductoParse(parsed.data, {
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
      userId: request.context.userId,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof ReductoOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    const message = getErrorMessage(error, 'Internal server error')
    logger.error('Reducto operation failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
