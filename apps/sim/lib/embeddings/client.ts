import { createLogger } from '@sim/logger'
import { env, envNumber } from '@/lib/core/config/env'
import { processWithConcurrency, splitByItemLimit } from '@/lib/embeddings/batching'
import {
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingModelInfo,
  getEmbeddingModelInfo,
  resolveDimensions,
} from '@/lib/embeddings/catalog'
import { resolveProviderKey } from '@/lib/embeddings/keys'
import { getAdapterFactory } from '@/lib/embeddings/providers'
import type {
  EmbeddingProviderAdapter,
  EmbeddingTaskType,
  EmbedOptions,
  EmbedResult,
} from '@/lib/embeddings/types'
import { isRetryableError, retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import { batchByTokenLimit, estimateTokenCount } from '@/lib/tokenization'

const logger = createLogger('EmbeddingClient')

const MAX_TOKENS_PER_REQUEST = 8000
const MAX_CONCURRENT_BATCHES = envNumber(env.KB_CONFIG_CONCURRENCY_LIMIT, 50)
const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000

export class EmbeddingAPIError extends Error {
  public status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'EmbeddingAPIError'
    this.status = status
  }
}

interface ResolvedProvider {
  adapter: EmbeddingProviderAdapter
  info: EmbeddingModelInfo
  /** Model name as sent to the provider (an Azure deployment name when Azure is active). */
  modelName: string
  dimensions: number
  isBYOK: boolean
}

/**
 * Azure OpenAI takes over for OpenAI models when fully configured, but only
 * when the caller has not supplied its own key. A user-pasted OpenAI key must
 * always go to OpenAI.
 */
function resolveAzureOverride(info: EmbeddingModelInfo, model: string) {
  if (info.provider !== 'openai') return null
  const apiKey = env.AZURE_OPENAI_API_KEY
  const endpoint = env.AZURE_OPENAI_ENDPOINT
  const apiVersion = env.AZURE_OPENAI_API_VERSION
  if (!apiKey || !endpoint || !apiVersion) return null
  /**
   * Azure deployment names default to the embedding model name when
   * `KB_OPENAI_MODEL_NAME` is unset — this matches the pre-existing
   * convention where deployments are named after the model they host.
   */
  return { apiKey, endpoint, apiVersion, deployment: env.KB_OPENAI_MODEL_NAME || model }
}

async function resolveProvider(model: string, options: EmbedOptions): Promise<ResolvedProvider> {
  const info = getEmbeddingModelInfo(model)
  const dimensions = resolveDimensions(info, options.dimensions)

  if (!options.apiKey) {
    const azure = resolveAzureOverride(info, model)
    if (azure) {
      return {
        adapter: getAdapterFactory('azure-openai')({
          modelName: azure.deployment,
          apiKey: azure.apiKey,
          nativeDimensions: info.nativeDimensions,
          endpoint: azure.endpoint,
          apiVersion: azure.apiVersion,
        }),
        info,
        modelName: azure.deployment,
        dimensions,
        isBYOK: false,
      }
    }
  }

  const { apiKey, isBYOK } = options.apiKey
    ? { apiKey: options.apiKey, isBYOK: true }
    : await resolveProviderKey(info.provider, options.workspaceId)

  return {
    adapter: getAdapterFactory(info.provider)({
      modelName: model,
      apiKey,
      nativeDimensions: info.nativeDimensions,
    }),
    info,
    modelName: model,
    dimensions,
    isBYOK,
  }
}

async function callEmbeddingAPI(
  inputs: string[],
  provider: ResolvedProvider,
  taskType: EmbeddingTaskType
): Promise<{ embeddings: number[][]; totalTokens: number }> {
  return retryWithExponentialBackoff(
    async () => {
      const request = provider.adapter.buildRequest({
        inputs,
        taskType,
        dimensions: provider.dimensions,
      })

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), EMBEDDING_REQUEST_TIMEOUT_MS)

      const response = await fetch(request.apiUrl, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))

      if (!response.ok) {
        const errorText = await response.text()
        throw new EmbeddingAPIError(
          `Embedding API failed: ${response.status} ${response.statusText} - ${errorText}`,
          response.status
        )
      }

      const json = await response.json()
      const embeddings = request.parse(json)
      const totalTokens =
        request.parseTokens?.(json) ??
        // Providers that omit usage (e.g. Gemini) get an estimate from their tokenizer
        inputs.reduce(
          (sum, text) => sum + estimateTokenCount(text, provider.info.tokenizerProvider).count,
          0
        )

      return { embeddings, totalTokens }
    },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      retryCondition: (error: unknown) => {
        if (error instanceof EmbeddingAPIError) {
          return error.status === 429 || error.status >= 500
        }
        return isRetryableError(error)
      },
    }
  )
}

/**
 * Generates embeddings for a batch of texts with token-aware batching,
 * per-provider item caps, bounded concurrency, and retry on transient failures.
 */
export async function embed(texts: string[], options: EmbedOptions = {}): Promise<EmbedResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL
  const taskType = options.taskType ?? 'document'
  const provider = await resolveProvider(model, options)

  const tokenBatches = batchByTokenLimit(texts, MAX_TOKENS_PER_REQUEST, model)
  const itemLimit = provider.adapter.maxItemsPerRequest ?? provider.info.maxItemsPerRequest
  const batches = itemLimit
    ? tokenBatches.flatMap((batch) => splitByItemLimit(batch, itemLimit))
    : tokenBatches

  const batchResults = await processWithConcurrency(
    batches,
    MAX_CONCURRENT_BATCHES,
    async (batch, i) => {
      try {
        return await callEmbeddingAPI(batch, provider, taskType)
      } catch (error) {
        logger.error(`Failed to generate embeddings for batch ${i + 1}/${batches.length}:`, error)
        throw error
      }
    }
  )

  const embeddings: number[][] = []
  let totalTokens = 0
  for (const batch of batchResults) {
    for (const vector of batch.embeddings) {
      embeddings.push(vector)
    }
    totalTokens += batch.totalTokens
  }

  return {
    embeddings,
    totalTokens,
    isBYOK: provider.isBYOK,
    modelName: provider.modelName,
    pricingId: provider.info.pricingId,
    dimensions: provider.dimensions,
  }
}
