import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CreateFileUploadBodySchema,
  v2FileUploadParamsSchema,
  v2FileUploadSchema,
  v2FileUploadWorkspaceQuerySchema,
} from '@/lib/api/contracts/v2/files'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import {
  v2CompleteUploadBodySchema,
  v2PartUrlsBodySchema,
  v2PartUrlsDataSchema,
} from '@/lib/api/contracts/v2/uploads'

export const createWorkspaceFileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/uploads',
  body: v2CreateFileUploadBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FileUploadSchema) },
})

export const getWorkspaceFileUploadContract = defineRouteContract({
  method: 'GET',
  path: '/api/files/uploads/[uploadId]',
  params: v2FileUploadParamsSchema,
  query: v2FileUploadWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FileUploadSchema) },
})

export const abortWorkspaceFileUploadContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/files/uploads/[uploadId]',
  params: v2FileUploadParamsSchema,
  query: v2FileUploadWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FileUploadSchema) },
})

export const createWorkspaceFileUploadPartUrlsContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/uploads/[uploadId]/parts',
  params: v2FileUploadParamsSchema,
  query: v2FileUploadWorkspaceQuerySchema,
  body: v2PartUrlsBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2PartUrlsDataSchema) },
})

export const completeWorkspaceFileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/uploads/[uploadId]/complete',
  params: v2FileUploadParamsSchema,
  query: v2FileUploadWorkspaceQuerySchema,
  body: v2CompleteUploadBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FileUploadSchema) },
})

export const localUploadPartParamsSchema = z.object({
  uploadId: z.string().min(1, 'uploadId is required'),
  partNumber: z.coerce.number().int().min(1),
})

export const localUploadPartQuerySchema = z.object({
  token: z.string().min(1, 'token is required'),
})

export const localUploadPartContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/uploads/[uploadId]/parts/[partNumber]',
  params: localUploadPartParamsSchema,
  query: localUploadPartQuerySchema,
  response: { mode: 'empty', status: 204 },
})
