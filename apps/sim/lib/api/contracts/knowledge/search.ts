import { z } from 'zod'
import { DEFAULT_RERANKER_MODEL, rerankerModelSchema } from '@/lib/knowledge/reranker-models'

export const knowledgeSearchTagFilterSchema = z.object({
  tagName: z.string(),
  tagSlot: z.string().optional(),
  fieldType: z.enum(['text', 'number', 'date', 'boolean']).optional(),
  operator: z.string().default('eq'),
  value: z.union([z.string(), z.number(), z.boolean()]),
  valueTo: z.union([z.string(), z.number()]).optional(),
})

export const knowledgeSearchBodySchema = z
  .object({
    knowledgeBaseIds: z.union([
      z.string().min(1, 'Knowledge base ID is required'),
      z.array(z.string().min(1)).min(1, 'At least one knowledge base ID is required'),
    ]),
    query: z
      .string()
      .optional()
      .nullable()
      .transform((val) => val || undefined),
    topK: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .nullable()
      .default(10)
      .transform((val) => val ?? 10),
    tagFilters: z
      .array(knowledgeSearchTagFilterSchema)
      .optional()
      .nullable()
      .transform((val) => val || undefined),
    rerankerEnabled: z.boolean().optional().default(false),
    rerankerModel: rerankerModelSchema.optional().default(DEFAULT_RERANKER_MODEL),
    /**
     * Number of vector results sent to Cohere as the documents array for reranking. Capped at 100
     * so each rerank call stays within a single Cohere search unit (1 query × ≤100 docs); see
     * `RERANK_MODEL_PRICING` in `providers/models.ts`.
     */
    rerankerInputCount: z
      .number()
      .int('rerankerInputCount must be an integer')
      .min(1, 'rerankerInputCount must be at least 1')
      .max(100, 'rerankerInputCount cannot exceed 100')
      .optional()
      .nullable()
      .transform((val) => val ?? undefined),
    rerankerApiKey: z
      .string()
      .optional()
      .nullable()
      .transform((val) => val || undefined),
  })
  .refine(
    (data) => {
      const hasQuery = data.query && data.query.trim().length > 0
      const hasTagFilters = data.tagFilters && data.tagFilters.length > 0
      return hasQuery || hasTagFilters
    },
    {
      message: 'Please provide either a search query or tag filters to search your knowledge base',
    }
  )
export type KnowledgeSearchBody = z.output<typeof knowledgeSearchBodySchema>
