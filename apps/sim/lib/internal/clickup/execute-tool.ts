import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { ClickUpOperationError } from '@/lib/internal/clickup/errors'
import { executeClickUpUploadAttachment } from '@/lib/internal/clickup/operations'
import { clickupUploadAttachmentInputSchema } from '@/lib/internal/clickup/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const logger = createLogger('ClickUpToolExecution')

function inputSizeError(input: unknown): Response | null {
  let serialized: string
  try {
    serialized = JSON.stringify(input) ?? ''
  } catch {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  return Buffer.byteLength(serialized) > DEFAULT_MAX_JSON_BODY_BYTES
    ? Response.json(
        {
          error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
        },
        { status: 413 }
      )
    : null
}

export const executeClickUpTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'clickup_upload_attachment') {
    return Response.json(
      { success: false, error: `Unsupported ClickUp tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const userId = request.context.userId
  if (!userId) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  const sizeError = inputSizeError(request.input)
  if (sizeError) return sizeError
  const parsed = clickupUploadAttachmentInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { success: false, error: getValidationErrorMessage(parsed.error, 'Invalid request data') },
      { status: 400 }
    )
  }
  try {
    const result = await executeClickUpUploadAttachment(parsed.data, {
      requestId: request.requestId,
      signal: request.signal,
      userId,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof ClickUpOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    const message = getErrorMessage(error, 'Internal server error')
    logger.error('ClickUp attachment upload failed', {
      error: message,
      requestId: request.requestId,
    })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
