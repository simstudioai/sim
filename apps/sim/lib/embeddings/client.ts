import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { env, envNumber } from '@/lib/core/config/env'
import {
  type FallbackFactories,
  KNOWLEDGE_EMBEDDINGS_CAPABILITY,
  wireFallback,
} from '@/lib/core/config/env-capabilities'
import { isHosted } from '@/lib/core/config/env-flags'
import {
  ProviderQuotaExhaustedError,
  recordProviderCooldown,
  waitForProviderAdmission,
} from '@/lib/core/rate-limiter/provider-admission'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getOllamaUrl } from '@/lib/core/utils/urls'
import {
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingModelInfo,
  getEmbeddingModelInfo,
  hasApproximateTokenCount,
  ollamaEmbeddingModelName,
  resolveDimensions,
} from '@/lib/embeddings/catalog'
import { resolveProviderKey } from '@/lib/embeddings/keys'
import { isOllamaServerConfigured } from '@/lib/embeddings/ollama-model-catalog.server'
import { DEFAULT_OPENROUTER_EMBEDDING_MODEL } from '@/lib/embeddings/openrouter-models'
import { getAdapterFactory } from '@/lib/embeddings/providers'
import {
  createEmbeddingQuotaCircuitIdentity,
  type EmbeddingQuotaCircuitIdentity,
  isEmbeddingQuotaCircuitOpen,
  openEmbeddingQuotaCircuit,
} from '@/lib/embeddings/quota-circuit'
import { resolveEmbeddingRetryDelayMs } from '@/lib/embeddings/rate-limit'
import type {
  EmbeddingProviderAdapter,
  EmbeddingProviderKind,
  EmbeddingTaskType,
  EmbedOptions,
  EmbedResult,
  OpenRouterEmbedOptions,
} from '@/lib/embeddings/types'
import {
  attachRetryHeaders,
  isRetryableError,
  retryWithExponentialBackoff,
} from '@/lib/knowledge/documents/utils'
import { estimateTokenCount } from '@/lib/tokenization'
import { batchByTokenLimit, truncateToTokenLimit } from '@/lib/tokenization/accurate'

const logger = createLogger('EmbeddingClient')

/**
 * Embedding requests issued concurrently within a single embed call.
 *
 * A provider's rate limit is per API key, so this multiplies with however many
 * documents are being processed at once: the document-processing queue admits
 * {@link env.KB_CONFIG_CONCURRENCY_LIMIT} task runs, each reaching here. It was
 * previously read from that same variable, so one knob set both factors and the
 * product reached four figures of in-flight requests against one key — enough to
 * hold a provider at its limit indefinitely, which no retry policy can absorb.
 */
const DEFAULT_CONCURRENT_BATCHES = 8
const MAX_ALLOWED_CONCURRENT_BATCHES = 16

/** Keeps one worker's fan-out inside a tested local memory/concurrency ceiling. */
export function clampEmbeddingConcurrency(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONCURRENT_BATCHES
  return Math.min(Math.max(Math.floor(value), 1), MAX_ALLOWED_CONCURRENT_BATCHES)
}

const configuredEmbeddingConcurrency = envNumber(
  env.KB_CONFIG_EMBEDDING_CONCURRENCY,
  DEFAULT_CONCURRENT_BATCHES
)
const MAX_CONCURRENT_BATCHES = clampEmbeddingConcurrency(configuredEmbeddingConcurrency)
if (configuredEmbeddingConcurrency !== MAX_CONCURRENT_BATCHES) {
  logger.warn('Clamped embedding batch concurrency to the worker safety range', {
    configured: configuredEmbeddingConcurrency,
    effective: MAX_CONCURRENT_BATCHES,
    maximum: MAX_ALLOWED_CONCURRENT_BATCHES,
  })
}
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

/**
 * Hard ceiling on one successful embedding response.
 *
 * Gemini's documented 100-item request cap at the catalog's largest 3,072
 * dimensions fits comfortably inside 16 MiB, including a conservative JSON
 * representation allowance. Larger OpenAI-style batches are split below from
 * their expected vector width, so the guard rejects malformed provider output
 * rather than valid catalog traffic.
 */
export const MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES = 16 * 1024 * 1024

/** Bounds vectors retained across batches, aligned with the app's 100 MiB response ceiling. */
export const MAX_EMBEDDING_AGGREGATE_RESPONSE_BYTES = 100 * 1024 * 1024

/** Leaves room for the provider envelope, usage metadata, indices, and delimiters. */
const EMBEDDING_RESPONSE_ENVELOPE_RESERVE_BYTES = 64 * 1024

/**
 * JSON may render a finite double with more characters than its in-memory
 * representation. Thirty-two bytes per coordinate is deliberately conservative
 * for the number, comma, and surrounding array syntax.
 */
const EMBEDDING_RESPONSE_BYTES_PER_DIMENSION = 32
const EMBEDDING_RESPONSE_BYTES_PER_ITEM = 128

/** Retries after the initial attempt, per embedding request. */
export const EMBEDDING_MAX_RETRIES = 5

/** Ceiling on exponential backoff when the provider supplies no retry delay. */
export const EMBEDDING_MAX_RETRY_DELAY_MS = 30_000

/**
 * Longest a request can stay in the retry loop. An admitted provider-stated wait
 * is honored in full when it fits inside this deadline.
 */
const EMBEDDING_RETRY_BUDGET_MS = EMBEDDING_MAX_RETRIES * EMBEDDING_MAX_RETRY_DELAY_MS

export class EmbeddingAPIError extends Error {
  public status: number

  /** True when the rejected request used a customer-managed credential. */
  public readonly isBYOK: boolean

  /** Rejected for an exhausted balance rather than a recoverable rate limit. */
  public quotaExhausted?: boolean

  /**
   * Wait the provider asked for, read from the rejected response. Consumed by
   * {@link retryWithExponentialBackoff}, which prefers it over its own backoff.
   */
  public retryAfterMs?: number

  constructor(message: string, status: number, isBYOK = false) {
    super(message)
    this.name = 'EmbeddingAPIError'
    this.status = status
    this.isBYOK = isBYOK
  }
}

class EmbeddingResponseValidationError extends EmbeddingAPIError {
  constructor(message: string) {
    super(`Embedding API returned an invalid success response: ${message}`, 502)
    this.name = 'EmbeddingResponseValidationError'
  }
}

export class EmbeddingOutputLimitError extends Error {
  constructor(itemCount: number, dimensions: number, estimatedBytes: number) {
    super(
      `Embedding output for ${itemCount} inputs at ${dimensions} dimensions is estimated at ${estimatedBytes} bytes, exceeding the safe aggregate limit of ${MAX_EMBEDDING_AGGREGATE_RESPONSE_BYTES} bytes`
    )
    this.name = 'EmbeddingOutputLimitError'
  }
}

export const EMBEDDING_QUOTA_EXHAUSTED_MESSAGE =
  'The embedding provider has exhausted its available quota. Add credit or replace the credential before retrying.'

export const BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE =
  'The configured embedding API key was rejected. Update the key and retry this document.'

/**
 * A provider credential has no remaining credit. This remains transient across
 * providers so a configured fallback can run, but it is terminal for the
 * credential and for a Trigger task after every fallback is exhausted.
 */
export class EmbeddingQuotaExhaustedError extends EmbeddingAPIError {
  public readonly providerId: EmbeddingProviderKind

  constructor(providerId: EmbeddingProviderKind, cause?: unknown) {
    const status = cause instanceof EmbeddingAPIError ? cause.status : 429
    super(
      `The ${providerId} embedding credential has exhausted its available quota. Add credit or replace the credential before retrying.`,
      status,
      cause instanceof EmbeddingAPIError && cause.isBYOK
    )
    this.name = 'EmbeddingQuotaExhaustedError'
    this.providerId = providerId
    this.quotaExhausted = true
    this.cause = cause
  }
}

/**
 * True only when the overall embedding operation failed because every provider
 * it attempted had exhausted credit. A mixed fallback failure must retain task
 * retries because another provider may merely be temporarily unavailable.
 */
export function isEmbeddingQuotaExhaustion(error: unknown): boolean {
  if (error instanceof ProviderQuotaExhaustedError) return true
  if (error instanceof EmbeddingAPIError) return error.quotaExhausted === true
  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every(isEmbeddingQuotaExhaustion)
  }
  return false
}

/**
 * True when a customer-managed embedding credential was rejected outright.
 * These failures require a key or permission change; retrying the same request
 * cannot recover. Quota failures are classified separately even when a provider
 * reports them with HTTP 403.
 */
export function isBYOKEmbeddingCredentialRejection(error: unknown): error is EmbeddingAPIError {
  return (
    error instanceof EmbeddingAPIError &&
    error.isBYOK &&
    !error.quotaExhausted &&
    (error.status === 401 || error.status === 403)
  )
}

/**
 * True when a rejection body reports an exhausted balance rather than a rate
 * limit. OpenAI returns 429 for both, but only a rate limit reopens: a spent
 * account stands until someone adds credit, so retrying it cannot succeed.
 */
function isQuotaExhaustionBody(errorText: string): boolean {
  try {
    const body = JSON.parse(errorText) as { error?: { type?: string; code?: string } }
    const type = body.error?.type
    const code = body.error?.code
    return (
      type === 'insufficient_quota' ||
      code === 'insufficient_quota' ||
      code === 'credit_balance_exhausted'
    )
  } catch {
    return false
  }
}

/** Reads a bounded provider body only for internal quota classification. */
async function readEmbeddingErrorBody(response: Response, signal?: AbortSignal): Promise<string> {
  try {
    return await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Embedding API error response',
      signal,
    })
  } catch {
    signal?.throwIfAborted()
    return ''
  }
}

/**
 * True when the provider's stated wait outlasts the entire retry budget.
 *
 * The retry layer honors a provider-stated wait in full only when it fits inside
 * the remaining operation deadline. A wait longer than the entire embedding
 * budget can therefore never be admitted.
 *
 * The error stays transient — it just is not worth retrying here — so refusing
 * the retry surfaces it immediately and the fallback chain, which classifies
 * separately via `shouldFallback`, reaches the next provider at once. Where no
 * fallback is configured the request fails either way; this only decides whether
 * it fails now or after the budget burns down for nothing.
 */
function statedWaitOutlastsBudget(error: unknown): boolean {
  return (
    error instanceof EmbeddingAPIError &&
    error.retryAfterMs !== undefined &&
    error.retryAfterMs > EMBEDDING_RETRY_BUDGET_MS
  )
}

/**
 * Whether another attempt against the *same* provider could succeed. Narrower
 * than {@link isTransientEmbeddingError}, which decides whether to fail over to a
 * different one: an exhausted balance rules out the key just used but says
 * nothing about the next in the chain.
 */
function isWorthRetrying(error: unknown): boolean {
  if (!isTransientEmbeddingError(error)) return false
  if (error instanceof EmbeddingResponseValidationError) return false
  if (error instanceof EmbeddingAPIError && error.quotaExhausted) return false
  return !statedWaitOutlastsBudget(error)
}

export function isTransientEmbeddingError(error: unknown): boolean {
  if (error instanceof EmbeddingAPIError) {
    if (error.quotaExhausted) return true
    return error.status === 429 || error.status >= 500
  }
  if (error instanceof Error && error.name === 'AbortError') return true
  return isRetryableError(error)
}

interface ResolvedProvider {
  adapter: EmbeddingProviderAdapter
  info: EmbeddingModelInfo
  providerId: EmbeddingProviderKind
  quotaCircuitIdentity: EmbeddingQuotaCircuitIdentity
  /** Model name as sent to the provider (an Azure deployment name when Azure is active). */
  modelName: string
  /** Dimensionality the request will produce, for reporting and billing. */
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

async function resolveProvider(
  model: string,
  options: Omit<EmbedOptions, 'projectInputs'>
): Promise<ResolvedProvider> {
  const info = getEmbeddingModelInfo(model)
  const dimensions = resolveDimensions(info, options.dimensions)

  if (options.transport === 'openrouter') {
    if (info.provider !== 'openai') {
      throw new Error(`OpenRouter transport does not support catalog provider: ${info.provider}`)
    }
    if (!options.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured')
    }
    return {
      adapter: getAdapterFactory('openrouter')({
        modelName: model,
        apiKey: options.apiKey,
        nativeDimensions: info.nativeDimensions,
      }),
      info,
      providerId: 'openrouter',
      quotaCircuitIdentity: createEmbeddingQuotaCircuitIdentity('openrouter', options.apiKey),
      modelName: model,
      dimensions,
      isBYOK: true,
    }
  }

  /**
   * Ollama runs on the deployment's own server and takes no credential, so it
   * resolves before every key-bearing path and ignores a caller-supplied key
   * rather than pretending one applies.
   *
   * A self-hosted deployment may leave `OLLAMA_URL` unset and be served by the
   * loopback default, exactly as the chat provider is; only hosted Sim, which
   * runs no Ollama, has to be pointed at one. Requiring the variable everywhere
   * would have made this stricter than the selector that offers the models.
   */
  if (info.provider === 'ollama') {
    if (!isOllamaServerConfigured()) {
      throw new Error('OLLAMA_URL must be configured for Ollama embeddings')
    }
    const baseUrl = getOllamaUrl().replace(/\/+$/, '')
    const modelName = ollamaEmbeddingModelName(model)
    return {
      adapter: getAdapterFactory('ollama')({
        modelName,
        baseUrl,
        nativeDimensions: info.nativeDimensions,
      }),
      info,
      providerId: 'ollama',
      /** No credential exists, so the circuit is keyed by the server it protects. */
      quotaCircuitIdentity: createEmbeddingQuotaCircuitIdentity('ollama', baseUrl),
      modelName,
      dimensions,
      /** Local inference costs Sim nothing, so none of its tokens are billable. */
      isBYOK: true,
    }
  }

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
        providerId: 'azure-openai',
        quotaCircuitIdentity: createEmbeddingQuotaCircuitIdentity('azure-openai', azure.apiKey),
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
    providerId: info.provider,
    quotaCircuitIdentity: createEmbeddingQuotaCircuitIdentity(info.provider, apiKey),
    modelName: model,
    dimensions,
    isBYOK,
  }
}

function validateEmbeddingBatch(
  value: unknown,
  expectedCount: number,
  expectedDimensions: number | undefined
): { embeddings: number[][]; dimensions: number } {
  if (!Array.isArray(value)) {
    throw new EmbeddingResponseValidationError('the vector payload is not an array')
  }
  if (value.length !== expectedCount) {
    throw new EmbeddingResponseValidationError(
      `returned ${value.length} embeddings for ${expectedCount} inputs`
    )
  }

  let resolvedDimensions = expectedDimensions
  for (let index = 0; index < value.length; index++) {
    const vector = value[index]
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new EmbeddingResponseValidationError(`vector ${index} is empty or not an array`)
    }
    if (
      vector.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))
    ) {
      throw new EmbeddingResponseValidationError(
        `vector ${index} contains a non-numeric or non-finite coordinate`
      )
    }

    resolvedDimensions ??= vector.length
    if (vector.length !== resolvedDimensions) {
      const qualifier = expectedDimensions === undefined ? 'inconsistent' : 'unexpected'
      throw new EmbeddingResponseValidationError(
        `vector ${index} has ${vector.length} ${qualifier} dimensions; expected ${resolvedDimensions}`
      )
    }
  }

  if (resolvedDimensions === undefined) {
    throw new EmbeddingResponseValidationError('the response did not contain any vectors')
  }
  return { embeddings: value as number[][], dimensions: resolvedDimensions }
}

/** Deployment-managed key rotations share one operating budget and provider pause. */
function embeddingAdmissionIdentity(
  provider: Pick<ResolvedProvider, 'providerId' | 'quotaCircuitIdentity' | 'isBYOK'>
): EmbeddingQuotaCircuitIdentity {
  return provider.isBYOK
    ? provider.quotaCircuitIdentity
    : { providerId: provider.providerId, credentialFingerprint: `hosted:${provider.providerId}` }
}

/** `inputs` are already projected and batched by the embedding orchestrator. */
async function callEmbeddingAPI(
  inputs: string[],
  adapter: EmbeddingProviderAdapter,
  tokenizerProvider: string,
  taskType: EmbeddingTaskType,
  providerId: EmbeddingProviderKind,
  quotaCircuitIdentity: EmbeddingQuotaCircuitIdentity,
  /**
   * The caller's explicit reduction, or undefined when none was requested. Kept
   * distinct from `provider.dimensions` because a model without Matryoshka
   * support rejects the parameter outright — sending it populated with the
   * native size is a 400, not a no-op.
   */
  requestedDimensions: number | undefined,
  expectedDimensions: number | undefined,
  isBYOK: boolean,
  signal?: AbortSignal
): Promise<{ embeddings: number[][]; totalTokens: number; dimensions: number }> {
  const admissionIdentity = embeddingAdmissionIdentity({ providerId, quotaCircuitIdentity, isBYOK })
  return retryWithExponentialBackoff(
    async (operationSignal, deadlineAt) => {
      if (await isEmbeddingQuotaCircuitOpen(admissionIdentity)) {
        throw new EmbeddingQuotaExhaustedError(providerId)
      }

      try {
        await waitForProviderAdmission({
          ...admissionIdentity,
          operation: 'embedding',
          inputTokens: inputs.reduce(
            (sum, text) => sum + estimateTokenCount(text, tokenizerProvider).count,
            0
          ),
          signal: operationSignal,
          maxWaitMs: Math.max(0, deadlineAt - Date.now()),
        })
      } catch (error) {
        if (error instanceof ProviderQuotaExhaustedError)
          throw new EmbeddingQuotaExhaustedError(providerId, error)
        throw error
      }

      const request = adapter.buildRequest({
        inputs,
        taskType,
        dimensions: requestedDimensions,
      })

      operationSignal?.throwIfAborted()
      const controller = new AbortController()
      const onAbort = () => controller.abort(operationSignal?.reason)
      operationSignal?.addEventListener('abort', onAbort, { once: true })
      if (operationSignal?.aborted) onAbort()
      const timeout = setTimeout(() => controller.abort(), EMBEDDING_REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(request.apiUrl, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal: controller.signal,
        })

        if (!response.ok) {
          const classificationBody = await readEmbeddingErrorBody(response, controller.signal)
          const error = new EmbeddingAPIError(
            `Embedding API failed: ${response.status}`,
            response.status,
            isBYOK
          )
          error.quotaExhausted =
            isQuotaExhaustionBody(classificationBody) ||
            (providerId === 'openrouter' && response.status === 402)

          if (error.quotaExhausted) {
            await openEmbeddingQuotaCircuit(admissionIdentity)
            throw new EmbeddingQuotaExhaustedError(providerId, error)
          }

          /**
           * Carry the provider's own answer to "when may I retry" onto the error,
           * the way `fetchWithRetry` does for connectors. Without it the retry
           * loop had nothing but blind exponential backoff and would exhaust every
           * attempt inside a rate-limit window that had not yet reopened.
           *
           * The headers travel non-enumerably so the retry condition can re-read
           * them without the bag reaching a log line.
           */
          attachRetryHeaders(error, response.headers)
          const waitMs = resolveEmbeddingRetryDelayMs(response.headers)
          if (waitMs !== null) {
            error.retryAfterMs = waitMs
          }

          if (response.status === 429) {
            await recordProviderCooldown(
              { ...admissionIdentity, operation: 'embedding' },
              waitMs ?? 1000
            )
          }
          throw error
        }

        const json = await readResponseJsonWithLimit(response, {
          maxBytes: MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES,
          label: 'Embedding API success response',
          signal: controller.signal,
        })
        let parsedEmbeddings: unknown
        try {
          parsedEmbeddings = request.parse(json)
        } catch {
          throw new EmbeddingResponseValidationError('the vector payload could not be parsed')
        }
        const { embeddings, dimensions } = validateEmbeddingBatch(
          parsedEmbeddings,
          inputs.length,
          expectedDimensions
        )
        /**
         * Fallback for a response that carries no usage block. Estimated with the
         * provider's own tokenizer, which is approximate for every non-OpenAI
         * model — see {@link hasApproximateTokenCount}.
         */
        const totalTokens =
          request.parseTokens?.(json) ??
          inputs.reduce((sum, text) => sum + estimateTokenCount(text, tokenizerProvider).count, 0)

        return { embeddings, totalTokens, dimensions }
      } finally {
        clearTimeout(timeout)
        operationSignal?.removeEventListener('abort', onAbort)
      }
    },
    {
      /**
       * Sized against a rate-limit window rather than a transient blip. The
       * provider states its reset in tens of seconds, and the loop honors that
       * wait when it fits inside the operation budget.
       *
       * Bounded so a fully saturated provider cannot outlive the task: five
       * attempts at the ceiling is well inside `KB_CONFIG_MAX_DURATION`, and
       * batches wait concurrently rather than one after another.
       */
      maxRetries: EMBEDDING_MAX_RETRIES,
      initialDelayMs: 1000,
      maxDelayMs: EMBEDDING_MAX_RETRY_DELAY_MS,
      retryBudgetMs: EMBEDDING_RETRY_BUDGET_MS,
      retryCondition: (error) => !signal?.aborted && isWorthRetrying(error),
      signal,
    }
  )
}

interface EmbeddingInputLimits {
  maxInputTokens: number
  maxTokensPerRequest?: number
  tokenizerProvider: string
  approximateTokenCount: boolean
}

function getEmbeddingInputLimits(info: EmbeddingModelInfo): EmbeddingInputLimits {
  return {
    maxInputTokens: info.maxInputTokens,
    maxTokensPerRequest: info.maxTokensPerRequest,
    tokenizerProvider: info.tokenizerProvider,
    approximateTokenCount: hasApproximateTokenCount(info),
  }
}

function prepareEmbeddingInputs(
  texts: string[],
  model: string,
  limits: EmbeddingInputLimits,
  projectInputs: EmbedOptions['projectInputs']
): string[] {
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
  const modelInputs = projectInputs ? projectInputs(texts) : texts

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
  const ceiling = limits.maxInputTokens
  const boundedInputs = modelInputs.map((text) => {
    if (estimateTokenCount(text, limits.tokenizerProvider).count <= ceiling) return text
    logger.warn('Embedding input exceeds the model token limit and will be truncated', {
      model,
      maxInputTokens: ceiling,
      chars: text.length,
      approximateTokenCount: limits.approximateTokenCount,
    })
    return truncateToTokenLimit(text, ceiling, model)
  })

  return boundedInputs
}

async function embedWithProvider(
  boundedInputs: string[],
  model: string,
  taskType: EmbeddingTaskType,
  requestedDimensions: number | undefined,
  provider: ResolvedProvider,
  signal?: AbortSignal
): Promise<EmbedResult> {
  signal?.throwIfAborted()
  assertEmbeddingAggregateResponseWithinLimit(boundedInputs.length, provider.dimensions)
  const batches = createEmbeddingBatches(
    boundedInputs,
    model,
    getEmbeddingInputLimits(provider.info),
    provider.adapter.maxItemsPerRequest,
    provider.dimensions
  )

  const batchResults = await mapWithConcurrency(
    batches,
    MAX_CONCURRENT_BATCHES,
    async (batch, i) => {
      try {
        signal?.throwIfAborted()
        return await callEmbeddingAPI(
          batch,
          provider.adapter,
          provider.info.tokenizerProvider,
          taskType,
          provider.providerId,
          provider.quotaCircuitIdentity,
          requestedDimensions,
          provider.dimensions,
          provider.isBYOK,
          signal
        )
      } catch (error) {
        const message = `Failed to generate embeddings for batch ${i + 1}/${batches.length}:`
        if (isEmbeddingQuotaExhaustion(error)) {
          logger.warn(message, { providerId: provider.providerId, quotaExhausted: true })
        } else if (isBYOKEmbeddingCredentialRejection(error)) {
          logger.warn(message, {
            providerId: provider.providerId,
            outcome: 'customer_configuration',
            status: error.status,
          })
        } else {
          logger.error(message, error)
        }
        throw error
      }
    }
  )

  const { embeddings, totalTokens } = combineEmbeddingBatches(batchResults)

  return {
    embeddings,
    totalTokens,
    billableTokens: provider.isBYOK ? 0 : totalTokens,
    isBYOK: provider.isBYOK,
    modelName: provider.modelName,
    pricingId: provider.info.pricingId,
    dimensions: provider.dimensions,
  }
}

function createEmbeddingBatches(
  boundedInputs: string[],
  model: string,
  limits: Pick<EmbeddingInputLimits, 'maxInputTokens' | 'maxTokensPerRequest'>,
  itemLimit: number | undefined,
  dimensions: number | undefined
): string[][] {
  const ceiling = limits.maxInputTokens

  /**
   * How many tokens may share one request — a different limit from the per-input
   * ceiling above, and the one that decides how many inputs go in a batch.
   *
   * Three bounds compose here:
   *
   * 1. {@link BATCH_TOKEN_TARGET} is what we actually aim for — an operational
   *    choice, not a provider limit (see its declaration for the reasoning).
   * 2. A provider's documented summed-token cap, when it publishes one, is a
   *    hard ceiling the target can never exceed.
   * 3. The per-input ceiling is a floor. A budget below it would make
   *    `batchByTokenLimit` truncate inputs the provider would have accepted —
   *    Cohere takes 128k tokens in one text, far above the target.
   */
  const requestBudget = Math.max(
    Math.min(limits.maxTokensPerRequest ?? BATCH_TOKEN_TARGET, BATCH_TOKEN_TARGET),
    ceiling
  )

  const tokenBatches = batchByTokenLimit(boundedInputs, requestBudget, model)
  const responseItemLimit = dimensions
    ? Math.max(
        1,
        Math.floor(
          (MAX_EMBEDDING_SUCCESS_RESPONSE_BYTES - EMBEDDING_RESPONSE_ENVELOPE_RESERVE_BYTES) /
            (dimensions * EMBEDDING_RESPONSE_BYTES_PER_DIMENSION +
              EMBEDDING_RESPONSE_BYTES_PER_ITEM)
        )
      )
    : undefined
  const effectiveItemLimit =
    itemLimit && responseItemLimit
      ? Math.min(itemLimit, responseItemLimit)
      : (itemLimit ?? responseItemLimit)

  return effectiveItemLimit
    ? tokenBatches.flatMap((batch) => chunkArray(batch, effectiveItemLimit))
    : tokenBatches
}

function assertEmbeddingAggregateResponseWithinLimit(itemCount: number, dimensions: number): void {
  if (itemCount <= getEmbeddingAggregateItemLimit(dimensions)) return

  const estimatedBytes =
    EMBEDDING_RESPONSE_ENVELOPE_RESERVE_BYTES +
    itemCount *
      (dimensions * EMBEDDING_RESPONSE_BYTES_PER_DIMENSION + EMBEDDING_RESPONSE_BYTES_PER_ITEM)
  throw new EmbeddingOutputLimitError(itemCount, dimensions, estimatedBytes)
}

export function getEmbeddingAggregateItemLimit(dimensions: number): number {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('Embedding dimensions must be a positive integer')
  }
  return Math.floor(
    (MAX_EMBEDDING_AGGREGATE_RESPONSE_BYTES - EMBEDDING_RESPONSE_ENVELOPE_RESERVE_BYTES) /
      (dimensions * EMBEDDING_RESPONSE_BYTES_PER_DIMENSION + EMBEDDING_RESPONSE_BYTES_PER_ITEM)
  )
}

function combineEmbeddingBatches(
  batchResults: readonly { embeddings: number[][]; totalTokens: number; dimensions: number }[]
): { embeddings: number[][]; totalTokens: number; dimensions: number | undefined } {
  const embeddings: number[][] = []
  let totalTokens = 0
  let dimensions: number | undefined
  for (const batch of batchResults) {
    dimensions ??= batch.dimensions
    if (batch.dimensions !== dimensions) {
      throw new EmbeddingResponseValidationError(
        `concurrent batches returned inconsistent dimensions (${dimensions} and ${batch.dimensions})`
      )
    }
    for (const vector of batch.embeddings) {
      embeddings.push(vector)
    }
    totalTokens += batch.totalTokens
  }
  return { embeddings, totalTokens, dimensions }
}

/**
 * Generates embeddings for a batch of texts with token-aware batching,
 * per-provider item caps, bounded concurrency, and retry on transient failures.
 */
export async function embed(texts: string[], options: EmbedOptions): Promise<EmbedResult> {
  options.signal?.throwIfAborted()
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL
  const taskType = options.taskType ?? 'document'
  const provider = await resolveProvider(model, options)
  const boundedInputs = prepareEmbeddingInputs(
    texts,
    model,
    getEmbeddingInputLimits(provider.info),
    options.projectInputs
  )
  return embedWithProvider(
    boundedInputs,
    model,
    taskType,
    options.dimensions,
    provider,
    options.signal
  )
}

/** Generates embeddings for any model returned by OpenRouter's embedding catalog. */
export async function embedOpenRouter(
  texts: string[],
  options: OpenRouterEmbedOptions
): Promise<EmbedResult> {
  if (texts.length === 0) throw new Error('At least one embedding input is required')
  if (!options.apiKey) throw new Error('OpenRouter API key is required')
  if (!Number.isInteger(options.maxInputTokens) || options.maxInputTokens <= 0) {
    throw new Error('OpenRouter max input tokens must be a positive integer')
  }

  const model = options.model ?? DEFAULT_OPENROUTER_EMBEDDING_MODEL
  const limits: EmbeddingInputLimits = {
    maxInputTokens: options.maxInputTokens,
    tokenizerProvider: 'openrouter',
    approximateTokenCount: true,
  }
  const boundedInputs = prepareEmbeddingInputs(texts, model, limits, options.projectInputs)
  const adapter = getAdapterFactory('openrouter')({
    modelName: model,
    apiKey: options.apiKey,
    nativeDimensions: options.dimensions ?? 0,
  })
  const quotaCircuitIdentity = createEmbeddingQuotaCircuitIdentity('openrouter', options.apiKey)
  const callOpenRouterBatch = (
    batch: string[],
    expectedDimensions: number | undefined
  ): Promise<{ embeddings: number[][]; totalTokens: number; dimensions: number }> =>
    callEmbeddingAPI(
      batch,
      adapter,
      limits.tokenizerProvider,
      'document',
      'openrouter',
      quotaCircuitIdentity,
      options.dimensions,
      expectedDimensions,
      true,
      options.signal
    )

  let batchResults: { embeddings: number[][]; totalTokens: number; dimensions: number }[]
  if (options.dimensions === undefined) {
    const firstInput = boundedInputs[0]
    if (firstInput === undefined) {
      throw new EmbeddingResponseValidationError('the response did not contain any vectors')
    }
    options.signal?.throwIfAborted()
    const firstResult = await callOpenRouterBatch([firstInput], undefined)
    assertEmbeddingAggregateResponseWithinLimit(boundedInputs.length, firstResult.dimensions)
    const batches = createEmbeddingBatches(
      boundedInputs.slice(1),
      model,
      limits,
      adapter.maxItemsPerRequest,
      firstResult.dimensions
    )
    const remainingResults = await mapWithConcurrency(batches, MAX_CONCURRENT_BATCHES, (batch) => {
      options.signal?.throwIfAborted()
      return callOpenRouterBatch(batch, firstResult.dimensions)
    })
    batchResults = [firstResult, ...remainingResults]
  } else {
    assertEmbeddingAggregateResponseWithinLimit(boundedInputs.length, options.dimensions)
    const batches = createEmbeddingBatches(
      boundedInputs,
      model,
      limits,
      adapter.maxItemsPerRequest,
      options.dimensions
    )
    batchResults = await mapWithConcurrency(batches, MAX_CONCURRENT_BATCHES, (batch) => {
      options.signal?.throwIfAborted()
      return callOpenRouterBatch(batch, options.dimensions)
    })
  }
  const result = combineEmbeddingBatches(batchResults)

  const dimensions = result.dimensions
  if (dimensions === undefined) {
    throw new EmbeddingResponseValidationError('the response did not contain any vectors')
  }

  return {
    embeddings: result.embeddings,
    totalTokens: result.totalTokens,
    billableTokens: 0,
    isBYOK: true,
    modelName: model,
    pricingId: model,
    dimensions,
  }
}

type KnowledgeEmbedOptions = Omit<EmbedOptions, 'apiKey' | 'transport'>
type KnowledgeProviderOptions = Omit<KnowledgeEmbedOptions, 'projectInputs'>

function resolveEnvironmentOpenAIKey(): string {
  if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY
  return getRotatingApiKey('openai')
}

async function resolveKnowledgeFallback(options: KnowledgeProviderOptions, hosted: boolean) {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL
  const info = getEmbeddingModelInfo(model)
  if (hosted || !env.OPENROUTER_API_KEY || info.provider !== 'openai') return null
  const dimensions = resolveDimensions(info, options.dimensions)
  const workspaceKey = options.workspaceId ? await getBYOKKey(options.workspaceId, 'openai') : null
  const capabilityValues = {
    ...env,
    /**
     * The capability gates its providers on the model and width
     * `KB_EMBEDDING_MODEL` and `EMBEDDING_OUTPUT_DIMS` name, but what matters
     * here is the target this call actually embeds with: a knowledge base keeps
     * the model and width it was created with, so one created before the
     * deployment default changed must still resolve its own family's transports.
     * Both are substituted — the model alone would leave the deployment's width
     * being validated against this base's family, which rejects the chain
     * outright for a base whose family accepts a width the deployment's does not.
     */
    KB_EMBEDDING_MODEL: model,
    EMBEDDING_OUTPUT_DIMS: String(dimensions),
    ...(workspaceKey ? { OPENAI_API_KEY: workspaceKey.apiKey } : {}),
  }

  const factories = {
    'azure-openai': () => {
      const azure = resolveAzureOverride(info, model)
      if (!azure) return null
      return {
        adapter: getAdapterFactory('azure-openai')({
          modelName: azure.deployment,
          apiKey: azure.apiKey,
          nativeDimensions: info.nativeDimensions,
          endpoint: azure.endpoint,
          apiVersion: azure.apiVersion,
        }),
        info,
        providerId: 'azure-openai',
        quotaCircuitIdentity: createEmbeddingQuotaCircuitIdentity('azure-openai', azure.apiKey),
        modelName: azure.deployment,
        dimensions,
        isBYOK: false,
      }
    },
    openai: () => {
      const apiKey = workspaceKey?.apiKey ?? resolveEnvironmentOpenAIKey()
      return {
        adapter: getAdapterFactory('openai')({
          modelName: model,
          apiKey,
          nativeDimensions: info.nativeDimensions,
        }),
        info,
        providerId: 'openai',
        quotaCircuitIdentity: createEmbeddingQuotaCircuitIdentity('openai', apiKey),
        modelName: model,
        dimensions,
        isBYOK: Boolean(workspaceKey),
      }
    },
    openrouter: () => {
      if (!env.OPENROUTER_API_KEY) return null
      return {
        adapter: getAdapterFactory('openrouter')({
          modelName: model,
          apiKey: env.OPENROUTER_API_KEY,
          nativeDimensions: info.nativeDimensions,
        }),
        info,
        providerId: 'openrouter',
        quotaCircuitIdentity: createEmbeddingQuotaCircuitIdentity(
          'openrouter',
          env.OPENROUTER_API_KEY
        ),
        modelName: model,
        dimensions,
        isBYOK: false,
      }
    },
    /**
     * Gemini and Ollama are declared on the capability because they serve
     * knowledge embeddings, but never through this chain: it is built only for
     * OpenAI models (the guard above returns for everything else), and the
     * capability's own family gating marks them inactive here for the same
     * reason. `wireFallback` throws if a provider it resolved as ready returns
     * null, so this stays a loud failure rather than a silent wrong provider if
     * either assumption ever stops holding.
     */
    gemini: () => null,
    ollama: () => null,
  } satisfies FallbackFactories<typeof KNOWLEDGE_EMBEDDINGS_CAPABILITY, ResolvedProvider>

  return wireFallback<typeof KNOWLEDGE_EMBEDDINGS_CAPABILITY, ResolvedProvider>({
    definition: KNOWLEDGE_EMBEDDINGS_CAPABILITY,
    values: capabilityValues,
    factories,
    shouldFallback: (error) => !options.signal?.aborted && isTransientEmbeddingError(error),
    onFailure(providerId, error) {
      logger.warn(
        'Knowledge embedding provider failed; continuing fallback chain',
        isEmbeddingQuotaExhaustion(error)
          ? { providerId, quotaExhausted: true }
          : { providerId, error }
      )
    },
  })
}

/** @internal Exported for deterministic hosted/self-hosted routing tests. */
export async function assertKnowledgeEmbeddingCapacityForDeployment(
  options: KnowledgeProviderOptions,
  hosted: boolean
): Promise<void> {
  options.signal?.throwIfAborted()
  const fallback = await resolveKnowledgeFallback(options, hosted)
  const providers = fallback?.providers ?? [
    await resolveProvider(options.model ?? DEFAULT_EMBEDDING_MODEL, options),
  ]
  const errors: EmbeddingQuotaExhaustedError[] = []
  for (const provider of providers) {
    options.signal?.throwIfAborted()
    const exhausted = await isEmbeddingQuotaCircuitOpen(embeddingAdmissionIdentity(provider))
    options.signal?.throwIfAborted()
    if (!exhausted) return
    errors.push(new EmbeddingQuotaExhaustedError(provider.providerId))
  }
  if (errors.length === 1) throw errors[0]
  throw new AggregateError(
    errors,
    'Every configured knowledge embedding provider has exhausted quota'
  )
}

/** Avoids downloading, parsing, and OCR when every usable provider is already paused for quota. */
export async function assertKnowledgeEmbeddingCapacity(
  options: KnowledgeProviderOptions
): Promise<void> {
  return assertKnowledgeEmbeddingCapacityForDeployment(options, isHosted)
}

/** @internal Exported for deterministic hosted/self-hosted routing tests. */
export async function embedKnowledgeForDeployment(
  texts: string[],
  options: KnowledgeEmbedOptions,
  hosted: boolean
): Promise<EmbedResult> {
  options.signal?.throwIfAborted()
  const fallback = await resolveKnowledgeFallback(options, hosted)
  if (!fallback) return embed(texts, options)
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL
  const info = getEmbeddingModelInfo(model)
  const dimensions = resolveDimensions(info, options.dimensions)
  assertEmbeddingAggregateResponseWithinLimit(texts.length, dimensions)
  const taskType = options.taskType ?? 'document'
  const boundedInputs = prepareEmbeddingInputs(
    texts,
    model,
    getEmbeddingInputLimits(info),
    options.projectInputs
  )

  const itemLimits = fallback.providers.flatMap((provider) =>
    provider.adapter.maxItemsPerRequest ? [provider.adapter.maxItemsPerRequest] : []
  )
  const batches = createEmbeddingBatches(
    boundedInputs,
    model,
    info,
    itemLimits.length > 0 ? Math.min(...itemLimits) : undefined,
    dimensions
  )
  const batchResults = await mapWithConcurrency(
    batches,
    MAX_CONCURRENT_BATCHES,
    async (batch, i) => {
      try {
        options.signal?.throwIfAborted()
        return await fallback.execute(async (provider) => ({
          ...(await callEmbeddingAPI(
            batch,
            provider.adapter,
            provider.info.tokenizerProvider,
            taskType,
            provider.providerId,
            provider.quotaCircuitIdentity,
            options.dimensions,
            provider.dimensions,
            provider.isBYOK,
            options.signal
          )),
          provider,
        }))
      } catch (error) {
        const message = `Failed to generate embeddings for batch ${i + 1}/${batches.length}:`
        if (isEmbeddingQuotaExhaustion(error)) {
          logger.warn(message, { quotaExhausted: true })
        } else if (isBYOKEmbeddingCredentialRejection(error)) {
          logger.warn(message, {
            outcome: 'customer_configuration',
            status: error.status,
          })
        } else {
          logger.error(message, error)
        }
        throw error
      }
    }
  )
  const { embeddings, totalTokens } = combineEmbeddingBatches(batchResults)
  const defaultProvider = fallback.providers[0]
  const usedProviders = batchResults.map((batch) => batch.provider)
  const metadataProvider = usedProviders[0] ?? defaultProvider
  const modelNames = new Set(usedProviders.map((provider) => provider.modelName))
  const billableTokens = batchResults.reduce(
    (sum, batch) => sum + (batch.provider.isBYOK ? 0 : batch.totalTokens),
    0
  )

  return {
    embeddings,
    totalTokens,
    billableTokens,
    isBYOK: usedProviders.length > 0 ? billableTokens === 0 : metadataProvider.isBYOK,
    modelName: modelNames.size > 1 ? model : metadataProvider.modelName,
    pricingId: info.pricingId,
    dimensions,
  }
}

/** Generates KB document/query embeddings with opt-in self-hosted OpenRouter fallback. */
export async function embedKnowledge(
  texts: string[],
  options: KnowledgeEmbedOptions
): Promise<EmbedResult> {
  return embedKnowledgeForDeployment(texts, options, isHosted)
}
