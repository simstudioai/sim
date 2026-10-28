import type { z } from 'zod'
import {
  projectFileParamsSchema,
  projectFilesParamsSchema,
} from '@/lib/api/contracts/project-files'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { downloadWorkspaceFileItemsQuerySchema } from '@/lib/api/contracts/workspace-file-folders'
import { exportWorkspaceFileSnapshotBodySchema } from '@/lib/api/contracts/workspace-files'

export const downloadProjectFileItemsQuerySchema = downloadWorkspaceFileItemsQuerySchema.strict()
export type DownloadProjectFileItemsQuery = z.output<typeof downloadProjectFileItemsQuerySchema>
export const downloadProjectFileItemsContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/download',
  params: projectFilesParamsSchema,
  query: downloadProjectFileItemsQuerySchema,
  response: { mode: 'binary' },
})

/**
 * The proxy accepts at most 10 MiB of encoded JSON, independently of the decoded Markdown cap.
 * Heavily escaped snapshots can hit this wire limit before their decoded-content limit.
 */
export const MAX_PROJECT_FILE_SNAPSHOT_BODY_BYTES = 10 * 1024 * 1024

export const exportProjectFileSnapshotBodySchema = exportWorkspaceFileSnapshotBodySchema.strict()
export type ExportProjectFileSnapshotBody = z.input<typeof exportProjectFileSnapshotBodySchema>
export const exportProjectFileSnapshotContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/[fileId]/export',
  params: projectFileParamsSchema,
  body: exportProjectFileSnapshotBodySchema,
  response: { mode: 'binary' },
})
