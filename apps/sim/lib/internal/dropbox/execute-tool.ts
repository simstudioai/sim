import { getErrorMessage } from '@sim/utils/errors'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { executeDropboxUpload } from '@/lib/internal/dropbox/operations'
import { dropboxUploadInputSchema } from '@/lib/internal/dropbox/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeDropboxTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  if (request.toolId !== 'dropbox_upload') {
    return Response.json(
      { success: false, error: `Unsupported Dropbox tool: ${request.toolId}` },
      { status: 500 }
    )
  }
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
  const parsed = dropboxUploadInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { success: false, error: getValidationErrorMessage(parsed.error, 'Invalid request data') },
      { status: 400 }
    )
  }
  try {
    return await executeDropboxUpload(parsed.data, {
      userId,
      requestId: request.requestId,
      signal: request.signal,
    })
  } catch (error) {
    request.signal?.throwIfAborted()
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
}
