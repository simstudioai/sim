import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { DaytonaOperationError } from '@/lib/internal/daytona/errors'
import { uploadDaytonaFile } from '@/lib/internal/daytona/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'

const inputSchema = z.object({
  apiKey: z.string().min(1),
  sandboxId: z.string().min(1),
  destinationPath: z.string().min(1),
  file: RawFileInputSchema.optional().nullable(),
  fileContent: z.string().nullish(),
  fileName: z.string().nullish(),
})

export const executeDaytonaTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'daytona_upload_file') {
    return Response.json(
      { success: false, error: `Unsupported Daytona tool: ${request.toolId}` },
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
      await uploadDaytonaFile(
        {
          ...parsed.data,
          file: parsed.data.file ?? undefined,
          fileContent: parsed.data.fileContent ?? undefined,
          fileName: parsed.data.fileName ?? undefined,
        },
        {
          userId,
          requestId: request.requestId,
          signal: request.signal,
        }
      )
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    const status =
      error instanceof DaytonaOperationError
        ? error.status
        : isPayloadSizeLimitError(error)
          ? 400
          : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status }
    )
  }
}
