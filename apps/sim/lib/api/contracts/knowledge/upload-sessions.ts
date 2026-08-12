import { z } from 'zod'
import { documentDataSchema } from '@/lib/api/contracts/knowledge/documents'
import {
  knowledgeBaseParamsSchema,
  nullableWireDateSchema,
} from '@/lib/api/contracts/knowledge/shared'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { knowledgeDocumentUploadMetadataSchema } from '@/lib/knowledge/upload-metadata'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'

const knowledgeDocumentUploadStatusSchema = z.enum([
  'uploading',
  'completing',
  'finalizing',
  'completed',
  'failed',
  'aborting',
  'aborted',
  'expired',
])

const knowledgeDocumentUploadTokenHeadersSchema = z.object({
  'upload-token': z.string().min(1, 'upload-token header is required'),
})

const knowledgeDocumentUploadTransferSchema = z.discriminatedUnion('method', [
  z
    .object({
      method: z.literal('put'),
      url: z.string().url(),
      headers: z.record(z.string(), z.string()),
      expiresAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      method: z.literal('multipart'),
      partSize: z.number().int().positive(),
      partCount: z.number().int().positive().max(640),
    })
    .strict(),
])
export type KnowledgeDocumentUploadTransfer = z.output<typeof knowledgeDocumentUploadTransferSchema>

const knowledgeDocumentUploadPartUrlsBodySchema = z
  .object({
    partNumbers: z.array(z.number().int().min(1)).min(1).max(100),
  })
  .strict()

const knowledgeDocumentUploadPartUrlSchema = z.object({
  partNumber: z.number().int().min(1),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string().datetime(),
})
export type KnowledgeDocumentUploadPartUrl = z.output<typeof knowledgeDocumentUploadPartUrlSchema>

const knowledgeDocumentUploadPartUrlsDataSchema = z.object({
  parts: z.array(knowledgeDocumentUploadPartUrlSchema).max(100),
})

const knowledgeDocumentSummarySchema = documentDataSchema
  .pick({
    id: true,
    knowledgeBaseId: true,
    filename: true,
    fileSize: true,
    mimeType: true,
    processingStatus: true,
    chunkCount: true,
    tokenCount: true,
    characterCount: true,
    enabled: true,
  })
  .extend({ createdAt: nullableWireDateSchema })
export type KnowledgeDocumentUploadSummary = z.output<typeof knowledgeDocumentSummarySchema>

const knowledgeDocumentUploadParamsSchema = knowledgeBaseParamsSchema.extend({
  uploadId: z.string().min(1, 'uploadId is required'),
})

const uploadKnowledgeDocumentQuerySchema = z.object({ workspaceId: workspaceIdSchema })

export const knowledgeDocumentUploadMetadataBodySchema = z
  .object({ ...knowledgeDocumentUploadMetadataSchema.shape })
  .strict()
export type KnowledgeDocumentUploadMetadataBody = z.input<
  typeof knowledgeDocumentUploadMetadataBodySchema
>

const createKnowledgeDocumentUploadBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: z.string().trim().min(1, 'name is required').max(255, 'name is too long'),
    contentType: z.string().trim().min(1, 'contentType is required').max(255),
    size: z.number().int().min(1).max(MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE),
    ...knowledgeDocumentUploadMetadataBodySchema.shape,
  })
  .strict()

const knowledgeDocumentUploadSchema = z.object({
  id: z.string(),
  knowledgeBaseId: z.string(),
  status: knowledgeDocumentUploadStatusSchema,
  name: z.string(),
  contentType: z.string(),
  size: z.number().int().positive(),
  expiresAt: z.string().datetime(),
  error: z.string().nullable(),
  document: knowledgeDocumentSummarySchema.nullable(),
})

const createKnowledgeDocumentUploadDataSchema = z
  .object({
    session: knowledgeDocumentUploadSchema,
    uploadToken: z.string().min(1),
    transfer: knowledgeDocumentUploadTransferSchema,
  })
  .strict()

const dataResponse = <T extends z.ZodType>(schema: T) => z.object({ data: schema })

export const createKnowledgeDocumentUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents/uploads',
  params: knowledgeDocumentUploadParamsSchema.omit({ uploadId: true }),
  body: createKnowledgeDocumentUploadBodySchema,
  response: {
    mode: 'json',
    schema: dataResponse(createKnowledgeDocumentUploadDataSchema),
    status: 201,
  },
})

export const abortKnowledgeDocumentUploadContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/documents/uploads/[uploadId]',
  params: knowledgeDocumentUploadParamsSchema,
  query: uploadKnowledgeDocumentQuerySchema,
  headers: knowledgeDocumentUploadTokenHeadersSchema,
  response: { mode: 'json', schema: dataResponse(knowledgeDocumentUploadSchema) },
})

export const createKnowledgeDocumentUploadPartUrlsContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents/uploads/[uploadId]/parts',
  params: knowledgeDocumentUploadParamsSchema,
  query: uploadKnowledgeDocumentQuerySchema,
  headers: knowledgeDocumentUploadTokenHeadersSchema,
  body: knowledgeDocumentUploadPartUrlsBodySchema,
  response: { mode: 'json', schema: dataResponse(knowledgeDocumentUploadPartUrlsDataSchema) },
})

export const completeKnowledgeDocumentUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents/uploads/[uploadId]/complete',
  params: knowledgeDocumentUploadParamsSchema,
  query: uploadKnowledgeDocumentQuerySchema,
  headers: knowledgeDocumentUploadTokenHeadersSchema,
  response: { mode: 'json', schema: dataResponse(knowledgeDocumentUploadSchema) },
})
