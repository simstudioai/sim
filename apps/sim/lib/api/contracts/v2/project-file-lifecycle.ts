import type { z } from 'zod'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import {
  archiveProjectFileItemsBodySchema,
  archiveProjectFileItemsResponseSchema,
  moveProjectFileItemsResponseSchema,
} from '@/lib/api/contracts/project-file-lifecycle'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2MoveFileItemsBodySchema, v2RenameFileBodySchema } from '@/lib/api/contracts/v2/files'
import {
  v2ProjectFileParamsSchema,
  v2ProjectFileSchema,
  v2ProjectFilesParamsSchema,
} from '@/lib/api/contracts/v2/project-files'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'

export const v2RenameProjectFileBodySchema = v2RenameFileBodySchema.omit({ workspaceId: true })
export type V2RenameProjectFileBody = z.input<typeof v2RenameProjectFileBodySchema>

export const v2ArchiveProjectFileItemsBodySchema = archiveProjectFileItemsBodySchema.safeExtend({
  fileIds: archiveProjectFileItemsBodySchema.shape.fileIds.describe(
    'Identifiers of the files to archive.'
  ),
  folderIds: archiveProjectFileItemsBodySchema.shape.folderIds.describe(
    'Identifiers of folders to archive recursively, including their files and descendants.'
  ),
})
export type V2ArchiveProjectFileItemsBody = z.input<typeof v2ArchiveProjectFileItemsBodySchema>

export const v2MoveProjectFileItemsBodySchema = archiveProjectFileItemsBodySchema.safeExtend({
  fileIds: archiveProjectFileItemsBodySchema.shape.fileIds.describe(
    'Identifiers of the files to move.'
  ),
  folderIds: archiveProjectFileItemsBodySchema.shape.folderIds.describe(
    'Identifiers of folders to move with their contents.'
  ),
  targetFolderPath: v2MoveFileItemsBodySchema.shape.targetFolderPath.describe(
    'Existing destination folder path within the Project. Omit to move items to the Project root.'
  ),
})
export type V2MoveProjectFileItemsBody = z.input<typeof v2MoveProjectFileItemsBodySchema>

export const v2RenameProjectFileContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/projects/[projectId]/files/[fileId]',
  params: v2ProjectFileParamsSchema,
  query: noInputSchema,
  body: v2RenameProjectFileBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2ProjectFileSchema) },
})

export const v2MoveProjectFileItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files/move',
  params: v2ProjectFilesParamsSchema,
  query: noInputSchema,
  body: v2MoveProjectFileItemsBodySchema,
  response: { mode: 'json', schema: v2DataResponse(moveProjectFileItemsResponseSchema) },
})

export const v2ArchiveProjectFileItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files/archive',
  params: v2ProjectFilesParamsSchema,
  query: noInputSchema,
  body: v2ArchiveProjectFileItemsBodySchema,
  response: { mode: 'json', schema: v2DataResponse(archiveProjectFileItemsResponseSchema) },
})

export const v2RestoreProjectFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files/[fileId]/restore',
  params: v2ProjectFileParamsSchema,
  query: noInputSchema,
  body: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2ProjectFileSchema) },
})
