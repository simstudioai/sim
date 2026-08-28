import type { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { JupyterUploadBody } from '@/lib/api/contracts/storage-transfer'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'

type JupyterLogger = ReturnType<typeof createLogger>

export type JupyterUploadFileResolution =
  | { success: true; buffer: Buffer; fileName: string }
  | { success: false; response: Response }

/** Resolves either a protected Sim file or legacy inline base64 content for upload. */
export async function resolveJupyterUploadFile(
  input: JupyterUploadBody,
  context: {
    userId: string
    requestId: string
    logger: JupyterLogger
    signal?: AbortSignal
  }
): Promise<JupyterUploadFileResolution> {
  const { userId, requestId, logger, signal } = context
  signal?.throwIfAborted()

  if (input.file) {
    const userFiles = processFilesToUserFiles([input.file as RawFileInput], requestId, logger)
    if (userFiles.length === 0) {
      return {
        success: false,
        response: Response.json({ success: false, error: 'Invalid file input' }, { status: 400 }),
      }
    }
    const userFile = userFiles[0]

    const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
    signal?.throwIfAborted()
    if (denied) return { success: false, response: denied }

    try {
      signal?.throwIfAborted()
      const result = await downloadServableFileFromStorage(userFile, requestId, logger, {
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
        signal,
      })
      signal?.throwIfAborted()
      return {
        success: true,
        buffer: result.buffer,
        fileName: input.fileName || userFile.name,
      }
    } catch (error) {
      signal?.throwIfAborted()
      const notReady = docNotReadyResponse(error)
      if (notReady) return { success: false, response: notReady }
      return {
        success: false,
        response: Response.json(
          { success: false, error: getErrorMessage(error, 'Failed to download file') },
          { status: isPayloadSizeLimitError(error) ? 413 : 500 }
        ),
      }
    }
  }

  if (input.fileContent) {
    return {
      success: true,
      buffer: Buffer.from(input.fileContent, 'base64'),
      fileName: input.fileName || 'file',
    }
  }

  return {
    success: false,
    response: Response.json({ success: false, error: 'File is required' }, { status: 400 }),
  }
}
