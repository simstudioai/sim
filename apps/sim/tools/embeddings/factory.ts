import type { EmbeddingProvider } from '@/lib/api/contracts/tools/embeddings'
import { getEmbeddingModelPricing } from '@/providers/models'
import type { EmbeddingsParams, EmbeddingsResponse } from '@/tools/embeddings/types'
import type { BYOKProviderId, ToolConfig } from '@/tools/types'

/**
 * BYOK provider ids differ from embedding provider ids for Gemini, whose
 * workspace keys are stored under the shared Google entry.
 */
const BYOK_PROVIDER_IDS: Record<EmbeddingProvider, BYOKProviderId> = {
  openai: 'openai',
  gemini: 'google',
  cohere: 'cohere',
  mistral: 'mistral',
}

/**
 * Embeddings are billed per input token with no markup, matching how the
 * knowledge-base path bills the same models.
 */
const HOSTED_KEY_RATE_LIMIT = {
  mode: 'per_request',
  requestsPerMinute: 100,
  burstMultiplier: 1,
} as const

interface CreateEmbeddingToolOptions {
  id: string
  name: string
  provider: EmbeddingProvider
  description: string
  /** Env var prefix for the hosted key pool. */
  envKeyPrefix: string
  /** Default model when the caller does not pick one. */
  defaultModel: string
}

/**
 * Builds a provider-specific embeddings tool. Every provider shares the same
 * params, transport, and output shape; only key resolution and the default
 * model differ, so they are produced from one definition rather than copied.
 */
export function createEmbeddingTool({
  id,
  name,
  provider,
  description,
  envKeyPrefix,
  defaultModel,
}: CreateEmbeddingToolOptions): ToolConfig<EmbeddingsParams, EmbeddingsResponse> {
  return {
    id,
    name,
    description,
    version: '1.0.0',

    params: {
      input: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Text to embed, or an array of texts to embed in one call',
      },
      model: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Embedding model to use',
        default: defaultModel,
      },
      taskType: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'What the embedding is for, when the model supports task conditioning: document, query, similarity, classification, or clustering',
      },
      dimensions: {
        type: 'number',
        required: false,
        visibility: 'user-only',
        description: 'Output dimensions, when the model supports truncation. Defaults to native.',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: `${name} API key`,
      },
    },

    hosting: {
      envKeyPrefix,
      apiKeyParam: 'apiKey',
      byokProviderId: BYOK_PROVIDER_IDS[provider],
      pricing: {
        type: 'custom',
        getCost: (_params, output) => {
          const tokens = output.__embeddingTokens
          if (typeof tokens !== 'number' || Number.isNaN(tokens)) {
            throw new Error('Embedding response missing token usage')
          }
          const model = typeof output.model === 'string' ? output.model : defaultModel
          const pricing = getEmbeddingModelPricing(model)
          if (!pricing) {
            throw new Error(`No pricing configured for embedding model: ${model}`)
          }
          return {
            cost: (tokens * pricing.input) / 1_000_000,
            metadata: { model, totalTokens: tokens, inputPricePerMillion: pricing.input },
          }
        },
      },
      rateLimit: HOSTED_KEY_RATE_LIMIT,
    },

    request: {
      url: '/api/tools/embeddings',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (
        params: EmbeddingsParams & {
          _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
          __usingHostedKey?: boolean
        }
      ) => ({
        provider,
        apiKey: params.apiKey,
        model: params.model || defaultModel,
        input: params.input,
        taskType: params.taskType,
        dimensions: params.dimensions,
        workspaceId: params._context?.workspaceId,
        workflowId: params._context?.workflowId,
        executionId: params._context?.executionId,
        useHostedCostTracking: params.__usingHostedKey === true,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = (await response.json()) as {
        success?: boolean
        error?: string
        embeddings?: number[][]
        model?: string
        provider?: string
        dimensions?: number
        usage?: { prompt_tokens: number; total_tokens: number }
        __embeddingTokens?: number
      }

      if (!response.ok || data.success === false || data.error) {
        return {
          success: false,
          error: data.error || 'Embedding generation failed',
          output: {
            embeddings: [],
            model: data.model || '',
            provider: data.provider || provider,
            dimensions: 0,
            usage: { prompt_tokens: 0, total_tokens: 0 },
          },
        }
      }

      return {
        success: true,
        output: {
          embeddings: data.embeddings || [],
          model: data.model || '',
          provider: data.provider || provider,
          dimensions: data.dimensions ?? 0,
          usage: data.usage || { prompt_tokens: 0, total_tokens: 0 },
          __embeddingTokens: data.__embeddingTokens,
        },
      }
    },

    outputs: {
      embeddings: {
        type: 'json',
        description: 'Generated embedding vectors, one per input, in input order',
      },
      model: { type: 'string', description: 'Model used' },
      provider: { type: 'string', description: 'Provider used' },
      dimensions: { type: 'number', description: 'Dimensionality of each returned vector' },
      usage: {
        type: 'json',
        description: 'Token usage',
        properties: {
          prompt_tokens: { type: 'number', description: 'Tokens in the input' },
          total_tokens: { type: 'number', description: 'Total tokens billed' },
        },
      },
    },
  }
}
