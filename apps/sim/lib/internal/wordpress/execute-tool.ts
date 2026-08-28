import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { WordPressOperationError } from '@/lib/internal/wordpress/errors'
import { uploadWordPressMedia } from '@/lib/internal/wordpress/operations'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'

const inputSchema = z.object({
  accessToken: z.string().min(1),
  siteId: z.string().min(1),
  file: RawFileInputSchema.optional().nullable(),
  filename: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
  altText: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
})

export const executeWordPressTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'wordpress_upload_media') {
    return Response.json(
      { success: false, error: `Unsupported WordPress tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  const parsed = inputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  try {
    return Response.json(
      await uploadWordPressMedia(parsed.data, {
        userId,
        requestId: request.requestId,
        signal: request.signal,
      })
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    if (isPayloadSizeLimitError(error)) {
      return Response.json(
        {
          success: false,
          error: `Failed to download file: file exceeds maximum size of ${MAX_BUFFERED_TRANSFER_BYTES} bytes`,
        },
        { status: 413 }
      )
    }
    const status = error instanceof WordPressOperationError ? error.status : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status }
    )
  }
}
