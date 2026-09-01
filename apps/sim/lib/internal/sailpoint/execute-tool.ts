import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { executeSailPointOperation } from '@/lib/internal/sailpoint/operations'
import { parseSailPointInput } from '@/lib/internal/sailpoint/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeSailPointTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        success: false,
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  if (!isRecordLike(request.input) || request.input.operation !== request.toolId) {
    return Response.json(
      { success: false, error: 'SailPoint input operation must match the executing tool ID' },
      { status: 400 }
    )
  }

  const parsed = parseSailPointInput(request.toolId, request.input)
  if (!parsed) {
    return Response.json(
      { success: false, error: `Unsupported SailPoint tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: getValidationErrorMessage(parsed.error, 'Invalid SailPoint request'),
      },
      { status: 400 }
    )
  }

  try {
    const response = await executeSailPointOperation(parsed.data, {
      requestId: request.requestId,
      signal: request.signal,
      userId: request.context.userId,
    })
    request.signal?.throwIfAborted()
    return response
  } catch (error) {
    request.signal?.throwIfAborted()
    return Response.json(
      {
        success: false,
        error: getErrorMessage(error, 'SailPoint request failed'),
      },
      { status: isPayloadSizeLimitError(error) ? 502 : 500 }
    )
  }
}
