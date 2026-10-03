import { z } from 'zod'
import type { EmbeddingCatalogProvider, EmbeddingTaskType } from '@/lib/embeddings/types'

type EmbeddingToolProvider = EmbeddingCatalogProvider | 'openrouter'

export const embeddingProviders = [
  'openai',
  'openrouter',
  'gemini',
  'cohere',
  'mistral',
  'ollama',
] as const satisfies readonly EmbeddingToolProvider[]

export const embeddingTaskTypes = [
  'document',
  'query',
  'similarity',
  'classification',
  'clustering',
] as const satisfies readonly EmbeddingTaskType[]

export const MAX_EMBEDDING_INPUTS = 1000
export const MAX_EMBEDDING_TOTAL_CHARS = 1_000_000

const commonShape = {
  model: z.string().min(1, 'model cannot be empty').optional(),
  input: z.union(
    [
      z.string().min(1, 'input cannot be empty'),
      z
        .array(z.string().min(1, 'input entries cannot be empty'))
        .min(1, 'input must contain at least one text')
        .max(MAX_EMBEDDING_INPUTS, `input cannot exceed ${MAX_EMBEDDING_INPUTS} texts`),
    ],
    { error: 'Missing required field: input' }
  ),
  taskType: z.enum(embeddingTaskTypes).optional(),
  dimensions: z.preprocess(
    (value) =>
      value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value,
    z.coerce
      .number()
      .int('dimensions must be an integer')
      .min(1, 'dimensions must be at least 1')
      .max(4096, 'dimensions cannot exceed 4096')
      .optional()
  ),
}

const catalogProviders = [
  'openai',
  'gemini',
  'cohere',
  'mistral',
] as const satisfies readonly EmbeddingCatalogProvider[]

export const embeddingsInputSchema = z.discriminatedUnion('provider', [
  z.object({
    ...commonShape,
    provider: z.enum(catalogProviders),
    apiKey: z.string({ error: 'apiKey is required' }).min(1, 'apiKey cannot be empty'),
  }),
  z.object({
    ...commonShape,
    provider: z.literal('openrouter'),
    apiKey: z.string({ error: 'apiKey is required' }).min(1, 'apiKey cannot be empty'),
  }),
  /**
   * Ollama is reached at `OLLAMA_URL` and authenticates with nothing, so this
   * variant carries no `apiKey` at all rather than an optional one — there is no
   * credential a caller could meaningfully supply. `model` is required because
   * the server's catalog is whatever the operator pulled, so there is no default
   * Sim could name.
   */
  z.object({
    ...commonShape,
    provider: z.literal('ollama'),
    model: z.string().min(1, 'model cannot be empty'),
  }),
])

export type EmbeddingsInput = z.output<typeof embeddingsInputSchema>
export type EmbeddingProvider = (typeof embeddingProviders)[number]
export type EmbeddingTaskTypeName = (typeof embeddingTaskTypes)[number]
