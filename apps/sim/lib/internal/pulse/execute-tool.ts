import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { PulseOperationError } from '@/lib/internal/pulse/errors'
import { pulseParseInputSchema } from '@/lib/internal/pulse/input'
import { executePulseParse } from '@/lib/internal/pulse/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const logger = createLogger('PulseToolExecution')

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

export const executePulseTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!['pulse_parser', 'pulse_parser_v2'].includes(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported Pulse tool: ${request.toolId}` },
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
  const parsed = pulseParseInputSchema.safeParse(request.input)
  if (!parsed.success) return validationResponse(parsed.error)

  try {
    const result = await executePulseParse(parsed.data, {
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
      userId: request.context.userId,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof PulseOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    const message = getErrorMessage(error, 'Internal server error')
    logger.error('Pulse operation failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
