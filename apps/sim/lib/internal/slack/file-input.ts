import type { Logger } from '@sim/logger'
import { SlackOperationError } from '@/lib/internal/slack/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

export interface SlackResolvedFile {
  buffer: Buffer
  contentType: string
  name: string
  type?: string
}

export interface SlackFileInputContext {
  logger: Logger
  requestId: string
  signal?: AbortSignal
  userId?: string
}

/** Resolves and consumes one Slack attachment at a time under one aggregate byte cap. */
export async function forEachSlackAttachmentFile(
  files: RawFileInput[],
  context: SlackFileInputContext,
  consume: (file: SlackResolvedFile) => Promise<void>
): Promise<void> {
  context.signal?.throwIfAborted()
  if (!context.userId) {
    throw new SlackOperationError(401, { success: false, error: 'Authentication required' })
  }

  const userFiles = processFilesToUserFiles(files, context.requestId, context.logger)
  let remainingBytes = MAX_BUFFERED_TRANSFER_BYTES

  for (const file of userFiles) {
    context.signal?.throwIfAborted()
    const denied = await assertToolFileAccess(
      file.key,
      context.userId,
      context.requestId,
      context.logger
    )
    context.signal?.throwIfAborted()
    if (denied) {
      throw new SlackOperationError(404, { success: false, error: 'File not found' })
    }

    const downloaded = await downloadServableFileFromStorage(
      file,
      context.requestId,
      context.logger,
      { maxBytes: remainingBytes, signal: context.signal }
    )
    context.signal?.throwIfAborted()
    remainingBytes -= downloaded.buffer.length
    await consume({
      buffer: downloaded.buffer,
      contentType: downloaded.contentType,
      name: file.name,
      type: file.type,
    })
    context.signal?.throwIfAborted()
  }
}
