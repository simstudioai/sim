import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { ZoomOperationError } from '@/lib/internal/zoom/errors'
import { getZoomMeetingRecordings } from '@/lib/internal/zoom/operations'

const inputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  meetingId: z.string().min(1, 'Meeting ID is required'),
  includeFolderItems: z.boolean().optional(),
  ttl: z.number().max(604800).optional(),
  downloadFiles: z.boolean().default(false),
})

export const executeZoomTool: InternalToolOperationHandler = async (request) => {
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
    return Response.json(
      await getZoomMeetingRecordings(parsed.data, {
        requestId: request.requestId,
        signal: request.signal,
      })
    )
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
