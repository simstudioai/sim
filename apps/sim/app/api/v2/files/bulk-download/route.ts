import { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { ZipArchive } from 'archiver'
import { v2BulkDownloadFilesContract } from '@/lib/api/contracts/v2/files'
import { defineV2BinaryRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { buildZipEntryPaths } from '@/lib/uploads/zip-entry-path'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { downloadWorkspaceFileItems } from '@/lib/workspace-files/application/download-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const logger = createLogger('V2FilesBulkDownloadAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Opens each object only as the archiver reaches it, so peak memory stays flat. */
function lazyWorkspaceFileStream(file: WorkspaceFileRecord): Readable {
  return Readable.from(
    (async function* () {
      yield* await downloadFileStream({
        key: file.key,
        context: file.storageContext ?? 'workspace',
      })
    })(),
    { objectMode: false }
  )
}

/**
 * GET /api/v2/files/bulk-download — stream a selection of files as one zip.
 *
 * Folders are addressed by path, matching the rest of the v2 file surface, and
 * expand to all their descendants. Selections are capped on input and again on
 * the resolved file count and total bytes, so a broad selection is rejected
 * rather than streamed forever.
 *
 * `headSafe: false` because the download records a `FILE_DOWNLOADED` audit
 * event and pulls bytes out of object storage.
 */
export const GET = defineV2BinaryRoute({
  contract: v2BulkDownloadFilesContract,
  auth: v2ApiKeyAuth,
  headSafe: false,
  operation: fileOperations.download,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    fileIds: query.fileIds,
    folderIds: [],
    folderPaths: query.folderPaths,
  }),
  useCase: downloadWorkspaceFileItems,
  present: ({ filesToZip, folderPaths, renderedDocuments }) => {
    const entryPaths = buildZipEntryPaths(
      filesToZip.map((file) => ({
        name: file.name,
        folderPath: file.folderId ? folderPaths.get(file.folderId) : null,
        contentType: file.type,
      }))
    )
    const archive = new ZipArchive({ store: true })
    archive.on('warning', (error: Error) => {
      logger.warn('Archive warning while streaming workspace files', { error })
    })
    filesToZip.forEach((file, index) => {
      archive.append(renderedDocuments.get(file.id) ?? lazyWorkspaceFileStream(file), {
        name: entryPaths[index],
      })
    })
    archive.finalize().catch((error) => {
      logger.error('Failed to finalize workspace file archive', { error })
    })

    return {
      body: nodeReadableToWebStream(archive),
      contentType: 'application/zip',
      contentDisposition: 'attachment; filename="workspace-files.zip"',
    }
  },
})
