import { z } from 'zod'
import {
  resolvedSecretTraceProvenanceSchema,
  resourceOwnerSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
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
 * Shared by the internal and v1 search contracts. Omitted, the workspace's
 * default applies: `hybrid` where permission-aware knowledge is on, else
 * `vector`. The use case resolves that, so the schema carries no default.
 */
export const knowledgeSearchModeSchema = z
  .enum(KNOWLEDGE_SEARCH_MODES)
  .optional()
  .nullable()
  .transform((val) => val ?? undefined)

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
    /**
     * `hybrid` runs a full-text leg alongside semantic retrieval and fuses the
     * two by reciprocal rank, which recovers exact tokens (error codes, ticket
     * keys, identifiers) that embeddings rank poorly. `vector` is semantic-only
     * retrieval. Omitted, the workspace's default applies. Where that default
     * is `hybrid`, results in either mode also get a source-recency boost.
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

export const internalKnowledgeSearchBodySchema = z.intersection(
  knowledgeSearchBodySchema,
  z.object({
    workflowId: z.string().optional(),
    skipUsageBilling: z.boolean().optional(),
    [RESOLVED_SECRET_PROVENANCE_FIELD]: resolvedSecretTraceProvenanceSchema.optional(),
  })
)

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

/** One document a workspace search matched, with the best chunk of it. */
export const workspaceKnowledgeSearchResultSchema = z.object({
  documentId: z.string(),
  knowledgeBaseId: z.string(),
  knowledgeBaseName: z.string(),
  documentName: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  connectorType: z.string().nullable(),
  sourceModifiedAt: z.string().nullable(),
  /** The person behind the document, from its author-like tag; null when the source names none. */
  author: z.string().nullable(),
  content: z.string(),
  chunkIndex: z.number(),
  similarity: z.number(),
})
export type WorkspaceKnowledgeSearchResult = z.output<typeof workspaceKnowledgeSearchResultSchema>

export const workspaceSearchFiltersSchema = z.object({
  source: z.string().trim().min(1, 'Source cannot be empty').max(100).optional(),
  modifiedAfter: z.string().datetime({ offset: true }).optional(),
  documentIds: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
})
export type WorkspaceSearchFilters = z.output<typeof workspaceSearchFiltersSchema>

export const workspaceKnowledgeSearchBodySchema = resourceOwnerSchema.safeExtend({
  filters: workspaceSearchFiltersSchema.optional(),
  query: z.string().trim().min(1, 'A search query is required').max(2000, 'Query is too long'),
  topK: z.number().int().min(1).max(50).optional().default(20),
})
export type WorkspaceKnowledgeSearchBody = z.input<typeof workspaceKnowledgeSearchBodySchema>

/**
 * The search a signed-in person runs from the composer: what their own
 * account may read across the workspace's knowledge bases, presented as
 * documents to open rather than chunks to feed a model.
 */
export const searchWorkspaceKnowledgeContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/search',
  body: workspaceKnowledgeSearchBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z.object({
        query: z.string(),
        results: z.array(workspaceKnowledgeSearchResultSchema),
      }),
    }),
  },
})
