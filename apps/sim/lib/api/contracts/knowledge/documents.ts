import { z } from 'zod'
import {
  documentBooleanFieldSchema,
  documentDateFieldSchema,
  documentNumberFieldSchema,
  documentTagFieldSchema,
  knowledgeBaseParamsSchema,
  knowledgeDocumentParamsSchema,
  nullableWireDateSchema,
  paginationSchema,
  successResponseSchema,
  wireDateSchema,
} from '@/lib/api/contracts/knowledge/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const documentTagFilterSchema = z.object({
  tagSlot: z.string().min(1),
  fieldType: z.enum(['text', 'number', 'date', 'boolean']),
  operator: z.string().min(1),
  value: z.unknown(),
  valueTo: z.unknown().optional(),
})
export type DocumentTagFilter = z.output<typeof documentTagFilterSchema>

export const listKnowledgeDocumentsQuerySchema = z.object({
  enabledFilter: z.enum(['all', 'enabled', 'disabled']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sortBy: z
    .enum([
      'filename',
      'fileSize',
      'tokenCount',
      'chunkCount',
      'uploadedAt',
      'processingStatus',
      'enabled',
    ])
    .optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  tagFilters: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined
      try {
        return z.array(documentTagFilterSchema).parse(JSON.parse(value))
      } catch {
        ctx.addIssue({ code: 'custom', message: 'tagFilters must be a valid JSON array' })
        return z.NEVER
      }
    }),
})

export const createDocumentBodySchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  fileUrl: z.string().url('File URL must be valid'),
  fileSize: z.number().min(1, 'File size must be greater than 0'),
  mimeType: z.string().min(1, 'MIME type is required'),
  tag1: z.string().optional(),
  tag2: z.string().optional(),
  tag3: z.string().optional(),
  tag4: z.string().optional(),
  tag5: z.string().optional(),
  tag6: z.string().optional(),
  tag7: z.string().optional(),
  documentTagsData: z.string().optional(),
})

export const bulkCreateDocumentsBodySchema = z.object({
  documents: z.array(createDocumentBodySchema),
  processingOptions: z
    .object({
      recipe: z.string().optional(),
      lang: z.string().optional(),
    })
    .optional(),
  bulk: z.literal(true),
  workflowId: z.string().optional(),
})

const singleCreateDocumentBodySchema = createDocumentBodySchema.extend({
  bulk: z.literal(false),
  workflowId: z.string().optional(),
})

const createKnowledgeDocumentsBodyDiscriminatedUnion = z.discriminatedUnion('bulk', [
  bulkCreateDocumentsBodySchema,
  singleCreateDocumentBodySchema,
])

export const createKnowledgeDocumentsBodySchema = z
  .object({ bulk: z.boolean().default(false) })
  .passthrough()
  .pipe(createKnowledgeDocumentsBodyDiscriminatedUnion)
export type CreateKnowledgeDocumentsBody = z.input<typeof createKnowledgeDocumentsBodySchema>
export type BulkCreateDocumentsBody = z.input<typeof bulkCreateDocumentsBodySchema>
export type SingleCreateDocumentBody = z.input<typeof singleCreateDocumentBodySchema>

export const upsertDocumentBodySchema = z.object({
  documentId: z.string().optional(),
  filename: z.string().min(1, 'Filename is required'),
  fileUrl: z.string().min(1, 'File URL is required'),
  fileSize: z.number().min(1, 'File size must be greater than 0'),
  mimeType: z.string().min(1, 'MIME type is required'),
  documentTagsData: z.string().optional(),
  processingOptions: z
    .object({
      recipe: z.string().optional(),
      lang: z.string().optional(),
    })
    .optional(),
  workflowId: z.string().optional(),
})
export type UpsertDocumentBody = z.output<typeof upsertDocumentBodySchema>

export const bulkCreateDocumentsResponseSchema = z.object({
  total: z.number(),
  documentsCreated: z.array(
    z.object({
      documentId: z.string(),
      filename: z.string(),
      status: z.string(),
    })
  ),
  processingMethod: z.string(),
  processingConfig: z
    .object({
      maxConcurrentDocuments: z.number(),
      batchSize: z.number(),
      totalBatches: z.number(),
    })
    .passthrough(),
})

export const updateDocumentBodySchema = z.object({
  filename: z.string().min(1, 'Filename is required').optional(),
  enabled: z.boolean().optional(),
  chunkCount: z.number().min(0).optional(),
  tokenCount: z.number().min(0).optional(),
  characterCount: z.number().min(0).optional(),
  processingStatus: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  processingError: z.string().optional(),
  markFailedDueToTimeout: z.boolean().optional(),
  retryProcessing: z.boolean().optional(),
  tag1: z.string().optional(),
  tag2: z.string().optional(),
  tag3: z.string().optional(),
  tag4: z.string().optional(),
  tag5: z.string().optional(),
  tag6: z.string().optional(),
  tag7: z.string().optional(),
  number1: z.string().optional(),
  number2: z.string().optional(),
  number3: z.string().optional(),
  number4: z.string().optional(),
  number5: z.string().optional(),
  date1: z.string().optional(),
  date2: z.string().optional(),
  boolean1: z.string().optional(),
  boolean2: z.string().optional(),
  boolean3: z.string().optional(),
})

export const updateDocumentTagsBodySchema = z.record(z.string(), z.string())

export const bulkDocumentOperationBodySchema = z
  .object({
    operation: z.enum(['enable', 'disable', 'delete']),
    documentIds: z.array(z.string()).min(1).max(100).optional(),
    selectAll: z.boolean().optional(),
    enabledFilter: z.enum(['all', 'enabled', 'disabled']).optional(),
  })
  .refine((data) => data.selectAll || (data.documentIds && data.documentIds.length > 0), {
    message: 'Either selectAll must be true or documentIds must be provided',
  })

export const bulkDocumentOperationDataSchema = z.object({
  operation: z.string().optional(),
  successCount: z.number(),
  failedCount: z.number().optional(),
  updatedDocuments: z
    .array(z.object({ id: z.string(), enabled: z.boolean().optional() }))
    .optional(),
})
export type BulkDocumentOperationData = z.output<typeof bulkDocumentOperationDataSchema>

export const documentDataSchema = z
  .object({
    id: z.string(),
    knowledgeBaseId: z.string(),
    filename: z.string(),
    fileUrl: z.string(),
    fileSize: z.number(),
    mimeType: z.string(),
    chunkCount: z.number(),
    tokenCount: z.number(),
    characterCount: z.number(),
    processingStatus: z.enum(['pending', 'processing', 'completed', 'failed']),
    processingStartedAt: nullableWireDateSchema.optional(),
    processingCompletedAt: nullableWireDateSchema.optional(),
    processingError: z.string().nullable().optional(),
    enabled: z.boolean(),
    uploadedAt: wireDateSchema,
    tag1: documentTagFieldSchema,
    tag2: documentTagFieldSchema,
    tag3: documentTagFieldSchema,
    tag4: documentTagFieldSchema,
    tag5: documentTagFieldSchema,
    tag6: documentTagFieldSchema,
    tag7: documentTagFieldSchema,
    number1: documentNumberFieldSchema,
    number2: documentNumberFieldSchema,
    number3: documentNumberFieldSchema,
    number4: documentNumberFieldSchema,
    number5: documentNumberFieldSchema,
    date1: documentDateFieldSchema,
    date2: documentDateFieldSchema,
    boolean1: documentBooleanFieldSchema,
    boolean2: documentBooleanFieldSchema,
    boolean3: documentBooleanFieldSchema,
    connectorId: z.string().nullable().optional(),
    connectorType: z.string().nullable().optional(),
    sourceUrl: z.string().nullable().optional(),
  })
  .passthrough()
export type DocumentData = z.output<typeof documentDataSchema>

export const documentsPaginationSchema = paginationSchema
export type DocumentsPagination = z.output<typeof documentsPaginationSchema>

export const knowledgeDocumentsDataSchema = z.object({
  documents: z.array(documentDataSchema),
  pagination: documentsPaginationSchema,
})
export type KnowledgeDocumentsResponse = z.output<typeof knowledgeDocumentsDataSchema>

export const getKnowledgeDocumentContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(documentDataSchema),
  },
})

export const listKnowledgeDocumentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/documents',
  params: knowledgeBaseParamsSchema,
  query: listKnowledgeDocumentsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(knowledgeDocumentsDataSchema),
  },
})

export const createKnowledgeDocumentsContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents',
  params: knowledgeBaseParamsSchema,
  body: createKnowledgeDocumentsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.union([bulkCreateDocumentsResponseSchema, documentDataSchema])),
  },
})

export const updateKnowledgeDocumentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  body: updateDocumentBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(documentDataSchema),
  },
})

export const updateKnowledgeDocumentTagsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  body: updateDocumentTagsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(documentDataSchema),
  },
})

export const deleteKnowledgeDocumentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.unknown()),
  },
})

export const bulkKnowledgeDocumentsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/knowledge/[id]/documents',
  params: knowledgeBaseParamsSchema,
  body: bulkDocumentOperationBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(bulkDocumentOperationDataSchema),
  },
})

export const upsertKnowledgeDocumentContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents/upsert',
  params: knowledgeBaseParamsSchema,
  body: upsertDocumentBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(documentDataSchema),
  },
})
