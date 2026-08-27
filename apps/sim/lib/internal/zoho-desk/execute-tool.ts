import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { ZohoDeskOperationError } from '@/lib/internal/zoho-desk/errors'
import {
  getZohoDeskAttachment,
  MAX_ZOHO_DESK_ATTACHMENT_BYTES,
} from '@/lib/internal/zoho-desk/operations'

const inputSchema = z.object({
  accessToken: z.string().min(1),
  apiDomain: z.string().optional(),
  orgId: z.string().min(1),
  href: z.string().min(1),
  fileName: z.string().optional(),
})

export const executeZohoDeskTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'zoho_desk_get_attachment') {
    return Response.json(
      { success: false, error: `Unsupported Zoho Desk tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const parsed = inputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  try {
    return Response.json(
      await getZohoDeskAttachment(parsed.data, {
        signal: request.signal,
      })
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    if (isPayloadSizeLimitError(error)) {
      return Response.json(
        {
          success: false,
          error: `Attachment exceeds the ${Math.floor(MAX_ZOHO_DESK_ATTACHMENT_BYTES / (1024 * 1024))} MB download limit`,
        },
        { status: 413 }
      )
    }
    const status = error instanceof ZohoDeskOperationError ? error.status : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Failed to download attachment') },
      { status }
    )
  }
}
