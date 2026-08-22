import { z } from 'zod'

const knowledgeDocumentUploadTagSchema = z
  .string()
  .max(1000, 'Knowledge document tag values cannot exceed 1000 characters')
  .optional()

/** Persisted metadata stored with a resumable Knowledge document upload session. */
export const knowledgeDocumentUploadMetadataSchema = z
  .object({
    tag1: knowledgeDocumentUploadTagSchema,
    tag2: knowledgeDocumentUploadTagSchema,
    tag3: knowledgeDocumentUploadTagSchema,
    tag4: knowledgeDocumentUploadTagSchema,
    tag5: knowledgeDocumentUploadTagSchema,
    tag6: knowledgeDocumentUploadTagSchema,
    tag7: knowledgeDocumentUploadTagSchema,
    processingOptions: z
      .object({
        recipe: z.string().max(255, 'recipe cannot exceed 255 characters').optional(),
        lang: z.string().max(35, 'lang cannot exceed 35 characters').optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type KnowledgeDocumentUploadMetadata = z.output<typeof knowledgeDocumentUploadMetadataSchema>
