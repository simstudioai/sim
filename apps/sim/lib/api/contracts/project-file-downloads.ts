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

export const exportProjectFileSnapshotBodySchema = exportWorkspaceFileSnapshotBodySchema.strict()
export type ExportProjectFileSnapshotBody = z.input<typeof exportProjectFileSnapshotBodySchema>
export const exportProjectFileSnapshotContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/[fileId]/export',
  params: projectFileParamsSchema,
  body: exportProjectFileSnapshotBodySchema,
  response: { mode: 'binary' },
})
