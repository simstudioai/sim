import { z } from 'zod'
import { folderIdSchema, noInputSchema, nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import {
  projectFileRecordSchema,
  projectFilesParamsSchema,
} from '@/lib/api/contracts/project-files'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2CreateFileUploadBodySchema } from '@/lib/api/contracts/v2/files'
import {
  v2PartUrlsBodySchema,
  v2PartUrlsDataSchema,
  v2UploadStatusSchema,
  v2UploadTokenHeadersSchema,
  v2UploadTransferSchema,
} from '@/lib/api/contracts/v2/uploads'

export const projectFileUploadParamsSchema = projectFilesParamsSchema.extend({
  uploadId: nonEmptyIdSchema,
})
export type ProjectFileUploadParams = z.input<typeof projectFileUploadParamsSchema>

export const createProjectFileUploadBodySchema = v2CreateFileUploadBodySchema
  .omit({ workspaceId: true })
  .extend({ folderId: folderIdSchema.optional() })
  .strict()
export type CreateProjectFileUploadBody = z.input<typeof createProjectFileUploadBodySchema>

export const projectFileUploadSessionSchema = z
  .object({
    id: nonEmptyIdSchema,
    purpose: z.literal('project_file'),
    status: v2UploadStatusSchema,
    name: z.string(),
    contentType: z.string(),
    size: z.number().int().nonnegative(),
    expiresAt: z.string().datetime(),
    error: z.string().nullable(),
    result: projectFileRecordSchema.nullable(),
  })
  .strict()
export type ProjectFileUploadSession = z.output<typeof projectFileUploadSessionSchema>

export const createProjectFileUploadResponseSchema = z
  .object({
    session: projectFileUploadSessionSchema,
    uploadToken: z.string().min(1),
    transfer: v2UploadTransferSchema,
  })
  .strict()
export type CreateProjectFileUploadResponse = z.output<typeof createProjectFileUploadResponseSchema>

export const createProjectFileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/uploads',
  params: projectFilesParamsSchema,
  body: createProjectFileUploadBodySchema,
  response: { mode: 'json', schema: createProjectFileUploadResponseSchema, status: 201 },
})

export const getProjectFileUploadContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]/files/uploads/[uploadId]',
  params: projectFileUploadParamsSchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: projectFileUploadSessionSchema },
})

export const abortProjectFileUploadContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/projects/[id]/files/uploads/[uploadId]',
  params: projectFileUploadParamsSchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: projectFileUploadSessionSchema },
})

export const completeProjectFileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/uploads/[uploadId]/complete',
  params: projectFileUploadParamsSchema,
  headers: v2UploadTokenHeadersSchema,
  body: noInputSchema,
  response: { mode: 'json', schema: projectFileUploadSessionSchema },
})

export const getProjectFileUploadPartUrlsContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects/[id]/files/uploads/[uploadId]/parts',
  params: projectFileUploadParamsSchema,
  headers: v2UploadTokenHeadersSchema,
  body: v2PartUrlsBodySchema,
  response: { mode: 'json', schema: v2PartUrlsDataSchema },
})
