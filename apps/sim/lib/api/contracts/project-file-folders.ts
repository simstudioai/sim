import { z } from 'zod'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import {
  projectFileCapabilitiesSchema,
  projectFilesParamsSchema,
} from '@/lib/api/contracts/project-files'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  createWorkspaceFileFolderBodySchema,
  listWorkspaceFileFoldersQuerySchema,
  updateWorkspaceFileFolderBodySchema,
  workspaceFileFolderSchema,
} from '@/lib/api/contracts/workspace-file-folders'

export const projectFileFolderParamsSchema = projectFilesParamsSchema.extend({
  folderId: nonEmptyIdSchema,
})
export type ProjectFileFolderParams = z.input<typeof projectFileFolderParamsSchema>

export const projectFileFolderRecordSchema = workspaceFileFolderSchema
  .omit({ workspaceId: true })
  .extend({
    owner: z.object({ entityType: z.literal('project'), entityId: nonEmptyIdSchema }),
    userId: nonEmptyIdSchema.nullable(),
  })
export type ProjectFileFolderRecord = z.output<typeof projectFileFolderRecordSchema>

export const listProjectFileFoldersQuerySchema = listWorkspaceFileFoldersQuerySchema
export type ListProjectFileFoldersQuery = z.output<typeof listProjectFileFoldersQuerySchema>

export const listProjectFileFoldersResponseSchema = z.object({
  folders: z.array(projectFileFolderRecordSchema),
  capabilities: projectFileCapabilitiesSchema,
})
export type ListProjectFileFoldersResponse = z.output<typeof listProjectFileFoldersResponseSchema>

export const listProjectFileFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/folders',
  params: projectFilesParamsSchema,
  query: listProjectFileFoldersQuerySchema,
  response: { mode: 'json', schema: listProjectFileFoldersResponseSchema },
})

export const createProjectFileFolderBodySchema = createWorkspaceFileFolderBodySchema
export type CreateProjectFileFolderBody = z.input<typeof createProjectFileFolderBodySchema>

export const updateProjectFileFolderBodySchema = updateWorkspaceFileFolderBodySchema
export type UpdateProjectFileFolderBody = z.input<typeof updateProjectFileFolderBodySchema>

export const projectFileFolderResponseSchema = z.object({ folder: projectFileFolderRecordSchema })
export type ProjectFileFolderResponse = z.output<typeof projectFileFolderResponseSchema>

export const createProjectFileFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/folders',
  params: projectFilesParamsSchema,
  body: createProjectFileFolderBodySchema,
  response: { mode: 'json', schema: projectFileFolderResponseSchema },
})

export const updateProjectFileFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/projects/[id]/files/folders/[folderId]',
  params: projectFileFolderParamsSchema,
  body: updateProjectFileFolderBodySchema,
  response: { mode: 'json', schema: projectFileFolderResponseSchema },
})
