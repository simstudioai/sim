import { getValidationErrorMessage } from '@/lib/api/server'
import { executeAshbyUpload } from '@/lib/internal/ashby/operations'
import { ashbyUploadInputSchema } from '@/lib/internal/ashby/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeAshbyTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId)
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  if (request.toolId !== 'ashby_upload_resume' && request.toolId !== 'ashby_upload_candidate_file')
    return Response.json(
      { success: false, error: `Unsupported Ashby tool: ${request.toolId}` },
      { status: 500 }
    )
  const parsed = ashbyUploadInputSchema.safeParse(request.input)
  if (!parsed.success)
    return Response.json(
      { success: false, error: getValidationErrorMessage(parsed.error, 'Invalid request data') },
      { status: 400 }
    )
  return executeAshbyUpload(
    parsed.data,
    request.toolId === 'ashby_upload_resume' ? 'resume' : 'file',
    { userId: request.context.userId, requestId: request.requestId, signal: request.signal }
  )
}
