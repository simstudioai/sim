import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { GoogleDriveOperationError } from '@/lib/internal/google-drive/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('GoogleDriveFileInput')

async function bodyFromResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return { success: false, error: response.statusText || 'File operation failed' }
  }
}

export async function resolveGoogleDriveUploadFile(
  file: RawFileInput,
  context: { requestId: string; signal?: AbortSignal; userId?: string }
) {
  context.signal?.throwIfAborted()
  if (!context.userId) {
    throw new GoogleDriveOperationError(401, {
      success: false,
      error: 'Authentication required',
    })
  }

  let userFile
  try {
    userFile = processSingleFileToUserFile(file, context.requestId, logger)
  } catch (error) {
    throw new GoogleDriveOperationError(400, {
      success: false,
      error: getErrorMessage(error, 'Failed to process file'),
    })
  }

  const denied = await assertToolFileAccess(userFile.key, context.userId, context.requestId, logger)
  context.signal?.throwIfAborted()
  if (denied) {
    throw new GoogleDriveOperationError(denied.status, await bodyFromResponse(denied))
  }

  try {
    const downloaded = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      signal: context.signal,
    })
    context.signal?.throwIfAborted()
    return { userFile, ...downloaded }
  } catch (error) {
    context.signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) {
      throw new GoogleDriveOperationError(notReady.status, await bodyFromResponse(notReady))
    }
    throw new GoogleDriveOperationError(isPayloadSizeLimitError(error) ? 413 : 500, {
      success: false,
      error: `Failed to download file: ${getErrorMessage(error, 'Unknown error')}`,
    })
  }
}
