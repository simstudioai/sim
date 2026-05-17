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

/**
 * A `fileUrl` accepted by knowledge document ingestion endpoints.
 *
 * Must be a `data:` URI or an `http(s)://` URL. Local paths, `file://`,
 * and other schemes are rejected at the boundary to prevent the background
 * parser from reading arbitrary files off the Sim server's filesystem.
 */
export const knowledgeDocumentFileUrlSchema = z
  .string()
  .min(1, 'File URL is required')
  .refine(
    (value) => /^data:/i.test(value) || /^https?:\/\//i.test(value),
    'File URL must be a data: URI or an http(s):// URL'
  )

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
