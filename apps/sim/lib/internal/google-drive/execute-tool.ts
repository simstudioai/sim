import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import {
  isPayloadSizeLimitError,
  MAX_MULTIPART_OVERHEAD_BYTES,
} from '@/lib/core/utils/stream-limits'
import { GoogleDriveOperationError } from '@/lib/internal/google-drive/errors'
import {
  googleDriveDownloadInputSchema,
  googleDriveExportInputSchema,
  googleDriveMoveInputSchema,
  googleDriveUploadInputSchema,
} from '@/lib/internal/google-drive/input'
import {
  executeGoogleDriveDownload,
  executeGoogleDriveExport,
  executeGoogleDriveMove,
  executeGoogleDriveUpload,
  type GoogleDriveOperationContext,
} from '@/lib/internal/google-drive/operations'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const logger = createLogger('GoogleDriveToolExecution')
const MAX_UPLOAD_INPUT_BYTES = MAX_BUFFERED_TRANSFER_BYTES + MAX_MULTIPART_OVERHEAD_BYTES

function inputLimit(toolId: string): number {
  return toolId === 'google_drive_upload' ? MAX_UPLOAD_INPUT_BYTES : DEFAULT_MAX_JSON_BODY_BYTES
}

function validationResponse(error: z.ZodError): Response {
  return Response.json(
    { success: false, error: error.issues[0]?.message || 'Invalid request' },
    { status: 400 }
  )
}

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> | Response {
  const parsed = schema.safeParse(input)
  return parsed.success ? parsed.data : validationResponse(parsed.error)
}

async function dispatch(
  request: InternalToolOperationCall,
  context: GoogleDriveOperationContext
): Promise<unknown | Response> {
  switch (request.toolId) {
    case 'google_drive_download': {
      const input = parseInput(googleDriveDownloadInputSchema, request.input)
      return input instanceof Response ? input : executeGoogleDriveDownload(input, context)
    }
    case 'google_drive_export': {
      const input = parseInput(googleDriveExportInputSchema, request.input)
      return input instanceof Response ? input : executeGoogleDriveExport(input, context)
    }
    case 'google_drive_move': {
      const input = parseInput(googleDriveMoveInputSchema, request.input)
      return input instanceof Response ? input : executeGoogleDriveMove(input, context)
    }
    case 'google_drive_upload': {
      const input = parseInput(googleDriveUploadInputSchema, request.input)
      return input instanceof Response ? input : executeGoogleDriveUpload(input, context)
    }
    default:
      return Response.json(
        { success: false, error: `Unsupported Google Drive tool: ${request.toolId}` },
        { status: 500 }
      )
  }
}

function unexpectedResponse(request: InternalToolOperationCall, error: unknown): Response {
  const fallback =
    request.toolId === 'google_drive_upload' ? 'Internal server error' : 'Unknown error occurred'
  const message = getErrorMessage(error, fallback)
  logger.error('Google Drive operation failed', {
    error: message,
    requestId: request.requestId,
    toolId: request.toolId,
  })
  const status =
    ['google_drive_download', 'google_drive_export'].includes(request.toolId) &&
    isPayloadSizeLimitError(error)
      ? 413
      : 500
  return Response.json({ success: false, error: message }, { status })
}

export const executeGoogleDriveTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  let serialized: string
  try {
    serialized = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ success: false, error: 'Invalid request' }, { status: 400 })
  }
  const maxBytes = inputLimit(request.toolId)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    return Response.json(
      {
        success: false,
        error: `Request body exceeds the maximum allowed size of ${maxBytes} bytes`,
      },
      { status: 413 }
    )
  }

  try {
    const result = await dispatch(request, {
      requestId: request.requestId,
      signal: request.signal,
      userId: request.context.userId,
    })
    request.signal?.throwIfAborted()
    return result instanceof Response ? result : Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof GoogleDriveOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    return unexpectedResponse(request, error)
  }
}
