import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { OneDriveOperationError } from '@/lib/internal/onedrive/errors'
import { downloadOneDriveFile, uploadOneDriveFile } from '@/lib/internal/onedrive/operations'
import { oneDriveUploadInputSchema } from '@/lib/internal/onedrive/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

const downloadInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileId: z.string().min(1, 'File ID is required'),
  fileName: z.string().optional().nullable(),
})

function inputSizeError(input: unknown): Response | null {
  let serialized: string
  try {
    serialized = JSON.stringify(input) ?? ''
  } catch {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serialized) <= DEFAULT_MAX_JSON_BODY_BYTES) return null
  return Response.json(
    {
      error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
    },
    { status: 413 }
  )
}

export const executeOneDriveTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const sizeError = inputSizeError(request.input)
  if (sizeError) return sizeError
  try {
    switch (request.toolId) {
      case 'onedrive_download': {
        const parsed = downloadInputSchema.safeParse(request.input)
        if (!parsed.success) return validationErrorResponse(parsed.error)
        return Response.json(
          await downloadOneDriveFile(
            { ...parsed.data, fileName: parsed.data.fileName ?? undefined },
            { signal: request.signal }
          )
        )
      }
      case 'onedrive_upload': {
        const parsed = oneDriveUploadInputSchema.safeParse(request.input)
        if (!parsed.success) return validationErrorResponse(parsed.error)
        return Response.json(
          await uploadOneDriveFile(parsed.data, {
            requestId: request.requestId,
            signal: request.signal,
            userId: request.context.userId,
          })
        )
      }
      default:
        return Response.json(
          { success: false, error: `Unsupported OneDrive tool: ${request.toolId}` },
          { status: 500 }
        )
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    const status = isPayloadSizeLimitError(error)
      ? 413
      : error instanceof OneDriveOperationError
        ? error.status
        : 500
    return Response.json(
      error instanceof OneDriveOperationError
        ? error.body
        : { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status }
    )
  }
}

function validationErrorResponse(error: z.ZodError): Response {
  return Response.json(
    { success: false, error: getValidationErrorMessage(error, 'Invalid request data') },
    { status: 400 }
  )
}
