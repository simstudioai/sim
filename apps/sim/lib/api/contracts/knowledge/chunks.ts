import { z } from 'zod'
import {
  documentBooleanFieldSchema,
  documentDateFieldSchema,
  documentNumberFieldSchema,
  documentTagFieldSchema,
  knowledgeChunkParamsSchema,
  knowledgeDocumentParamsSchema,
  paginationSchema,
  successResponseSchema,
  wireDateSchema,
} from '@/lib/api/contracts/knowledge/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const listKnowledgeChunksQuerySchema = z.object({
  search: z.string().optional(),
  enabled: z.enum(['true', 'false', 'all']).optional().default('all'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
  sortBy: z.enum(['chunkIndex', 'tokenCount', 'enabled']).optional().default('chunkIndex'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
})

export const createChunkBodySchema = z.object({
  content: z.string().min(1, 'Content is required').max(10000, 'Content too long'),
  enabled: z.boolean().optional().default(true),
})

export const updateChunkBodySchema = createChunkBodySchema.partial()

export const bulkChunkOperationBodySchema = z.object({
  operation: z.enum(['enable', 'disable', 'delete']),
  chunkIds: z.array(z.string()).min(1, 'At least one chunk ID is required').max(100),
})

export const bulkChunkOperationDataSchema = z.object({
  operation: z.string(),
  successCount: z.number(),
  errorCount: z.number(),
  processed: z.number(),
  errors: z.array(z.string()),
})
export type BulkChunkOperationData = z.output<typeof bulkChunkOperationDataSchema>

export const chunkDataSchema = z
  .object({
    id: z.string(),
    chunkIndex: z.number(),
    content: z.string(),
    contentLength: z.number(),
    tokenCount: z.number(),
    enabled: z.boolean(),
    startOffset: z.number(),
    endOffset: z.number(),
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
    createdAt: wireDateSchema,
    updatedAt: wireDateSchema,
  })
  .passthrough()
export type ChunkData = z.output<typeof chunkDataSchema>

export const chunksPaginationSchema = paginationSchema
export type ChunksPagination = z.output<typeof chunksPaginationSchema>

export type KnowledgeChunksResponse = {
  chunks: ChunkData[]
  pagination: ChunksPagination
}

export const listKnowledgeChunksContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/documents/[documentId]/chunks',
  params: knowledgeDocumentParamsSchema,
  query: listKnowledgeChunksQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z.array(chunkDataSchema),
      pagination: chunksPaginationSchema,
    }),
  },
})

export const createKnowledgeChunkContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents/[documentId]/chunks',
  params: knowledgeDocumentParamsSchema,
  body: createChunkBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(chunkDataSchema),
  },
})

export const getKnowledgeChunkContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/documents/[documentId]/chunks/[chunkId]',
  params: knowledgeChunkParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(chunkDataSchema),
  },
})

export const updateKnowledgeChunkContract = defineRouteContract({
  method: 'PUT',
  path: '/api/knowledge/[id]/documents/[documentId]/chunks/[chunkId]',
  params: knowledgeChunkParamsSchema,
  body: updateChunkBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(chunkDataSchema),
  },
})

export const deleteKnowledgeChunkContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/documents/[documentId]/chunks/[chunkId]',
  params: knowledgeChunkParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ message: z.string() })),
  },
})

export const bulkKnowledgeChunksContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/knowledge/[id]/documents/[documentId]/chunks',
  params: knowledgeDocumentParamsSchema,
  body: bulkChunkOperationBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(bulkChunkOperationDataSchema),
  },
})
