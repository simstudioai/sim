import { getErrorMessage } from '@sim/utils/errors'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { GoogleSlidesOperationError } from '@/lib/internal/google-slides/errors'
import { googleSlidesExportInputSchema } from '@/lib/internal/google-slides/input'
import { exportGoogleSlidesPresentation } from '@/lib/internal/google-slides/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeGoogleSlidesTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'google_slides_export_presentation') {
    return Response.json(
      { success: false, error: `Unsupported Google Slides tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const parsed = googleSlidesExportInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  try {
    return Response.json(
      await exportGoogleSlidesPresentation(parsed.data, {
        userId,
        workspaceId: request.context.workspaceId,
        workflowId: request.context.workflowId,
        executionId: request.context.executionId,
        signal: request.signal,
      })
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const status = isPayloadSizeLimitError(error)
      ? 413
      : error instanceof GoogleSlidesOperationError
        ? error.status
        : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Failed to export presentation') },
      { status }
    )
  }
}
