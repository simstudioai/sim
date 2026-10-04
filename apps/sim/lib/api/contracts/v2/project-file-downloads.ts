import { z } from 'zod'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { exportProjectFileSnapshotBodySchema } from '@/lib/api/contracts/project-file-downloads'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2QuerySelectionListSchema } from '@/lib/api/contracts/v2/files'
import {
  v2ProjectFileParamsSchema,
  v2ProjectFilesParamsSchema,
} from '@/lib/api/contracts/v2/project-files'
import { MAX_ZIP_DOWNLOAD_FILES } from '@/lib/workspace-files/limits'

export const v2DownloadProjectFileItemsQuerySchema = z
  .object({
    fileIds: v2QuerySelectionListSchema('fileIds').describe(
      `File identifiers to include, comma-separated. At most ${MAX_ZIP_DOWNLOAD_FILES} entries.`
    ),
    folderIds: v2QuerySelectionListSchema('folderIds').describe(
      `Folder identifiers to include recursively, comma-separated. The resolved selection allows at most ${MAX_ZIP_DOWNLOAD_FILES} files.`
    ),
  })
  .strict()
export type V2DownloadProjectFileItemsQuery = z.output<typeof v2DownloadProjectFileItemsQuerySchema>

export const v2DownloadProjectFileItemsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/projects/[projectId]/files/bulk-download',
  params: v2ProjectFilesParamsSchema,
  query: v2DownloadProjectFileItemsQuerySchema,
  response: { mode: 'binary' },
})

export const v2ExportProjectFileSnapshotBodySchema = exportProjectFileSnapshotBodySchema.extend({
  content: exportProjectFileSnapshotBodySchema.shape.content.describe(
    'Visible Markdown snapshot to export. This does not replace the stored file or create a version.'
  ),
})
export type V2ExportProjectFileSnapshotBody = z.input<typeof v2ExportProjectFileSnapshotBodySchema>

export const v2ExportProjectFileSnapshotContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files/[fileId]/export',
  params: v2ProjectFileParamsSchema,
  query: noInputSchema,
  body: v2ExportProjectFileSnapshotBodySchema,
  response: { mode: 'binary' },
})
