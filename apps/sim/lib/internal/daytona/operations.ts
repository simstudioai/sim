import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { DaytonaOperationError } from '@/lib/internal/daytona/errors'
import { isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { DaytonaUploadFileParams, DaytonaUploadFileResponse } from '@/tools/daytona/types'
import { daytonaToolboxUrl } from '@/tools/daytona/utils'

const logger = createLogger('DaytonaOperations')
const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024
const MAX_DAYTONA_ERROR_BYTES = 256 * 1024

export interface DaytonaOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

export interface DaytonaUploadFileInput extends Omit<DaytonaUploadFileParams, 'file'> {
  file?: RawFileInput
}

async function getDaytonaError(response: Response, signal?: AbortSignal): Promise<string> {
  try {
    const body = await readResponseJsonWithLimit<{ message?: string | string[]; error?: string }>(
      response,
      { maxBytes: MAX_DAYTONA_ERROR_BYTES, label: 'Daytona error response', signal }
    )
    if (typeof body.message === 'string') return body.message
    if (Array.isArray(body.message)) return body.message.join(', ')
    if (body.error) return body.error
  } catch {}
  return `Failed to upload file (status ${response.status})`
}

export async function uploadDaytonaFile(
  input: DaytonaUploadFileInput,
  context: DaytonaOperationContext
): Promise<DaytonaUploadFileResponse> {
  context.signal?.throwIfAborted()
  let fileBuffer: Buffer
  let fileName: string
  if (input.file) {
    const userFile = processFilesToUserFiles([input.file], context.requestId, logger)[0]
    if (!userFile) throw new DaytonaOperationError('Invalid file input', 400)
    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    if (denied) throw new DaytonaOperationError('File not found', denied.status)
    if (userFile.size > MAX_UPLOAD_SIZE_BYTES) {
      const sizeMB = (userFile.size / (1024 * 1024)).toFixed(2)
      throw new DaytonaOperationError(`File size (${sizeMB}MB) exceeds upload limit of 100MB`, 400)
    }
    try {
      const servable = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
        maxBytes: MAX_UPLOAD_SIZE_BYTES,
        signal: context.signal,
      })
      fileBuffer = servable.buffer
    } catch (error) {
      if (isPayloadSizeLimitError(error) || isDocNotReadyError(error)) throw error
      throw new DaytonaOperationError(getErrorMessage(error, 'Failed to download file'), 500)
    }
    fileName = input.fileName || userFile.name
  } else if (input.fileContent) {
    const estimatedSize = Math.floor((input.fileContent.length * 3) / 4)
    if (estimatedSize > MAX_UPLOAD_SIZE_BYTES) {
      const sizeMB = (estimatedSize / (1024 * 1024)).toFixed(2)
      throw new DaytonaOperationError(`File size (${sizeMB}MB) exceeds upload limit of 100MB`, 400)
    }
    fileBuffer = Buffer.from(input.fileContent, 'base64')
    fileName = input.fileName || 'file'
  } else {
    throw new DaytonaOperationError('File is required', 400)
  }
  context.signal?.throwIfAborted()
  if (fileBuffer.length > MAX_UPLOAD_SIZE_BYTES) {
    const sizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2)
    throw new DaytonaOperationError(`File size (${sizeMB}MB) exceeds upload limit of 100MB`, 400)
  }
  const requestedPath = input.destinationPath.trim()
  if (!requestedPath) throw new DaytonaOperationError('Destination path is required', 400)
  const destinationPath = requestedPath.endsWith('/')
    ? `${requestedPath}${fileName}`
    : requestedPath
  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(fileBuffer)], { type: 'application/octet-stream' }),
    fileName
  )
  const response = await fetch(
    daytonaToolboxUrl(
      input.sandboxId,
      `/files/upload-v2?path=${encodeURIComponent(destinationPath)}`
    ),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
      signal: context.signal,
    }
  )
  if (!response.ok) {
    throw new DaytonaOperationError(
      await getDaytonaError(response, context.signal),
      response.status
    )
  }
  return {
    success: true,
    output: { uploadedPath: destinationPath, name: fileName, size: fileBuffer.length },
  }
}
