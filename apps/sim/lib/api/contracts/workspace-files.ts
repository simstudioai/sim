import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'

export const workspaceFileScopeSchema = z.enum(['active', 'archived', 'all'])

export const workspaceFilesParamsSchema = z.object({
  id: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
})

export const workspaceFileParamsSchema = workspaceFilesParamsSchema.extend({
  fileId: z.string({ error: 'File ID is required' }).min(1, 'File ID is required'),
})

export const listWorkspaceFilesQuerySchema = z.object({
  scope: workspaceFileScopeSchema.default('active'),
})

export const renameWorkspaceFileBodySchema = z.object({
  name: z
    .string({ error: 'Name is required' })
    .refine((name) => name.trim().length > 0, { message: 'Name is required' }),
})

export const updateWorkspaceFileContentBodySchema = z.object({
  content: z.string(),
  encoding: z.enum(['base64', 'utf-8']).optional(),
})

export const workspaceFileRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  key: z.string(),
  path: z.string(),
  url: z.string().optional(),
  size: z.number(),
  type: z.string(),
  uploadedBy: z.string(),
  deletedAt: z.coerce.date().nullable().optional(),
  uploadedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  storageContext: z.enum(['workspace', 'mothership']).optional(),
})

const workspaceFileSuccessSchema = z.object({
  success: z.boolean(),
})

export const listWorkspaceFilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files',
  params: workspaceFilesParamsSchema,
  query: listWorkspaceFilesQuerySchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema.extend({
      files: z.array(workspaceFileRecordSchema),
    }),
  },
})
export type ListWorkspaceFilesResponse = ContractJsonResponse<typeof listWorkspaceFilesContract>

export const renameWorkspaceFileContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/files/[fileId]',
  params: workspaceFileParamsSchema,
  body: renameWorkspaceFileBodySchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema.extend({
      file: workspaceFileRecordSchema,
    }),
  },
})

export const deleteWorkspaceFileContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/files/[fileId]',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema,
  },
})

export const restoreWorkspaceFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/[fileId]/restore',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema,
  },
})

export const updateWorkspaceFileContentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/files/[fileId]/content',
  params: workspaceFileParamsSchema,
  body: updateWorkspaceFileContentBodySchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema.extend({
      file: workspaceFileRecordSchema,
    }),
  },
})

const documentStyleSummarySchema = z
  .object({
    format: z.enum(['docx', 'pptx']),
    theme: z
      .object({
        name: z.string(),
        colors: z.record(z.string(), z.string()),
        fonts: z.object({ major: z.string(), minor: z.string() }),
      })
      .passthrough(),
    styles: z.array(z.object({}).passthrough()).optional(),
  })
  .passthrough()

export const workspaceFileStyleContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]/style',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: documentStyleSummarySchema,
  },
})

const compiledCheckResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string(), errorName: z.string() }),
])

export const workspaceFileCompiledCheckContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]/compiled-check',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: compiledCheckResponseSchema,
  },
})

export const workspacePresignedUploadBodySchema = z.object({
  fileName: z.string().min(1, 'fileName is required'),
  contentType: z.string().min(1, 'contentType is required'),
  fileSize: z.number().nonnegative('fileSize must be a non-negative number'),
})

export type WorkspacePresignedUploadBody = z.input<typeof workspacePresignedUploadBodySchema>

const workspacePresignedFileInfoSchema = z.object({
  path: z.string(),
  key: z.string(),
  name: z.string(),
  size: z.number(),
  type: z.string(),
})

const workspacePresignedUploadResponseSchema = z.object({
  fileName: z.string(),
  presignedUrl: z.string(),
  fileInfo: workspacePresignedFileInfoSchema,
  uploadHeaders: z.record(z.string(), z.string()).optional(),
  directUploadSupported: z.boolean(),
})

export const workspacePresignedUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/presigned',
  params: workspaceFilesParamsSchema,
  body: workspacePresignedUploadBodySchema,
  response: {
    mode: 'json',
    schema: workspacePresignedUploadResponseSchema,
  },
})

export const registerWorkspaceFileBodySchema = z.object({
  key: z.string().min(1, 'key is required'),
  name: z.string().min(1, 'name is required'),
  contentType: z.string().min(1, 'contentType is required'),
})

export type RegisterWorkspaceFileBody = z.input<typeof registerWorkspaceFileBodySchema>

const registeredWorkspaceFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  size: z.number(),
  type: z.string(),
  key: z.string(),
  context: z.string().optional(),
})

const registerWorkspaceFileResponseSchema = z.object({
  success: z.boolean(),
  file: registeredWorkspaceFileSchema.optional(),
  error: z.string().optional(),
  isDuplicate: z.boolean().optional(),
})

export type RegisterWorkspaceFileResponse = z.output<typeof registerWorkspaceFileResponseSchema>

export const registerWorkspaceFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/register',
  params: workspaceFilesParamsSchema,
  body: registerWorkspaceFileBodySchema,
  response: {
    mode: 'json',
    schema: registerWorkspaceFileResponseSchema,
  },
})
