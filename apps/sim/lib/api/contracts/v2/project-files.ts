import { z } from 'zod'
import { isCanonicalBase64, noInputSchema, nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { projectFileRecordSchema } from '@/lib/api/contracts/project-files'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CreateFileBodySchema,
  v2FileSchema,
  v2ListFilesQuerySchema,
  v2UpdateFileContentBodySchema,
  writtenFileRevisionSchema,
} from '@/lib/api/contracts/v2/files'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
} from '@/lib/api/contracts/v2/shared'

export const v2ProjectFilesParamsSchema = z.object({
  projectId: nonEmptyIdSchema.describe('Project identifier.'),
})
export type V2ProjectFilesParams = z.input<typeof v2ProjectFilesParamsSchema>

export const v2ProjectFileParamsSchema = v2ProjectFilesParamsSchema.extend({
  fileId: nonEmptyIdSchema.describe('File identifier within the Project.'),
})
export type V2ProjectFileParams = z.input<typeof v2ProjectFileParamsSchema>

export const v2ProjectFileSchema = v2FileSchema
  .omit({ uploadedByEmail: true, webUrl: true })
  .extend({
    owner: projectFileRecordSchema.shape.owner
      .extend({
        entityType: z.literal('project').describe('The file owner is a Project.'),
        entityId: nonEmptyIdSchema.describe('Identifier of the owning Project.'),
      })
      .describe('Canonical owner of the shared file.'),
    uploadedBy: nonEmptyIdSchema.nullable().describe('Creator identifier, when available.'),
    originalCreatorUserId: nonEmptyIdSchema
      .nullable()
      .describe('Original creator identifier retained after account deletion.'),
    revision: writtenFileRevisionSchema,
    folderPath: v2FileSchema.shape.folderPath.describe(
      'Canonical containing-folder path. `/` is the Project root.'
    ),
  })
  .meta({ id: 'V2ProjectFile', title: 'Project file' })
export type V2ProjectFile = z.output<typeof v2ProjectFileSchema>

export const v2ListProjectFilesQuerySchema = v2ListFilesQuerySchema
  .omit({ workspaceId: true })
  .extend(v2PaginationFields({ max: 1000, fallback: 100, description: 'Maximum files per page.' }))
export type V2ListProjectFilesQuery = z.output<typeof v2ListProjectFilesQuerySchema>

export const v2ListProjectFilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/projects/[projectId]/files',
  params: v2ProjectFilesParamsSchema,
  query: v2ListProjectFilesQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2ProjectFileSchema) },
})

export const v2GetProjectFileMetadataContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/projects/[projectId]/files/[fileId]/metadata',
  params: v2ProjectFileParamsSchema,
  query: noInputSchema,
  response: { mode: 'json', schema: v2DataResponse(v2ProjectFileSchema) },
})

function validateContentEncoding(
  value: { content: string; encoding: 'utf-8' | 'base64' },
  context: z.RefinementCtx
) {
  if (value.encoding === 'base64' && !isCanonicalBase64(value.content)) {
    context.addIssue({ code: 'custom', path: ['content'], message: 'content must be valid base64' })
  }
}

export const v2CreateProjectFileBodySchema = z
  .object({
    name: v2CreateFileBodySchema.shape.name,
    contentType: v2CreateFileBodySchema.shape.contentType,
    content: v2CreateFileBodySchema.shape.content,
    encoding: v2CreateFileBodySchema.shape.encoding,
    folderPath: v2CreateFileBodySchema.shape.folderPath.describe(
      'Canonical containing-folder path. Omit for the Project root.'
    ),
  })
  .strict()
  .superRefine(validateContentEncoding)
export type V2CreateProjectFileBody = z.input<typeof v2CreateProjectFileBodySchema>

export const v2UpdateProjectFileContentBodySchema = z
  .object({
    content: v2UpdateFileContentBodySchema.shape.content,
    encoding: v2UpdateFileContentBodySchema.shape.encoding,
    expectedRevision: v2UpdateFileContentBodySchema.shape.expectedRevision,
  })
  .strict()
  .superRefine(validateContentEncoding)
export type V2UpdateProjectFileContentBody = z.input<typeof v2UpdateProjectFileContentBodySchema>

export const v2CreateProjectFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files',
  params: v2ProjectFilesParamsSchema,
  query: noInputSchema,
  body: v2CreateProjectFileBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2ProjectFileSchema), status: 201 },
})

export const v2ReadProjectFileContentContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/projects/[projectId]/files/[fileId]/content',
  params: v2ProjectFileParamsSchema,
  query: noInputSchema,
  response: { mode: 'binary' },
})

export const v2UpdateProjectFileContentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/projects/[projectId]/files/[fileId]/content',
  params: v2ProjectFileParamsSchema,
  query: noInputSchema,
  body: v2UpdateProjectFileContentBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2ProjectFileSchema) },
})
