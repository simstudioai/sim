import { z } from 'zod'
import { noInputSchema, nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import {
  createProjectFileFolderBodySchema,
  listProjectFileFoldersQuerySchema,
  projectFileFolderRecordSchema,
  updateProjectFileFolderBodySchema,
} from '@/lib/api/contracts/project-file-folders'
import { restoreProjectFileFolderResponseSchema } from '@/lib/api/contracts/project-file-lifecycle'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2ProjectFilesParamsSchema } from '@/lib/api/contracts/v2/project-files'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

export const v2ProjectFileFolderParamsSchema = v2ProjectFilesParamsSchema.extend({
  folderId: nonEmptyIdSchema.describe('Folder identifier within the Project.'),
})
export type V2ProjectFileFolderParams = z.input<typeof v2ProjectFileFolderParamsSchema>

export const v2ProjectFileFolderSchema = projectFileFolderRecordSchema.extend({
  id: nonEmptyIdSchema.describe('Stable folder identifier.'),
  owner: projectFileFolderRecordSchema.shape.owner
    .extend({
      entityType: z.literal('project').describe('The folder is owned by a Project.'),
      entityId: nonEmptyIdSchema.describe('Identifier of the owning Project.'),
    })
    .strict()
    .describe('Canonical Project owner of the folder.'),
  name: z.string().describe('Folder name.'),
  parentId: nonEmptyIdSchema.nullable().describe('Parent folder identifier, or null at the root.'),
  path: z.string().describe('Display path with slash characters in folder names escaped.'),
  sortOrder: z.number().describe('Position within its parent folder.'),
  userId: nonEmptyIdSchema.describe('Creator or successor identifier.'),
  createdAt: z.iso.datetime().describe('Time the folder was created.'),
  updatedAt: z.iso.datetime().describe('Time the folder was last changed.'),
  deletedAt: z.iso.datetime().nullable().describe('Archive time, or null for an active folder.'),
})
export type V2ProjectFileFolder = z.output<typeof v2ProjectFileFolderSchema>

export const v2ListProjectFileFoldersQuerySchema = listProjectFileFoldersQuerySchema
  .extend({
    scope: listProjectFileFoldersQuerySchema.shape.scope.describe('Folder lifecycle scope.'),
  })
  .strict()
export type V2ListProjectFileFoldersQuery = z.output<typeof v2ListProjectFileFoldersQuerySchema>

export const v2CreateProjectFileFolderBodySchema = createProjectFileFolderBodySchema
  .extend({
    name: createProjectFileFolderBodySchema.shape.name.describe('Name for the new folder.'),
    parentId: nonEmptyIdSchema
      .nullable()
      .optional()
      .describe('Parent folder identifier; omit or use null for the root.'),
  })
  .strict()
export type V2CreateProjectFileFolderBody = z.input<typeof v2CreateProjectFileFolderBodySchema>

export const v2UpdateProjectFileFolderBodySchema = updateProjectFileFolderBodySchema
  .extend({
    name: updateProjectFileFolderBodySchema.shape.name.describe(
      'New folder name; omit to leave unchanged.'
    ),
    parentId: nonEmptyIdSchema
      .nullable()
      .optional()
      .describe(
        'New parent folder identifier; null moves to the root, omission leaves the parent unchanged.'
      ),
    sortOrder: updateProjectFileFolderBodySchema.shape.sortOrder.describe(
      'New manual position; omit to leave unchanged.'
    ),
  })
  .strict()
export type V2UpdateProjectFileFolderBody = z.input<typeof v2UpdateProjectFileFolderBodySchema>

export const v2RestoreProjectFileFolderResponseSchema =
  restoreProjectFileFolderResponseSchema.extend({
    folder: v2ProjectFileFolderSchema.describe('Restored Project folder.'),
  })
export type V2RestoreProjectFileFolderResponse = z.output<
  typeof v2RestoreProjectFileFolderResponseSchema
>

export const v2ListProjectFileFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/projects/[projectId]/files/folders',
  params: v2ProjectFilesParamsSchema,
  query: v2ListProjectFileFoldersQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2ProjectFileFolderSchema, { paged: false }),
  },
})

export const v2CreateProjectFileFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files/folders',
  params: v2ProjectFilesParamsSchema,
  query: noInputSchema,
  body: v2CreateProjectFileFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2ProjectFileFolderSchema), status: 201 },
})

export const v2UpdateProjectFileFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/projects/[projectId]/files/folders/[folderId]',
  params: v2ProjectFileFolderParamsSchema,
  query: noInputSchema,
  body: v2UpdateProjectFileFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2ProjectFileFolderSchema) },
})

export const v2RestoreProjectFileFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files/folders/[folderId]/restore',
  params: v2ProjectFileFolderParamsSchema,
  query: noInputSchema,
  body: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2RestoreProjectFileFolderResponseSchema) },
})
