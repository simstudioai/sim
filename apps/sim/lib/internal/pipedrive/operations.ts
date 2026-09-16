import { createLogger } from '@sim/logger'
import { downloadPipedriveFile, listPipedriveFiles } from '@/lib/internal/pipedrive/client'
import type { PipedriveGetFilesInput } from '@/lib/internal/pipedrive/schema'
import {
  createInternalToolFilesResult,
  type InternalToolFile,
} from '@/lib/internal/tool-operations/file-result'
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
  const downloadedFiles: InternalToolFile[] = []
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
          buffer: downloaded.buffer,
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
  const output = {
    files: page.files,
    total_items: page.files.length,
    has_more: page.hasMore,
    next_start: page.nextStart,
    success: true,
  }
  if (downloadedFiles.length === 0) return { success: true, output }
  return createInternalToolFilesResult(downloadedFiles, (files) => ({
    success: true,
    output: { ...output, downloadedFiles: files },
  }))
}
