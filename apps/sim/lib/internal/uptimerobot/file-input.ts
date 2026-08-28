import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { UptimeRobotOperationError } from '@/lib/internal/uptimerobot/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

export async function appendUptimeRobotPspImage(args: {
  form: FormData
  field: 'logo' | 'icon'
  file: unknown
  userId: string
  requestId: string
  logger: Logger
  signal?: AbortSignal
}): Promise<void> {
  const { form, field, file, userId, requestId, logger, signal } = args
  signal?.throwIfAborted()
  const userFiles = processFilesToUserFiles([file as RawFileInput], requestId, logger)
  if (userFiles.length === 0) {
    throw new UptimeRobotOperationError(
      `Invalid ${field} file: expected an uploaded file reference`,
      400
    )
  }

  const userFile = userFiles[0]
  const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
  signal?.throwIfAborted()
  if (denied) {
    let message = 'File not found'
    try {
      const body = (await denied.json()) as { error?: unknown }
      if (typeof body.error === 'string') message = body.error
    } catch (error) {
      logger.warn('Failed to read denied file-access response', {
        error: getErrorMessage(error),
        field,
        requestId,
      })
    }
    throw new UptimeRobotOperationError(message, denied.status)
  }

  const { buffer, contentType } = await downloadServableFileFromStorage(
    userFile,
    requestId,
    logger,
    { maxBytes: MAX_BUFFERED_TRANSFER_BYTES, signal }
  )
  signal?.throwIfAborted()
  const mimeType = contentType || userFile.type || 'application/octet-stream'
  form.append(field, new Blob([new Uint8Array(buffer)], { type: mimeType }), userFile.name)
}
