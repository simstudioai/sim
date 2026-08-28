import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { VisionOperationError } from '@/lib/internal/vision/errors'
import { executeVisionOperation } from '@/lib/internal/vision/operations'
import { visionOperationInputSchema } from '@/lib/internal/vision/schema'

const logger = createLogger('VisionToolExecution')
const VISION_TOOL_IDS = new Set(['vision_tool', 'vision_tool_v2'])

export const executeVisionTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!VISION_TOOL_IDS.has(request.toolId)) {
    return Response.json(
      { success: false, error: `Unsupported Vision tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  const parsed = visionOperationInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation error', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const output = await executeVisionOperation(parsed.data, {
      headers: request.headers,
      requestId: request.requestId,
      signal: request.signal,
      userId,
    })
    request.signal?.throwIfAborted()
    return Response.json({ success: true, output })
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof VisionOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    const message = getErrorMessage(error, 'Unknown error occurred')
    logger.error('Vision operation failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
