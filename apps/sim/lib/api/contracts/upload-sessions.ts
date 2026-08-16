import { z } from 'zod'
import {
  folderIdSchema,
  noInputSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2FileSchema } from '@/lib/api/contracts/v2/files'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import {
  v2PartUrlsBodySchema,
  v2PartUrlsDataSchema,
  v2UploadStatusSchema,
  v2UploadTokenHeadersSchema,
  v2UploadTransferSchema,
} from '@/lib/api/contracts/v2/uploads'
import { executionIdSchema } from '@/lib/api/contracts/workflows'
import {
  MAX_WORKSPACE_FILE_SIZE,
  MAX_WORKSPACE_FORMDATA_FILE_SIZE,
} from '@/lib/uploads/shared/types'

const MAX_ASSET_FILE_SIZE = 5 * 1024 * 1024

const internalFileUploadBaseShape = {
  name: z.string().trim().min(1, 'name is required').max(255, 'name is too long'),
  contentType: z
    .string()
    .trim()
    .min(1, 'contentType is required')
    .max(255, 'contentType is too long'),
} as const

export const createInternalFileUploadBodySchema = z.discriminatedUnion('purpose', [
  z
    .object({
      purpose: z.literal('workspace_file'),
      ...internalFileUploadBaseShape,
      size: z.number().int().nonnegative().max(MAX_WORKSPACE_FILE_SIZE),
      workspaceId: workspaceIdSchema,
      folderId: folderIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      purpose: z.literal('profile_picture'),
      ...internalFileUploadBaseShape,
      size: z.number().int().min(1).max(MAX_ASSET_FILE_SIZE),
    })
    .strict(),
  z
    .object({
      purpose: z.literal('workspace_logo'),
      ...internalFileUploadBaseShape,
      size: z.number().int().min(1).max(MAX_ASSET_FILE_SIZE),
      workspaceId: workspaceIdSchema,
    })
    .strict(),
  z
    .object({
      purpose: z.literal('mothership_attachment'),
      ...internalFileUploadBaseShape,
      size: z.number().int().min(1).max(MAX_WORKSPACE_FILE_SIZE),
      workspaceId: workspaceIdSchema,
    })
    .strict(),
  z
    .object({
      purpose: z.literal('execution_attachment'),
      ...internalFileUploadBaseShape,
      size: z.number().int().min(1).max(MAX_WORKSPACE_FORMDATA_FILE_SIZE),
      workspaceId: workspaceIdSchema,
      workflowId: workflowIdSchema,
      executionId: executionIdSchema,
    })
    .strict(),
])
export type CreateInternalFileUploadBody = z.input<typeof createInternalFileUploadBodySchema>

export const internalFileUploadParamsSchema = z.object({
  uploadId: z.string().min(1, 'uploadId is required'),
})

const internalFileUploadSessionBaseShape = {
  id: z.string().min(1),
  status: v2UploadStatusSchema,
  name: z.string(),
  contentType: z.string(),
  expiresAt: z.string().datetime(),
  error: z.string().nullable(),
} as const

export const internalUploadedAssetSchema = z
  .object({
    path: z.string().min(1),
    key: z.string().min(1),
    name: z.string().min(1),
    size: z.number().int().positive(),
    type: z.string().min(1),
  })
  .strict()

export const internalExecutionAttachmentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    size: z.number().int().positive(),
    type: z.string().min(1),
    url: z.string().min(1),
    key: z.string().min(1),
    context: z.literal('execution'),
  })
  .strict()

export const internalFileUploadSessionSchema = z.discriminatedUnion('purpose', [
  z
    .object({
      ...internalFileUploadSessionBaseShape,
      purpose: z.literal('workspace_file'),
      size: z.number().int().nonnegative(),
      result: v2FileSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...internalFileUploadSessionBaseShape,
      purpose: z.literal('profile_picture'),
      size: z.number().int().positive(),
      result: internalUploadedAssetSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...internalFileUploadSessionBaseShape,
      purpose: z.literal('workspace_logo'),
      size: z.number().int().positive(),
      result: internalUploadedAssetSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...internalFileUploadSessionBaseShape,
      purpose: z.literal('mothership_attachment'),
      size: z.number().int().positive(),
      result: internalUploadedAssetSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...internalFileUploadSessionBaseShape,
      purpose: z.literal('execution_attachment'),
      size: z.number().int().positive(),
      result: internalExecutionAttachmentSchema.nullable(),
    })
    .strict(),
])
export type InternalFileUploadSession = z.output<typeof internalFileUploadSessionSchema>

export const createInternalFileUploadDataSchema = z
  .object({
    session: internalFileUploadSessionSchema,
    uploadToken: z.string().min(1),
    transfer: v2UploadTransferSchema,
  })
  .strict()
export type CreateInternalFileUploadData = z.output<typeof createInternalFileUploadDataSchema>

export const createInternalFileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/uploads',
  body: createInternalFileUploadBodySchema,
  response: { mode: 'json', schema: v2DataResponse(createInternalFileUploadDataSchema) },
})

export const abortInternalFileUploadContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/files/uploads/[uploadId]',
  params: internalFileUploadParamsSchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(internalFileUploadSessionSchema) },
})

export const createInternalFileUploadPartUrlsContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/uploads/[uploadId]/parts',
  params: internalFileUploadParamsSchema,
  headers: v2UploadTokenHeadersSchema,
  body: v2PartUrlsBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2PartUrlsDataSchema) },
})

export const completeInternalFileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/uploads/[uploadId]/complete',
  params: internalFileUploadParamsSchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(internalFileUploadSessionSchema) },
})

export const localUploadPartParamsSchema = z.object({
  uploadId: z.string().min(1, 'uploadId is required'),
  partNumber: z.coerce.number().int().min(1),
})

export const localUploadPartQuerySchema = z
  .object({
    token: z.string().min(1, 'token is required'),
  })
  .strict()

export const localUploadPartContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/uploads/[uploadId]/parts/[partNumber]',
  params: localUploadPartParamsSchema,
  query: localUploadPartQuerySchema,
  response: { mode: 'empty', status: 204 },
})

export const localPutUploadContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/uploads/[uploadId]',
  query: noInputSchema,
  params: internalFileUploadParamsSchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'empty', status: 204 },
})
