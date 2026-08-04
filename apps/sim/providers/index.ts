import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getApiKeyWithBYOK } from '@/lib/api-key/byok'
import type { StreamingExecution } from '@/executor/types'
import {
  applyModelCostPolicy,
  applySegmentCostPolicy,
  calculateBillableModelCost,
  installStreamingCostPolicy,
  type ModelCostPolicy,
  resolveModelCostPolicy,
  withoutToolCost,
} from '@/providers/cost-policy'
import {
  attachLargeFileRemoteUrls,
  uploadLargeFilesToProvider,
} from '@/providers/file-attachments.server'
import {
  getReasoningEffortValuesForModel,
  getThinkingLevelsForModel,
  getVerbosityValuesForModel,
  isKnownModelId,
  isKnownModelLevelValue,
} from '@/providers/models'
import { getProviderExecutor } from '@/providers/registry'
import {
  type ProviderRuntimeContext,
  runWithProviderRuntimeContext,
} from '@/providers/runtime-context'
import type { ProviderId, ProviderRequest, ProviderResponse } from '@/providers/types'
import {
  generateStructuredOutputInstructions,
  sumToolCosts,
  supportsPromptCaching,
  supportsReasoningEffort,
  supportsTemperature,
  supportsThinking,
  supportsVerbosity,
} from '@/providers/utils'

const logger = createLogger('Providers')

/**
 * Maximum number of iterations for tool call loops to prevent infinite loops.
 * Used across all providers that support tool/function calling.
 */
export const MAX_TOOL_ITERATIONS = 20

/**
 * Normalizes a model-tuning level that may have arrived from a variable or block reference
 * rather than a picker. Every level a model declares is lower-case, so trimming and
 * lower-casing lets a reference resolve to `"High"` or `" high "` and still apply. A level
 * that resolves to nothing becomes `undefined` so the field reads as untouched instead of
 * sending an empty string the provider rejects.
 */
function normalizeModelLevel(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return normalized || undefined
}

/**
 * Levels the pickers offer on top of what a model declares. `auto` means "say nothing" and
 * `none` means "explicitly off"; every provider adapter special-cases them, so neither is
 * an unrecognized level.
 */
const MODEL_LEVEL_SENTINELS = new Set(['auto', 'none'])

type ModelLevelField = 'reasoningEffort' | 'verbosity' | 'thinkingLevel'

/**
 * Renders a level for a log line.
 *
 * These fields accept variable and environment references, so an unrecognized value is not
 * necessarily a mistyped level — it is whatever the reference resolved to, which may be secret
 * content. Only a level the catalogue declares somewhere is safe to echo; anything else is
 * reported by length alone, which is enough to tell a stray level from a resolved blob.
 */
function describeLevel(value: string): string {
  const isSafe = MODEL_LEVEL_SENTINELS.has(value) || isKnownModelLevelValue(value)
  return isSafe ? value : `[redacted ${value.length} chars]`
}

/**
 * Clears a level whose resolved model does not accept the field at all.
 *
 * Dropping is the safe default — a provider that has no such parameter rejects the whole
 * request — but the discard is reported because the model can be bound to a variable or block
 * reference and is therefore only known at execution time. Without this, a run whose reference
 * resolved to a model that does not take the field would quietly fall back to that model's
 * default while the caller believed the level applied.
 */
function dropUnsupportedLevel(
  field: ModelLevelField,
  model: string,
  value: string | undefined
): undefined {
  if (value) {
    logger.warn('Model does not support this level; dropping it from the request', {
      field,
      model,
      value: describeLevel(value),
    })
  }
  return undefined
}

/**
 * Logs a level that the model accepts as a field but does not list as a value.
 *
 * Deliberately does not drop the value. Sim's per-model level lists exist to populate the
 * pickers and can lag a provider that has started accepting a new level, so rejecting on them
 * would refuse values the API would have taken. Forwarding instead surfaces the provider's own
 * error, which names the field and the values it accepts — the loud failure an eval sweeping
 * levels needs, where silently substituting the model default would corrupt the results.
 */
function warnOnUnrecognizedLevel(
  field: ModelLevelField,
  model: string | undefined,
  value: string | undefined,
  declaredValues: string[] | null
): void {
  if (!model || !value || MODEL_LEVEL_SENTINELS.has(value)) return
  if (!declaredValues || declaredValues.includes(value)) return

  logger.warn('Model level is not one this model declares; forwarding to the provider', {
    field,
    model,
    value: describeLevel(value),
    declaredValues,
  })
}

function sanitizeRequest(request: ProviderRequest): ProviderRequest {
  const sanitizedRequest = { ...request }
  const model = sanitizedRequest.model

  sanitizedRequest.reasoningEffort = normalizeModelLevel(sanitizedRequest.reasoningEffort)
  sanitizedRequest.verbosity = normalizeModelLevel(sanitizedRequest.verbosity)
  sanitizedRequest.thinkingLevel = normalizeModelLevel(sanitizedRequest.thinkingLevel)

  if (model && !supportsTemperature(model)) {
    sanitizedRequest.temperature = undefined
  }

  /**
   * A model absent from the catalogue is unknown, not known-incapable. Since the model can be
   * bound to a reference, that is exactly how a newly released model arrives before Sim has
   * catalogued it — so its levels are forwarded and the provider decides, rather than being
   * discarded on the strength of a list that has not caught up. Models the catalogue does
   * know, and every dynamic-provider id, keep the protective drop.
   */
  const isCatalogued = Boolean(model) && isKnownModelId(model)

  if (model && isCatalogued && !supportsReasoningEffort(model)) {
    sanitizedRequest.reasoningEffort = dropUnsupportedLevel(
      'reasoningEffort',
      model,
      sanitizedRequest.reasoningEffort
    )
  }

  if (model && isCatalogued && !supportsVerbosity(model)) {
    sanitizedRequest.verbosity = dropUnsupportedLevel(
      'verbosity',
      model,
      sanitizedRequest.verbosity
    )
  }

  if (model && isCatalogued && !supportsThinking(model)) {
    sanitizedRequest.thinkingLevel = dropUnsupportedLevel(
      'thinkingLevel',
      model,
      sanitizedRequest.thinkingLevel
    )
  }

  if (model && !supportsPromptCaching(model)) {
    sanitizedRequest.promptCaching = undefined
  }

  warnOnUnrecognizedLevel(
    'reasoningEffort',
    model,
    sanitizedRequest.reasoningEffort,
    model ? getReasoningEffortValuesForModel(model) : null
  )
  warnOnUnrecognizedLevel(
    'verbosity',
    model,
    sanitizedRequest.verbosity,
    model ? getVerbosityValuesForModel(model) : null
  )
  warnOnUnrecognizedLevel(
    'thinkingLevel',
    model,
    sanitizedRequest.thinkingLevel,
    model ? getThinkingLevelsForModel(model) : null
  )

  return sanitizedRequest
}

function isStreamingExecution(response: any): response is StreamingExecution {
  return response && typeof response === 'object' && 'stream' in response && 'execution' in response
}

function isReadableStream(response: any): response is ReadableStream {
  return response instanceof ReadableStream
}

/**
 * Applies the shared model-cost policy to a streaming response.
 *
 * The streaming and non-streaming paths must charge identically for the same
 * model and tokens, but streaming providers write their cost from inside the
 * stream drain — long after this function returns — so the policy is installed
 * on the live output object rather than applied to a value.
 */
function applyStreamingCostPolicy(response: StreamingExecution, policy: ModelCostPolicy): void {
  const output = response.execution?.output
  if (!output || typeof output !== 'object') {
    logger.warn('Streaming output unavailable at intercept time; cost policy not applied')
    return
  }

  installStreamingCostPolicy(output, policy)

  const segments = output.providerTiming?.timeSegments
  if (Array.isArray(segments)) {
    applySegmentCostPolicy(segments, policy)
  }
}

export async function executeProviderRequest(
  providerId: string,
  request: ProviderRequest,
  runtimeContext?: ProviderRuntimeContext
): Promise<ProviderResponse | ReadableStream | StreamingExecution> {
  const provider = await getProviderExecutor(providerId as ProviderId)
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`)
  }

  if (!provider.executeRequest) {
    throw new Error(`Provider ${providerId} does not implement executeRequest`)
  }

  let resolvedRequest = sanitizeRequest(request)
  let isBYOK = false

  if (request.workspaceId) {
    try {
      const result = await getApiKeyWithBYOK(
        providerId,
        request.model,
        request.workspaceId,
        request.apiKey
      )
      resolvedRequest = { ...resolvedRequest, apiKey: result.apiKey }
      isBYOK = result.isBYOK
      logger.info('API key resolved', {
        provider: providerId,
        model: request.model,
        workspaceId: request.workspaceId,
        isBYOK,
      })
    } catch (error) {
      logger.error('Failed to resolve API key:', {
        provider: providerId,
        model: request.model,
        error: toError(error).message,
      })
      throw error
    }
  }

  resolvedRequest.isBYOK = isBYOK
  const sanitizedRequest = resolvedRequest

  if (sanitizedRequest.responseFormat) {
    if (
      typeof sanitizedRequest.responseFormat === 'string' &&
      sanitizedRequest.responseFormat === ''
    ) {
      logger.info('Empty response format provided, ignoring it')
      sanitizedRequest.responseFormat = undefined
    } else {
      const structuredOutputInstructions = generateStructuredOutputInstructions(
        sanitizedRequest.responseFormat
      )

      if (structuredOutputInstructions.trim()) {
        const originalPrompt = sanitizedRequest.systemPrompt || ''
        sanitizedRequest.systemPrompt =
          `${originalPrompt}\n\n${structuredOutputInstructions}`.trim()

        logger.info('Added structured output instructions to system prompt')
      }
    }
  }

  await attachLargeFileRemoteUrls(sanitizedRequest, providerId)
  await uploadLargeFilesToProvider(sanitizedRequest, providerId)

  const response = await runWithProviderRuntimeContext(runtimeContext, () =>
    provider.executeRequest(sanitizedRequest)
  )

  if (isStreamingExecution(response)) {
    logger.info('Provider returned StreamingExecution', { isBYOK })
    applyStreamingCostPolicy(response, resolveModelCostPolicy(sanitizedRequest.model, isBYOK))
    return response
  }

  if (isReadableStream(response)) {
    logger.info('Provider returned ReadableStream')
    return response
  }

  const costPolicy = resolveModelCostPolicy(response.model, isBYOK)

  if (response.tokens) {
    const { input: promptTokens = 0, output: completionTokens = 0 } = response.tokens

    /**
     * Any provider that reports cache buckets also prices itself, because only
     * it knows the tiers involved — Anthropic's 5m vs 1h writes cannot be
     * reconstructed from a single `cacheWrite` count. Its cost is therefore
     * authoritative and only the policy is applied on top. The fallback prices
     * providers that report no cache usage at all.
     *
     * Tool cost is stripped either way: it is re-derived from `toolResults`
     * below and must not be counted twice.
     */
    response.cost = response.cost
      ? (applyModelCostPolicy(withoutToolCost(response.cost), costPolicy) as typeof response.cost)
      : calculateBillableModelCost(response.model, promptTokens, completionTokens, { isBYOK })

    if (!costPolicy.billable) {
      logger.info(
        isBYOK
          ? `Not billing model usage for ${response.model} - workspace BYOK key used`
          : `Not billing model usage for ${response.model} - user provided API key or not hosted model`
      )
    }
  }

  // Per-segment model costs are written by trace enrichers regardless of key
  // provenance. Align them with the block-level decision so the displayed
  // breakdown does not contradict the authoritative block cost.
  if (response.timing?.timeSegments) {
    applySegmentCostPolicy(response.timing.timeSegments, costPolicy)
  }

  const toolCost = sumToolCosts(response.toolResults)
  if (toolCost > 0 && response.cost) {
    // Replaced rather than mutated: a provider-supplied cost can be the same
    // object it also handed to a time segment, and tool cost belongs only to
    // the block total.
    response.cost = {
      ...response.cost,
      toolCost,
      total: response.cost.total + toolCost,
    }
  }

  return response
}
