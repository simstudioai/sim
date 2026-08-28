import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { VantaOperationError } from '@/lib/internal/vanta/errors'
import {
  VANTA_MAX_TRANSFER_BYTES,
  type VantaUploadDocumentFileInput,
} from '@/lib/internal/vanta/input'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('VantaFileInput')

export interface VantaResolvedUploadFile {
  buffer: Buffer
  fileName: string
  mimeType: string
}

function uploadSizeError(bytes: number): VantaOperationError {
  const sizeMB = (bytes / (1024 * 1024)).toFixed(2)
  return new VantaOperationError(400, {
    success: false,
    error: `File size (${sizeMB}MB) exceeds upload limit of 100MB`,
  })
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return { success: false, error: response.statusText || 'File operation failed' }
  }
}

export async function resolveVantaUploadFile(
  input: VantaUploadDocumentFileInput,
  context: { requestId: string; signal?: AbortSignal; userId: string }
): Promise<VantaResolvedUploadFile> {
  context.signal?.throwIfAborted()
  if (input.file) {
    if (typeof input.file === 'string') {
      throw new VantaOperationError(400, { success: false, error: 'Invalid file input' })
    }
    const userFiles = processFilesToUserFiles(
      [input.file as RawFileInput],
      context.requestId,
      logger
    )
    if (userFiles.length === 0) {
      throw new VantaOperationError(400, { success: false, error: 'Invalid file input' })
    }
    const userFile = userFiles[0]
    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (denied) throw new VantaOperationError(denied.status, await responseBody(denied))
    if (userFile.size > VANTA_MAX_TRANSFER_BYTES) throw uploadSizeError(userFile.size)

    try {
      const resolved = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
        maxBytes: VANTA_MAX_TRANSFER_BYTES,
        signal: context.signal,
      })
      context.signal?.throwIfAborted()
      /**
       * Every return path of `downloadServableFileFromStorage` yields a non-empty content
       * type, so `resolved.contentType` always wins. The remaining operands are defensive
       * fallbacks kept in place in case that guarantee is ever relaxed.
       */
      return {
        buffer: resolved.buffer,
        fileName: input.fileName || userFile.name,
        mimeType:
          resolved.contentType || userFile.type || input.mimeType || 'application/octet-stream',
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      const notReady = docNotReadyResponse(error)
      if (notReady) throw new VantaOperationError(notReady.status, await responseBody(notReady))
      if (isPayloadSizeLimitError(error)) {
        throw uploadSizeError(error.observedBytes ?? userFile.size)
      }
      logger.error('Failed to download Vanta upload file', {
        error: getErrorMessage(error),
        requestId: context.requestId,
      })
      throw new VantaOperationError(500, {
        success: false,
        error: getErrorMessage(error, 'Failed to download file'),
      })
    }
  }

  if (!input.fileContent) {
    throw new VantaOperationError(400, { success: false, error: 'File is required' })
  }
  const buffer = Buffer.from(input.fileContent, 'base64')
  if (buffer.length > VANTA_MAX_TRANSFER_BYTES) throw uploadSizeError(buffer.length)
  return {
    buffer,
    fileName: input.fileName || 'file',
    mimeType: input.mimeType || 'application/octet-stream',
  }
}
