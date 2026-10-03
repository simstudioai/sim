import { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { ZipArchive } from 'archiver'
import { downloadWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import {
  defineInternalBinaryRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { nodeReadableToWebStream } from '@/lib/core/utils/node-stream'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { buildZipEntryPaths } from '@/lib/uploads/zip-entry-path'
import { internalFileAnalytics, internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { downloadWorkspaceFileItems } from '@/lib/workspace-files/application/download-workspace-file-items'

const logger = createLogger('WorkspaceFilesDownloadAPI')

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

export const GET = defineInternalBinaryRoute({
  contract: downloadWorkspaceFileItemsContract,
  auth: internalSessionAuth,
  operation: downloadWorkspaceFileItems.operation,
  rateLimit: internalRateLimits.none({ reason: 'Internal workspace zip download' }),
  errorPolicy: internalFileErrorPolicies.downloadArchive,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    fileIds: query.fileIds,
    folderIds: query.folderIds,
  }),
  useCase: downloadWorkspaceFileItems,
  onSuccess: internalFileAnalytics.bulkDownloaded,
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
      headers: { 'Cache-Control': 'no-store' },
    }
  },
})
