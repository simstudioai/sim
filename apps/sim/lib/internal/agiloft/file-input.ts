import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { AgiloftOperationError } from '@/lib/internal/agiloft/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { parseRawFileInput, type RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('AgiloftFileInput')

async function bodyFromResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return { success: false, error: response.statusText || 'File operation failed' }
  }
}

export async function resolveAgiloftAttachmentFile(
  file: RawFileInput | string | undefined,
  context: { userId?: string; requestId: string; signal?: AbortSignal }
) {
  context.signal?.throwIfAborted()
  if (!context.userId) {
    throw new AgiloftOperationError(401, {
      success: false,
      error: 'Authentication required',
    })
  }
  if (!file) {
    throw new AgiloftOperationError(400, { success: false, error: 'File is required' })
  }

  const parsedFile = parseRawFileInput(file)
  if (!parsedFile) {
    throw new AgiloftOperationError(400, { success: false, error: 'Invalid file input' })
  }

  const userFiles = processFilesToUserFiles([parsedFile], context.requestId, logger)
  if (userFiles.length === 0) {
    throw new AgiloftOperationError(400, { success: false, error: 'Invalid file input' })
  }

  const userFile = userFiles[0]!
  const denied = await assertToolFileAccess(userFile.key, context.userId, context.requestId, logger)
  if (denied) {
    throw new AgiloftOperationError(denied.status, await bodyFromResponse(denied))
  }

  context.signal?.throwIfAborted()
  try {
    const servable = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      signal: context.signal,
    })
    context.signal?.throwIfAborted()
    return { userFile, buffer: servable.buffer }
  } catch (error) {
    context.signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) {
      throw new AgiloftOperationError(notReady.status, await bodyFromResponse(notReady))
    }
    throw new AgiloftOperationError(isPayloadSizeLimitError(error) ? 413 : 500, {
      success: false,
      error: toError(error).message,
    })
  }
}
