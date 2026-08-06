import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const embeddingProviders = ['openai', 'gemini', 'cohere', 'mistral'] as const

export const embeddingTaskTypes = [
  'document',
  'query',
  'similarity',
  'classification',
  'clustering',
] as const

/** Guards the route against unbounded fan-out into a paid provider. */
export const MAX_EMBEDDING_INPUTS = 1000
export const MAX_EMBEDDING_TOTAL_CHARS = 1_000_000

const MISSING_EMBEDDING_FIELDS_ERROR = 'Missing required fields: provider, apiKey, and input'

export const embeddingsToolBodySchema = z.object({
  provider: z.enum(embeddingProviders, {
    error: `Invalid provider. Must be one of: ${embeddingProviders.join(', ')}`,
  }),
  apiKey: z
    .string({ error: MISSING_EMBEDDING_FIELDS_ERROR })
    .min(1, MISSING_EMBEDDING_FIELDS_ERROR),
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
    { error: MISSING_EMBEDDING_FIELDS_ERROR }
  ),
  taskType: z.enum(embeddingTaskTypes).optional(),
  /** Matryoshka output size. Omitted means the model's native dimensionality. */
  dimensions: z.coerce
    .number()
    .int('dimensions must be an integer')
    .min(1, 'dimensions must be at least 1')
    .max(4096, 'dimensions cannot exceed 4096')
    .optional(),
  workspaceId: z.string().optional(),
  workflowId: z.string().optional(),
  executionId: z.string().optional(),
  userId: z.string().optional(),
  useHostedCostTracking: z.boolean().optional(),
})

export const embeddingsUsageSchema = z.object({
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
