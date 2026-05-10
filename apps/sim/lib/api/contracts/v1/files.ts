import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const v1FileParamsSchema = z.object({
  fileId: z.string({ error: 'File ID is required' }).min(1, 'File ID is required'),
})

export const v1WorkspaceIdQuerySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId query parameter is required'),
})

export const v1UploadFileFormFieldsSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId form field is required'),
})

export type V1FileParams = z.output<typeof v1FileParamsSchema>
export type V1WorkspaceIdQuery = z.output<typeof v1WorkspaceIdQuerySchema>
export type V1UploadFileFormFields = z.output<typeof v1UploadFileFormFieldsSchema>

const v1FilesResponseSchema = z
  .object({
    success: z.boolean().optional(),
    data: z.unknown().optional(),
  })
  .passthrough()

export const v1ListFilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/files',
  query: v1WorkspaceIdQuerySchema,
  response: {
    mode: 'json',
    schema: v1FilesResponseSchema,
  },
})

export const v1UploadFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/files',
  response: {
    mode: 'json',
    schema: v1FilesResponseSchema,
  },
})

export const v1DownloadFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/files/[fileId]',
  params: v1FileParamsSchema,
  query: v1WorkspaceIdQuerySchema,
  response: {
    mode: 'binary',
  },
})

export const v1DeleteFileContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/files/[fileId]',
  params: v1FileParamsSchema,
  query: v1WorkspaceIdQuerySchema,
  response: {
    mode: 'json',
    schema: v1FilesResponseSchema,
  },
})
