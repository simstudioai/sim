import type { EmbeddingProvider } from '@/lib/api/contracts/tools/embeddings'
import { BYOK_PROVIDER_IDS, DEFAULT_MODEL_BY_PROVIDER } from '@/lib/embeddings/catalog'
import type { EmbeddingCatalogProvider } from '@/lib/embeddings/types'
import { getEmbeddingModelPricing } from '@/providers/models'
import type { EmbeddingsParams, EmbeddingsResponse } from '@/tools/embeddings/types'
import type { ToolConfig } from '@/tools/types'

/** Throttle applied only when a caller draws on Sim's hosted key pool. */
const HOSTED_KEY_RATE_LIMIT = {
  mode: 'per_request',
  requestsPerMinute: 100,
  burstMultiplier: 1,
} as const

interface EmbeddingToolBaseOptions {
  id: string
  name: string
  description: string
}

interface HostedEmbeddingToolOptions extends EmbeddingToolBaseOptions {
  provider: EmbeddingCatalogProvider
  envKeyPrefix: string
  defaultModel?: never
}

interface ExplicitKeyEmbeddingToolOptions extends EmbeddingToolBaseOptions {
  provider: Extract<EmbeddingProvider, 'openrouter'>
  envKeyPrefix?: never
  defaultModel: string
}

type CreateEmbeddingToolOptions = HostedEmbeddingToolOptions | ExplicitKeyEmbeddingToolOptions

/**
 * Builds a provider-specific embeddings tool. Every provider shares the same
 * params, transport, and output shape; only key resolution and the default
 * model differ, so they are produced from one definition rather than copied.
 */
export function createEmbeddingTool(
  options: CreateEmbeddingToolOptions
): ToolConfig<EmbeddingsParams, EmbeddingsResponse> {
  const { id, name, provider, description } = options
  const defaultModel =
    provider === 'openrouter' ? options.defaultModel : DEFAULT_MODEL_BY_PROVIDER[provider]
  /**
   * Sim-hosted catalog providers are billed per input token with no markup.
   * OpenRouter requires an explicit user key and therefore has no hosting config.
   */
  const hostingConfig: ToolConfig<EmbeddingsParams, EmbeddingsResponse>['hosting'] =
    provider === 'openrouter'
      ? undefined
      : {
          envKeyPrefix: options.envKeyPrefix,
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
        }

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
        description: 'API key for the selected embedding provider',
      },
    },

    hosting: hostingConfig,

    request: {
      url: '/api/tools/embeddings',
      method: 'POST',
      /**
       * `input` is the only param that leaves as model-visible content, so a
       * secret interpolated into it is rewritten back to its placeholder before
       * the request is built. Declaring this moves the tool from never
       * projecting to projecting-or-failing-closed; it is inert on runs that
       * resolved no secrets, since the trace registry is absent there.
       */
      modelInput: {
        mode: 'project' as const,
        select: (params: EmbeddingsParams) => ({ input: params.input }),
      },
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params: EmbeddingsParams) => ({
        provider,
        apiKey: params.apiKey,
        model: params.model || defaultModel,
        input: params.input,
        taskType: params.taskType,
        dimensions: params.dimensions,
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
