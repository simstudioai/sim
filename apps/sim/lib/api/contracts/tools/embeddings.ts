import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import type { EmbeddingCatalogProvider, EmbeddingTaskType } from '@/lib/embeddings/types'

/**
 * `satisfies` ties the wire enums to the catalog's own unions: renaming or
 * removing a catalog member breaks the build here. It does NOT catch an
 * addition — a new catalog provider or task type stays absent from the wire
 * enum until it is added below.
 */
type EmbeddingToolProvider = EmbeddingCatalogProvider | 'openrouter'

export const embeddingProviders = [
  'openai',
  'openrouter',
  'gemini',
  'cohere',
  'mistral',
] as const satisfies readonly EmbeddingToolProvider[]

export const embeddingTaskTypes = [
  'document',
  'query',
  'similarity',
  'classification',
  'clustering',
] as const satisfies readonly EmbeddingTaskType[]

/** Guards the route against unbounded fan-out into a paid provider. */
export const MAX_EMBEDDING_INPUTS = 1000
/** Caps total payload size independently of the input count. */
export const MAX_EMBEDDING_TOTAL_CHARS = 1_000_000

const MISSING_EMBEDDING_INPUT_ERROR = 'Missing required field: input'
const embeddingCatalogProviders = [
  'openai',
  'gemini',
  'cohere',
  'mistral',
] as const satisfies readonly EmbeddingCatalogProvider[]

const embeddingToolCommonShape = {
  model: z.string().min(1, 'model cannot be empty').optional(),
  /** A single text, or an array of texts embedded in one call. */
  input: z.union(
    [
      z.string().min(1, 'input cannot be empty'),
      z
        .array(z.string().min(1, 'input entries cannot be empty'))
        .min(1, 'input must contain at least one text')
        .max(MAX_EMBEDDING_INPUTS, `input cannot exceed ${MAX_EMBEDDING_INPUTS} texts`),
    ],
    { error: MISSING_EMBEDDING_INPUT_ERROR }
  ),
  taskType: z.enum(embeddingTaskTypes).optional(),
  /** Matryoshka output size. Omitted means the model's native dimensionality. */
  dimensions: z.coerce
    .number()
    .int('dimensions must be an integer')
    .min(1, 'dimensions must be at least 1')
    .max(4096, 'dimensions cannot exceed 4096')
    .optional(),
}

export const embeddingsToolBodySchema = z.discriminatedUnion('provider', [
  z.object({
    ...embeddingToolCommonShape,
    provider: z.enum(embeddingCatalogProviders),
    apiKey: z.string({ error: 'apiKey is required' }).min(1, 'apiKey cannot be empty'),
  }),
  z.object({
    ...embeddingToolCommonShape,
    provider: z.literal('openrouter'),
    apiKey: z.string({ error: 'apiKey is required' }).min(1, 'apiKey cannot be empty'),
  }),
])

const embeddingsUsageSchema = z.object({
  prompt_tokens: z.number(),
  total_tokens: z.number(),
})

export const embeddingsToolResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    embeddings: z.array(z.array(z.number())),
    model: z.string(),
    provider: z.enum(embeddingProviders),
    dimensions: z.number(),
    usage: embeddingsUsageSchema,
    /** Token count echoed back so the tool's hosted-key pricing hook can bill it. */
    __embeddingTokens: z.number(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
])

export type EmbeddingsToolBody = z.input<typeof embeddingsToolBodySchema>
export type EmbeddingsToolResponse = z.output<typeof embeddingsToolResponseSchema>
export type EmbeddingProvider = (typeof embeddingProviders)[number]
export type EmbeddingTaskTypeName = (typeof embeddingTaskTypes)[number]

export const embeddingsToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/embeddings',
  body: embeddingsToolBodySchema,
  response: { mode: 'json', schema: embeddingsToolResponseSchema },
})
