import { getValidationErrorMessage } from '@/lib/api/server'
import { executePlaneUploadAttachment } from '@/lib/internal/plane/operations'
import { planeUploadAttachmentInputSchema } from '@/lib/internal/plane/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executePlaneTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId)
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  if (request.toolId !== 'plane_upload_attachment')
    return Response.json(
      { success: false, error: `Unsupported Plane tool: ${request.toolId}` },
      { status: 500 }
    )
  const parsed = planeUploadAttachmentInputSchema.safeParse(request.input)
  if (!parsed.success)
    return Response.json(
      { success: false, error: getValidationErrorMessage(parsed.error, 'Invalid request data') },
      { status: 400 }
    )
  return executePlaneUploadAttachment(parsed.data, {
    userId: request.context.userId,
    requestId: request.requestId,
    signal: request.signal,
  })
}
