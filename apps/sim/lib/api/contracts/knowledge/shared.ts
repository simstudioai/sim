import { z } from 'zod'

export const wireDateSchema = z.string()
export const nullableWireDateSchema = z.string().nullable()

export const knowledgeBaseParamsSchema = z.object({
  id: z.string().min(1),
})

export const knowledgeDocumentParamsSchema = knowledgeBaseParamsSchema.extend({
  documentId: z.string().min(1),
})

export const knowledgeChunkParamsSchema = knowledgeDocumentParamsSchema.extend({
  chunkId: z.string().min(1),
})

export const knowledgeTagParamsSchema = knowledgeBaseParamsSchema.extend({
  tagId: z.string().min(1),
})

export const knowledgeConnectorParamsSchema = knowledgeBaseParamsSchema.extend({
  connectorId: z.string().min(1),
})

export const documentTagFieldSchema = z.string().nullable().optional()
export const documentNumberFieldSchema = z.number().nullable().optional()
export const documentBooleanFieldSchema = z.boolean().nullable().optional()
export const documentDateFieldSchema = nullableWireDateSchema.optional()

export const paginationSchema = z
  .object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  })
  .passthrough()

export const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })
