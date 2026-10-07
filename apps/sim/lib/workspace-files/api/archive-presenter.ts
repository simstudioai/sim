import { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
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
  const inputs: Readable[] = []
  for (const [index, file] of filesToZip.entries()) {
    const rendered = renderedDocuments.get(file.id)
    if (rendered) archive.append(rendered, { name: entryPaths[index] })
    else {
      const input = Readable.from(
        (async function* () {
          const source = await downloadFileStream({
            key: file.key,
            context: file.storageContext ?? 'workspace',
          })
          try {
            yield* source
          } finally {
            source.destroy()
          }
        })(),
        { objectMode: false }
      )
      inputs.push(input)
      archive.append(input, { name: entryPaths[index] })
    }
  }
  archive.once('close', () => {
    for (const input of inputs) input.destroy()
  })
  archive.finalize().catch((error: Error) => {
    logger.error('Failed to finalize file archive', { error })
    archive.destroy(error)
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
