import { z } from 'zod'
import {
  fileBrowserCreatorSchema,
  fileBrowserCreatorsQuerySchema,
  fileBrowserItemSchema,
  fileBrowserSizesQuerySchema,
  fileBrowserTypesQuerySchema,
} from '@/lib/api/contracts/file-browser'
import {
  folderIdSchema,
  inlineFileRefQuerySchema,
  nonEmptyIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2PaginationFields, v2SearchSchema, v2SortFields } from '@/lib/api/contracts/v2/shared'
import {
  workspaceCsvPreviewQuerySchema,
  workspaceCsvPreviewResponseSchema,
} from '@/lib/api/contracts/workspace-file-table'
import {
  createWorkspaceFileBodySchema,
  updateWorkspaceFileContentBodySchema,
  workspaceFileRecordSchema,
  workspaceFileScopeSchema,
} from '@/lib/api/contracts/workspace-files'
import { FILE_BROWSER_SORTS } from '@/lib/workspace-files/browser'

export const projectFilesParamsSchema = z.object({ id: nonEmptyIdSchema })
export type ProjectFilesParams = z.input<typeof projectFilesParamsSchema>

export const projectFileParamsSchema = projectFilesParamsSchema.extend({ fileId: nonEmptyIdSchema })
export type ProjectFileParams = z.input<typeof projectFileParamsSchema>

export const projectFileRecordSchema = workspaceFileRecordSchema
  .omit({ workspaceId: true, storageContext: true, vfsNamespace: true })
  .extend({
    owner: z.object({ entityType: z.literal('project'), entityId: nonEmptyIdSchema }),
    uploadedBy: nonEmptyIdSchema,
  })
export type ProjectFileRecord = z.output<typeof projectFileRecordSchema>

export const projectFileCapabilitiesSchema = z.object({
  canRead: z.boolean(),
  canWrite: z.boolean(),
})
export type ProjectFileCapabilities = z.output<typeof projectFileCapabilitiesSchema>

export const listProjectFilesQuerySchema = z.object({
  scope: workspaceFileScopeSchema.default('active'),
  folderId: folderIdSchema.optional(),
  search: v2SearchSchema.optional(),
  types: fileBrowserTypesQuerySchema,
  sizes: fileBrowserSizesQuerySchema,
  creatorIds: fileBrowserCreatorsQuerySchema,
  ...v2SortFields(FILE_BROWSER_SORTS, { sortBy: 'updated', sortOrder: 'desc' }),
  ...v2PaginationFields(),
})
export type ListProjectFilesQuery = z.output<typeof listProjectFilesQuerySchema>

export const listProjectFilesResponseSchema = z.object({
  files: z.array(projectFileRecordSchema),
  items: z.array(fileBrowserItemSchema),
  creators: z.array(fileBrowserCreatorSchema),
  nextCursor: z.string().nullable(),
  capabilities: projectFileCapabilitiesSchema,
})
export type ListProjectFilesResponse = z.output<typeof listProjectFilesResponseSchema>

export const listProjectFilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files',
  params: projectFilesParamsSchema,
  query: listProjectFilesQuerySchema,
  response: { mode: 'json', schema: listProjectFilesResponseSchema },
})

export const getProjectFileResponseSchema = z.object({
  file: projectFileRecordSchema,
  capabilities: projectFileCapabilitiesSchema,
})
export type GetProjectFileResponse = z.output<typeof getProjectFileResponseSchema>

export const getProjectFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/[fileId]',
  params: projectFileParamsSchema,
  response: { mode: 'json', schema: getProjectFileResponseSchema },
})

export const createProjectFileBodySchema = createWorkspaceFileBodySchema.safeExtend({
  exactName: z.boolean().default(false),
  folderPath: z.string().max(4096).optional(),
})
export type CreateProjectFileBody = z.input<typeof createProjectFileBodySchema>

export const createProjectFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files',
  params: projectFilesParamsSchema,
  body: createProjectFileBodySchema,
  response: { mode: 'json', schema: getProjectFileResponseSchema, status: 201 },
})

export const updateProjectFileContentBodySchema = updateWorkspaceFileContentBodySchema
  .safeExtend({
    expectedRevision: z.string().min(1).max(1024).optional(),
    contentType: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
export type UpdateProjectFileContentBody = z.input<typeof updateProjectFileContentBodySchema>

export const updateProjectFileContentResponseSchema = getProjectFileResponseSchema.safeExtend({
  file: projectFileRecordSchema.extend({ currentVersion: z.number().int().positive() }),
})
export type UpdateProjectFileContentResponse = z.output<
  typeof updateProjectFileContentResponseSchema
>

export const updateProjectFileContentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/projects/[id]/files/[fileId]/content',
  params: projectFileParamsSchema,
  body: updateProjectFileContentBodySchema,
  response: { mode: 'json', schema: updateProjectFileContentResponseSchema },
})

export const readProjectFileContentContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/[fileId]/content',
  params: projectFileParamsSchema,
  response: { mode: 'binary' },
})

export const projectFileArtifactQuerySchema = z.object({
  preview: z.enum(['1', '0']).optional(),
  v: z.string().max(128).optional(),
  t: z.string().max(32).optional(),
})
export type ProjectFileArtifactQuery = z.input<typeof projectFileArtifactQuerySchema>

export const readProjectFileArtifactContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/[fileId]/artifact',
  params: projectFileParamsSchema,
  query: projectFileArtifactQuerySchema,
  response: { mode: 'binary' },
})

export const getInlineProjectFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/inline',
  params: projectFilesParamsSchema,
  query: inlineFileRefQuerySchema,
  response: { mode: 'binary' },
})

export const getProjectCsvPreviewContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/[fileId]/csv-preview',
  params: projectFileParamsSchema,
  query: workspaceCsvPreviewQuerySchema,
  response: { mode: 'json', schema: workspaceCsvPreviewResponseSchema },
})
