import { z } from 'zod'
import { resolvedSecretTraceProvenanceSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2FolderPathInputSchema } from '@/lib/api/contracts/v2/shared'
import { RESOLVED_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { DEFAULT_RERANKER_MODEL, rerankerModelSchema } from '@/lib/knowledge/reranker-models'

export const knowledgeSearchTagFilterSchema = z.object({
  tagName: z.string(),
  tagSlot: z.string().optional(),
  fieldType: z.enum(['text', 'number', 'date', 'boolean']).optional(),
  operator: z.string().default('eq'),
  value: z.union([z.string(), z.number(), z.boolean()]),
  valueTo: z.union([z.string(), z.number()]).optional(),
})

export const KNOWLEDGE_SEARCH_MODES = ['vector', 'hybrid'] as const

/**
 * Shared by the internal and v1 search contracts. Defaults to `vector` so every
 * existing caller keeps its current ranking; hybrid is opt-in.
 */
export const knowledgeSearchModeSchema = z
  .enum(KNOWLEDGE_SEARCH_MODES)
  .optional()
  .nullable()
  .default('vector')
  .transform((val) => val ?? 'vector')

export const knowledgeSearchBodySchema = z
  .object({
    /**
     * Optional because the internal body may name a folder instead, which
     * expands to the knowledge bases inside it when the workflow runs. The
     * internal schema refines that at least one of the two is present; no
     * public contract consumes this schema.
     */
    knowledgeBaseIds: z
      .union([
        z.string().min(1, 'Knowledge base ID is required'),
        z.array(z.string().min(1)).min(1, 'At least one knowledge base ID is required'),
      ])
      .optional(),
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
    /**
     * `vector` (default) is semantic-only retrieval. `hybrid` additionally runs a
     * full-text leg and fuses the two by reciprocal rank, which recovers exact
     * tokens (error codes, ticket keys, identifiers) that embeddings rank poorly.
     */
    searchMode: knowledgeSearchModeSchema,
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

/**
 * Folder scope is internal-only on purpose.
 *
 * A folder stands for the knowledge bases inside it, resolved when the workflow
 * runs rather than when the block is configured — so a knowledge base added to
 * the folder tomorrow is searched tomorrow. Keeping it off the v1 and v2 bodies
 * means no permanent public API commitment while the shape proves itself.
 */
export const internalKnowledgeSearchBodySchema = z
  .intersection(
    knowledgeSearchBodySchema,
    z.object({
      workflowId: z.string().optional(),
      skipUsageBilling: z.boolean().optional(),
      folderPath: v2FolderPathInputSchema.optional(),
      /**
       * Off by default: a folder means its own knowledge bases unless the
       * caller asks for the subtree. The opposite of the File block, where a
       * read scope descends unless told otherwise.
       */
      folderIncludeSubfolders: z.boolean().optional(),
      [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
    })
  )
  .refine((body) => body.knowledgeBaseIds !== undefined || body.folderPath !== undefined, {
    message: 'Provide either knowledgeBaseIds or folderPath to choose what to search',
  })

export const internalKnowledgeSearchResultSchema = z.object({
  documentId: z.string(),
  documentName: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  content: z.string(),
  chunkIndex: z.number(),
  metadata: z.record(z.string(), z.unknown()),
  similarity: z.number(),
  rerankerScore: z.number().optional(),
})

export const internalKnowledgeSearchContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/search',
  body: internalKnowledgeSearchBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z.object({
        results: z.array(internalKnowledgeSearchResultSchema),
        query: z.string(),
        knowledgeBaseIds: z.array(z.string()),
        knowledgeBaseId: z.string(),
        topK: z.number(),
        totalResults: z.number(),
        cost: z
          .object({
            input: z.number(),
            output: z.number(),
            total: z.number(),
            tokens: z.object({
              prompt: z.number(),
              completion: z.number(),
              total: z.number(),
            }),
            model: z.string(),
            pricing: z.object({
              input: z.number(),
              output: z.number(),
              updatedAt: z.string().optional(),
            }),
            rerankerCost: z.number().optional(),
            rerankerModel: z.string().optional(),
            rerankerSearchUnits: z.number().optional(),
          })
          .optional(),
      }),
    }),
  },
})
