import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { BoxClient, BoxUploadError } from '@/lib/internal/box/client'
import type { BoxUploadFileInput } from '@/lib/internal/box/schema'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('BoxOperations')

export interface BoxOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

function failureResponse(error: string, status: number): Response {
  return Response.json({ success: false, error }, { status })
}

export async function executeBoxUploadFile(
  input: BoxUploadFileInput,
  context: BoxOperationContext
): Promise<Response> {
  context.signal?.throwIfAborted()
  let buffer: Buffer
  let fileName: string

  if (input.file) {
    if (typeof input.file === 'string') return failureResponse('Invalid file input', 400)
    const userFile = processFilesToUserFiles([input.file], context.requestId, logger)[0]
    if (!userFile) return failureResponse('Invalid file input', 400)
    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (denied) return denied
    try {
      const resolved = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
        signal: context.signal,
      })
      buffer = resolved.buffer
    } catch (error) {
      context.signal?.throwIfAborted()
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      return failureResponse(
        getErrorMessage(error, 'Failed to download file'),
        isPayloadSizeLimitError(error) ? 413 : 500
      )
    }
    fileName = input.fileName || userFile.name
  } else if (input.fileContent) {
    buffer = Buffer.from(input.fileContent, 'base64')
    try {
      assertKnownSizeWithinLimit(buffer.length, MAX_BUFFERED_TRANSFER_BYTES, 'Box upload file')
    } catch (error) {
      return failureResponse(
        getErrorMessage(error, 'Failed to decode file'),
        isPayloadSizeLimitError(error) ? 413 : 500
      )
    }
    fileName = input.fileName || 'file'
  } else {
    return failureResponse('File is required', 400)
  }

  try {
    const output = await new BoxClient(input.accessToken, context.signal).upload(
      input.parentFolderId,
      fileName,
      buffer
    )
    context.signal?.throwIfAborted()
    return Response.json({ success: true, output })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (error instanceof BoxUploadError) return failureResponse(error.message, error.status)
    logger.error('Unexpected Box upload error', {
      error: getErrorMessage(error),
      requestId: context.requestId,
    })
    return failureResponse(getErrorMessage(error, 'Unknown error'), 500)
  }
}
