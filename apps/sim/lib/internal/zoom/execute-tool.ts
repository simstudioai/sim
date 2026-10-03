import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { isInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'
import type {
  InternalToolOperationHandler,
  InternalToolOperationResult,
} from '@/lib/internal/tool-operations/types'
import { ZoomOperationError } from '@/lib/internal/zoom/errors'
import { getZoomMeetingRecordings } from '@/lib/internal/zoom/operations'

const inputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  meetingId: z.string().min(1, 'Meeting ID is required'),
  includeFolderItems: z.boolean().optional(),
  ttl: z.number().max(604800).optional(),
  downloadFiles: z.boolean().default(false),
})

export const executeZoomTool: InternalToolOperationHandler<InternalToolOperationResult> = async (
  request
) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'zoom_get_meeting_recordings') {
    return Response.json(
      { success: false, error: `Unsupported Zoom tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const parsed = inputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  try {
    const result = await getZoomMeetingRecordings(parsed.data, {
      requestId: request.requestId,
      signal: request.signal,
    })
    return isInternalToolFileResult(result) ? result : Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof ZoomOperationError) {
      return Response.json({ success: false, error: error.message }, { status: error.status })
    }
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status: 500 }
    )
  }
}
