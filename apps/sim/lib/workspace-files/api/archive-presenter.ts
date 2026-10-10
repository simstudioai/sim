import { once } from 'node:events'
import { addAbortSignal, Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { ZipArchive } from 'archiver'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { FILE_CACHE_CONTROL, fileDeliveryHeaders } from '@/lib/uploads/server/delivery'
import { buildZipEntryPaths } from '@/lib/uploads/zip-entry-path'
import type { DownloadWorkspaceFileItemsResult } from '@/lib/workspace-files/application/download-workspace-file-items'

const logger = createLogger('FileArchiveDelivery')

/** Stream an authorized archive plan, opening at most the current entry rather than buffering files. */
export function presentWorkspaceFileArchive({
  filesToZip,
  folderPaths,
  renderedDocuments,
}: DownloadWorkspaceFileItemsResult) {
  const entryPaths = buildZipEntryPaths(
    filesToZip.map((file) => ({
      name: file.name,
      folderPath: file.folderId ? folderPaths.get(file.folderId) : null,
      contentType: file.type,
    }))
  )
  const archive = new ZipArchive({ store: true })
  archive.on('warning', (error: Error) => logger.warn('Archive warning', { error }))
  const closed = new AbortController()
  let activeInput: Readable | undefined
  archive.once('close', () => {
    closed.abort()
    activeInput?.destroy()
  })
  async function appendEntries() {
    for (const [index, file] of filesToZip.entries()) {
      closed.signal.throwIfAborted()
      const rendered = renderedDocuments.get(file.id)
      const input =
        rendered ??
        Readable.from(
          (async function* () {
            const source = addAbortSignal(
              closed.signal,
              await downloadFileStream({
                key: file.key,
                context: file.storageContext ?? 'workspace',
              })
            )
            try {
              yield* source
            } finally {
              source.destroy()
            }
          })(),
          { objectMode: false }
        )
      activeInput = input instanceof Readable ? input : undefined
      const consumed = once(archive, 'entry', { signal: closed.signal })
      const sourceFinished = activeInput
        ? finished(activeInput, { readable: true, writable: false, cleanup: true })
        : undefined
      try {
        archive.append(input, { name: entryPaths[index] })
        await Promise.all([consumed, sourceFinished])
      } finally {
        activeInput?.destroy()
        activeInput = undefined
      }
    }
    await archive.finalize()
  }
  appendEntries().catch((error: unknown) => {
    if (toError(error).name === 'AbortError') return
    logger.error('Failed to build file archive', { error })
    archive.destroy(toError(error))
  })
  return {
    body: nodeReadableToWebStream(archive),
    contentType: 'application/zip',
    headers: fileDeliveryHeaders({
      filename: 'workspace-files.zip',
      contentType: 'application/zip',
      attachment: true,
      cacheControl: FILE_CACHE_CONTROL.noStore,
    }),
  }
}
