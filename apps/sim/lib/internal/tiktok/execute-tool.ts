import { getValidationErrorMessage } from '@/lib/api/server'
import { executeTikTokUploadVideoDraft } from '@/lib/internal/tiktok/operations'
import { tiktokUploadVideoDraftInputSchema } from '@/lib/internal/tiktok/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const executeTikTokTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'tiktok_upload_video_draft') {
    return Response.json({ error: `Unsupported TikTok tool: ${request.toolId}` }, { status: 500 })
  }
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

  const parsed = tiktokUploadVideoDraftInputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { success: false, error: getValidationErrorMessage(parsed.error, 'Invalid request data') },
      { status: 400 }
    )
  }

  return executeTikTokUploadVideoDraft(parsed.data, {
    userId: request.context.userId,
    requestId: request.requestId,
    signal: request.signal,
  })
}
