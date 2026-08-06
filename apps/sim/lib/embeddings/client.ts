import { createLogger } from '@sim/logger'
import { env, envNumber } from '@/lib/core/config/env'
import { processWithConcurrency, splitByItemLimit } from '@/lib/embeddings/batching'
import {
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingModelInfo,
  getEmbeddingModelInfo,
  hasApproximateTokenCount,
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
import { batchByTokenLimit, estimateTokenCount, truncateToTokenLimit } from '@/lib/tokenization'

const logger = createLogger('EmbeddingClient')

const MAX_CONCURRENT_BATCHES = envNumber(env.KB_CONFIG_CONCURRENCY_LIMIT, 50)
const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000

/**
 * Tokens this client aims to put in one request. Not a provider limit — every
 * provider accepts at least this much, and OpenAI documents 300,000 — but the
 * batch size the knowledge-base indexing path has run on in production.
 *
 * Kept here rather than raised to each provider's maximum so a request stays
 * comfortably inside {@link EMBEDDING_REQUEST_TIMEOUT_MS}: a timed-out batch is
 * retried three times, so large batches make a slow provider expensive to fail
 * against. Raising this trades fewer round trips for costlier retries.
 */
const BATCH_TOKEN_TARGET = 8192

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
  /** Dimensionality the request will produce, for reporting and billing. */
  dimensions: number
  /**
   * The caller's explicit reduction, or undefined when none was requested.
   * Kept separate from `dimensions` because a model without Matryoshka support
   * rejects the parameter outright — sending it populated with the native size
   * is a 400, not a no-op.
   */
  requestedDimensions: number | undefined
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
        requestedDimensions: options.dimensions,
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
    requestedDimensions: options.dimensions,
    isBYOK,
  }
}

/** `inputs` are already projected and batched by {@link embed}. */
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
        dimensions: provider.requestedDimensions,
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
export async function embed(texts: string[], options: EmbedOptions): Promise<EmbedResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL
  const taskType = options.taskType ?? 'document'
  const provider = await resolveProvider(model, options)

  /**
   * Projected before batching, not after. The projector rewrites resolved-secret
   * plaintext to placeholders, which changes length, and `batchByTokenLimit`
   * measures and truncates whatever it is handed. Batching the pre-projection
   * text would size against a different string than the one actually sent: a
   * lengthening projection then exceeds the model's ceiling and the provider
   * rejects it, and a shortening one discards content that would have fit.
   *
   * Doing it here also keeps projection to exactly once per call, so no retry
   * can re-project already-projected content.
   */
  const modelInputs = options.projectInputs ? options.projectInputs(texts) : texts

  /**
   * Each input is held to the model's own per-input ceiling, exactly as declared.
   * One shared constant sent oversized input to models with a lower limit and
   * discarded content models with a higher one accept; discounting the ceiling
   * to absorb tokenizer error would reintroduce the second harm.
   *
   * Truncation happens here rather than inside `batchByTokenLimit` so it occurs
   * once, against the right limit, and is always warned about: a shortened
   * embedding input is otherwise indistinguishable from a good one, both to the
   * caller and in the vector it produces.
   */
  const ceiling = provider.info.maxInputTokens
  const boundedInputs = modelInputs.map((text) => {
    if (estimateTokenCount(text, provider.info.tokenizerProvider).count <= ceiling) return text
    logger.warn('Embedding input exceeds the model token limit and will be truncated', {
      model,
      maxInputTokens: ceiling,
      chars: text.length,
      approximateTokenCount: hasApproximateTokenCount(provider.info),
    })
    return truncateToTokenLimit(text, ceiling, model)
  })

  /**
   * How many tokens may share one request — a different limit from the per-input
   * ceiling above, and the one that decides how many inputs go in a batch.
   *
   * Three bounds compose here:
   *
   * 1. {@link BATCH_TOKEN_TARGET} is what we actually aim for. It is an
   *    operational choice, not a provider limit: it keeps a single request well
   *    inside {@link EMBEDDING_REQUEST_TIMEOUT_MS}, so a timeout costs one small
   *    batch and its retries rather than a large one.
   * 2. A provider's documented summed-token cap, when it publishes one, is a
   *    hard ceiling the target can never exceed.
   * 3. The per-input ceiling is a floor. A budget below it would make
   *    `batchByTokenLimit` truncate inputs the provider would have accepted —
   *    Cohere takes 128k tokens in one text, far above the target.
   */
  const requestBudget = Math.max(
    Math.min(provider.info.maxTokensPerRequest ?? BATCH_TOKEN_TARGET, BATCH_TOKEN_TARGET),
    ceiling
  )

  const tokenBatches = batchByTokenLimit(boundedInputs, requestBudget, model)
  const itemLimit = provider.adapter.maxItemsPerRequest
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
