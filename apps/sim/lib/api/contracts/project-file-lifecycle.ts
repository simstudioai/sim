import { z } from 'zod'
import { noInputSchema, nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import {
  projectFileFolderParamsSchema,
  projectFileFolderRecordSchema,
} from '@/lib/api/contracts/project-file-folders'
import {
  projectFileParamsSchema,
  projectFileRecordSchema,
  projectFilesParamsSchema,
} from '@/lib/api/contracts/project-files'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  bulkArchiveWorkspaceFileItemsBodySchema,
  moveWorkspaceFileItemsBodySchema,
} from '@/lib/api/contracts/workspace-file-folders'
import { renameWorkspaceFileBodySchema } from '@/lib/api/contracts/workspace-files'

const renameProjectFileBodySchema = renameWorkspaceFileBodySchema.strict()
export type RenameProjectFileBody = z.input<typeof renameProjectFileBodySchema>

const renameProjectFileResponseSchema = z.object({ file: projectFileRecordSchema })

export const renameProjectFileContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/projects/[id]/files/[fileId]',
  params: projectFileParamsSchema,
  body: renameProjectFileBodySchema,
  response: { mode: 'json', schema: renameProjectFileResponseSchema },
})

const moveProjectFileItemsBodySchema = moveWorkspaceFileItemsBodySchema.strict()
export type MoveProjectFileItemsBody = z.input<typeof moveProjectFileItemsBodySchema>

export const moveProjectFileItemsResponseSchema = z.object({
  movedFiles: z.number().int().nonnegative().describe('Number of files moved.'),
  movedFolders: z.number().int().nonnegative().describe('Number of folders moved.'),
  movedFileIds: z.array(nonEmptyIdSchema).describe('Identifiers of moved files.'),
  movedFolderIds: z.array(nonEmptyIdSchema).describe('Identifiers of moved folders.'),
})

export const moveProjectFileItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/move',
  params: projectFilesParamsSchema,
  body: moveProjectFileItemsBodySchema,
  response: { mode: 'json', schema: moveProjectFileItemsResponseSchema },
})

export const archiveProjectFileItemsBodySchema = bulkArchiveWorkspaceFileItemsBodySchema.strict()
export type ArchiveProjectFileItemsBody = z.input<typeof archiveProjectFileItemsBodySchema>

export const archiveProjectFileItemsResponseSchema = z.object({
  deletedItems: z
    .object({
      files: z.number().int().nonnegative().describe('Number of affected files.'),
      folders: z.number().int().nonnegative().describe('Number of affected folders.'),
    })
    .describe('Counts of affected file items.'),
  affectedIds: z
    .object({
      fileIds: z.array(nonEmptyIdSchema).describe('Identifiers of affected files.'),
      folderIds: z.array(nonEmptyIdSchema).describe('Identifiers of affected folders.'),
    })
    .describe('Identifiers of affected file items.'),
})

export const archiveProjectFileItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/archive',
  params: projectFilesParamsSchema,
  body: archiveProjectFileItemsBodySchema,
  response: { mode: 'json', schema: archiveProjectFileItemsResponseSchema },
})

const restoreProjectFileResponseSchema = z.object({
  restored: z.literal(true),
  file: projectFileRecordSchema,
})

export const restoreProjectFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/[fileId]/restore',
  params: projectFileParamsSchema,
  body: noInputSchema,
  response: { mode: 'json', schema: restoreProjectFileResponseSchema },
})

export const restoreProjectFileFolderResponseSchema = z.object({
  folder: projectFileFolderRecordSchema,
  restoredItems: z
    .object({
      files: z.number().int().nonnegative().describe('Number of affected files.'),
      folders: z.number().int().nonnegative().describe('Number of affected folders.'),
    })
    .describe('Counts of affected file items.'),
})

export const restoreProjectFileFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/folders/[folderId]/restore',
  params: projectFileFolderParamsSchema,
  body: noInputSchema,
  response: { mode: 'json', schema: restoreProjectFileFolderResponseSchema },
})
