import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CreateKnowledgeDocumentUploadBodySchema,
  v2CreateKnowledgeDocumentUploadDataSchema,
  v2KnowledgeDocumentUploadParamsSchema,
  v2KnowledgeDocumentUploadSchema,
  v2UploadKnowledgeDocumentQuerySchema,
} from '@/lib/api/contracts/v2/knowledge'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import {
  v2PartUrlsBodySchema,
  v2PartUrlsDataSchema,
  v2UploadTokenHeadersSchema,
} from '@/lib/api/contracts/v2/uploads'

export const createKnowledgeDocumentUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents/uploads',
  params: v2KnowledgeDocumentUploadParamsSchema.omit({ uploadId: true }),
  body: v2CreateKnowledgeDocumentUploadBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CreateKnowledgeDocumentUploadDataSchema),
  },
})

export const abortKnowledgeDocumentUploadContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/documents/uploads/[uploadId]',
  params: v2KnowledgeDocumentUploadParamsSchema,
  query: v2UploadKnowledgeDocumentQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeDocumentUploadSchema) },
})

export const createKnowledgeDocumentUploadPartUrlsContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents/uploads/[uploadId]/parts',
  params: v2KnowledgeDocumentUploadParamsSchema,
  query: v2UploadKnowledgeDocumentQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  body: v2PartUrlsBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2PartUrlsDataSchema) },
})

export const completeKnowledgeDocumentUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents/uploads/[uploadId]/complete',
  params: v2KnowledgeDocumentUploadParamsSchema,
  query: v2UploadKnowledgeDocumentQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeDocumentUploadSchema) },
})
