import type { z } from 'zod'
import { noInputSchema, nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { createProjectFileUploadBodySchema } from '@/lib/api/contracts/project-file-uploads'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2CreateFileUploadDataSchema, v2FileUploadSchema } from '@/lib/api/contracts/v2/files'
import {
  v2ProjectFileSchema,
  v2ProjectFilesParamsSchema,
} from '@/lib/api/contracts/v2/project-files'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import {
  v2PartUrlsBodySchema,
  v2PartUrlsDataSchema,
  v2UploadTokenHeadersSchema,
} from '@/lib/api/contracts/v2/uploads'

export const v2ProjectFileUploadParamsSchema = v2ProjectFilesParamsSchema.extend({
  uploadId: nonEmptyIdSchema.describe('Upload session identifier within the Project.'),
})
export type V2ProjectFileUploadParams = z.input<typeof v2ProjectFileUploadParamsSchema>

export const v2CreateProjectFileUploadBodySchema = createProjectFileUploadBodySchema.extend({
  folderId: createProjectFileUploadBodySchema.shape.folderId.describe(
    'Destination folder identifier; omit or use null for the Project root.'
  ),
  folderPath: createProjectFileUploadBodySchema.shape.folderPath.describe(
    'Canonical destination folder path. Specify either folderId or folderPath, not both.'
  ),
})
export type V2CreateProjectFileUploadBody = z.input<typeof v2CreateProjectFileUploadBodySchema>

export const v2ProjectFileUploadSchema = v2FileUploadSchema
  .extend({
    file: v2ProjectFileSchema
      .nullable()
      .describe(
        'Registered Project file after finalization, or null before registration or after archival.'
      ),
  })
  .meta({ id: 'V2ProjectFileUpload', title: 'Project file upload session' })
export type V2ProjectFileUpload = z.output<typeof v2ProjectFileUploadSchema>

export const v2CreateProjectFileUploadDataSchema = v2CreateFileUploadDataSchema
  .extend({
    session: v2ProjectFileUploadSchema.describe('New Project upload session.'),
  })
  .meta({ id: 'V2CreateProjectFileUploadData', title: 'Create Project file upload data' })
export type V2CreateProjectFileUploadData = z.output<typeof v2CreateProjectFileUploadDataSchema>

export const v2CreateProjectFileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files/uploads',
  params: v2ProjectFilesParamsSchema,
  query: noInputSchema,
  body: v2CreateProjectFileUploadBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CreateProjectFileUploadDataSchema),
    status: 201,
  },
})

export const v2GetProjectFileUploadContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/projects/[projectId]/files/uploads/[uploadId]',
  params: v2ProjectFileUploadParamsSchema,
  query: noInputSchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2ProjectFileUploadSchema) },
})

export const v2AbortProjectFileUploadContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/projects/[projectId]/files/uploads/[uploadId]',
  params: v2ProjectFileUploadParamsSchema,
  query: noInputSchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2ProjectFileUploadSchema) },
})

export const v2CompleteProjectFileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files/uploads/[uploadId]/complete',
  params: v2ProjectFileUploadParamsSchema,
  query: noInputSchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2ProjectFileUploadSchema) },
})

export const v2GetProjectFileUploadPartUrlsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/projects/[projectId]/files/uploads/[uploadId]/parts',
  params: v2ProjectFileUploadParamsSchema,
  query: noInputSchema,
  headers: v2UploadTokenHeadersSchema,
  body: v2PartUrlsBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2PartUrlsDataSchema) },
})
