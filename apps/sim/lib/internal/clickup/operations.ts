import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { uploadClickUpAttachment } from '@/lib/internal/clickup/client'
import { ClickUpOperationError } from '@/lib/internal/clickup/errors'
import type { ClickUpUploadAttachmentInput } from '@/lib/internal/clickup/schema'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { parseRawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { mapClickUpAttachment } from '@/tools/clickup/shared'

const logger = createLogger('ClickUpOperations')
const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024

export interface ClickUpOperationContext {
  requestId: string
  signal?: AbortSignal
  userId: string
}

async function deniedBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null)
  return isRecordLike(body) ? body : { success: false, error: 'File not found' }
}

function uploadSizeError(bytes: number): ClickUpOperationError {
  const sizeMB = (bytes / (1024 * 1024)).toFixed(2)
  return new ClickUpOperationError(`File size (${sizeMB}MB) exceeds upload limit of 100MB`, 400)
}

export async function executeClickUpUploadAttachment(
  input: ClickUpUploadAttachmentInput,
  context: ClickUpOperationContext
) {
  context.signal?.throwIfAborted()
  const parsedFile = parseRawFileInput(input.file)
  if (!parsedFile) {
    throw new ClickUpOperationError('No valid file provided for upload', 400)
  }
  const userFiles = processFilesToUserFiles([parsedFile], context.requestId, logger)
  const userFile = userFiles[0]
  if (!userFile) {
    throw new ClickUpOperationError('No valid file provided for upload', 400)
  }

  const denied = await assertToolFileAccess(userFile.key, context.userId, context.requestId, logger)
  context.signal?.throwIfAborted()
  if (denied) {
    throw new ClickUpOperationError('File not found', denied.status, await deniedBody(denied))
  }
  if (userFile.size > MAX_UPLOAD_SIZE_BYTES) throw uploadSizeError(userFile.size)

  let buffer: Buffer
  let downloadedContentType: string
  try {
    const downloaded = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
      maxBytes: MAX_UPLOAD_SIZE_BYTES,
      signal: context.signal,
    })
    buffer = downloaded.buffer
    downloadedContentType = downloaded.contentType
  } catch (error) {
    context.signal?.throwIfAborted()
    if (isDocNotReadyError(error)) {
      throw new ClickUpOperationError(docNotReadyMessage(), 409)
    }
    if (isPayloadSizeLimitError(error)) {
      throw uploadSizeError(error.observedBytes ?? userFile.size)
    }
    throw error
  }
  if (buffer.length > MAX_UPLOAD_SIZE_BYTES) throw uploadSizeError(buffer.length)

  const formData = new FormData()
  const mimeType = downloadedContentType || userFile.type || 'application/octet-stream'
  formData.append(
    'attachment',
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    userFile.name
  )
  const data = await uploadClickUpAttachment(
    input.accessToken,
    input.taskId,
    formData,
    context.signal
  )
  context.signal?.throwIfAborted()
  return {
    success: true,
    output: { attachment: mapClickUpAttachment(data), files: userFiles },
  }
}
