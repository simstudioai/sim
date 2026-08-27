import { createLogger } from '@sim/logger'
import { downloadPipedriveFile, listPipedriveFiles } from '@/lib/internal/pipedrive/client'
import type { PipedriveGetFilesInput } from '@/lib/internal/pipedrive/schema'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('PipedriveOperations')

export interface PipedriveOperationContext {
  requestId: string
  signal?: AbortSignal
}

export async function executePipedriveGetFiles(
  input: PipedriveGetFilesInput,
  context: PipedriveOperationContext
) {
  context.signal?.throwIfAborted()
  const page = await listPipedriveFiles(input, context.signal)
  const downloadedFiles: Array<{
    data: string
    mimeType: string
    name: string
    size: number
  }> = []
  let downloadedBytes = 0

  if (input.downloadFiles) {
    for (const file of page.files) {
      context.signal?.throwIfAborted()
      if (!file.url || downloadedBytes >= MAX_BUFFERED_TRANSFER_BYTES) continue
      try {
        const downloaded = await downloadPipedriveFile(
          file.url,
          input,
          MAX_BUFFERED_TRANSFER_BYTES - downloadedBytes,
          context.signal
        )
        if (!downloaded) continue
        downloadedBytes += downloaded.buffer.length
        const name = file.name || `pipedrive-file-${file.id || Date.now()}`
        const extension = getFileExtension(name)
        downloadedFiles.push({
          name,
          mimeType: downloaded.contentType || getMimeTypeFromExtension(extension),
          data: downloaded.buffer.toString('base64'),
          size: downloaded.buffer.length,
        })
      } catch (error) {
        context.signal?.throwIfAborted()
        logger.warn('Failed to download Pipedrive file', {
          fileId: file.id,
          requestId: context.requestId,
        })
      }
    }
  }
  context.signal?.throwIfAborted()
  return {
    success: true,
    output: {
      files: page.files,
      downloadedFiles: downloadedFiles.length > 0 ? downloadedFiles : undefined,
      total_items: page.files.length,
      has_more: page.hasMore,
      next_start: page.nextStart,
      success: true,
    },
  }
}
