import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getApiKeyWithBYOK } from '@/lib/api-key/byok'
import { filterModelSafeWorkspaceFileAttachments } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
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
import { isKnownModelId } from '@/providers/models'
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

async function omitUnsafeProviderFileAttachments(
  request: ProviderRequest
): Promise<ProviderRequest> {
  const attachments = (request.messages ?? []).flatMap((message) => message.files ?? [])
  if (attachments.length === 0) return request

  let safeAttachments: typeof attachments
  try {
    safeAttachments = await filterModelSafeWorkspaceFileAttachments(attachments, {
      workspaceId: request.workspaceId,
    })
  } catch (error) {
    logger.error('Workspace file secret provenance could not be verified', {
      attachmentCount: attachments.length,
      error: toError(error).message,
    })
    throw new Error('File attachments could not be verified for model use')
  }

  if (safeAttachments.length === attachments.length) return request
  const safe = new Set(safeAttachments)
  logger.warn('Omitting model attachments with unsafe secret provenance', {
    attachmentCount: attachments.length,
    omittedCount: attachments.length - safeAttachments.length,
  })
  return {
    ...request,
    messages: request.messages?.map((message) => {
      if (!message.files) return message
      const files = message.files.filter((file) => safe.has(file))
      return { ...message, ...(files.length > 0 ? { files } : { files: undefined }) }
    }),
  }
}

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
   * A model absent from the catalogue is unknown, not known-incapable. The model field is an
   * editable combobox, so a model newer than `models.ts` reaches this point routed by pattern
   * and executing normally — discarding its levels on the strength of a list that has not
   * caught up loses a setting the provider would have honoured. Those levels are forwarded and
   * the provider decides. Models the catalogue does know, and every dynamic-provider id, keep
   * the protective drop.
   */
  const isCatalogued = Boolean(model) && isKnownModelId(model)

  if (model && isCatalogued && !supportsReasoningEffort(model)) {
    sanitizedRequest.reasoningEffort = undefined
  }

  if (model && isCatalogued && !supportsVerbosity(model)) {
    sanitizedRequest.verbosity = undefined
  }

  if (model && isCatalogued && !supportsThinking(model)) {
    sanitizedRequest.thinkingLevel = undefined
  }

  if (model && !supportsPromptCaching(model)) {
    sanitizedRequest.promptCaching = undefined
  }

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

  if (
    typeof sanitizedRequest.responseFormat === 'string' &&
    sanitizedRequest.responseFormat === ''
  ) {
    logger.info('Empty response format provided, ignoring it')
    sanitizedRequest.responseFormat = undefined
  }

  const provenanceSafeRequest = await omitUnsafeProviderFileAttachments(sanitizedRequest)
  const modelSafeRequest = provenanceSafeRequest

  if (modelSafeRequest.responseFormat) {
    const structuredOutputInstructions = generateStructuredOutputInstructions(
      modelSafeRequest.responseFormat
    )
    if (structuredOutputInstructions.trim()) {
      const originalPrompt = modelSafeRequest.systemPrompt || ''
      modelSafeRequest.systemPrompt = `${originalPrompt}\n\n${structuredOutputInstructions}`.trim()
      logger.info('Added structured output instructions to system prompt')
    }
  }

  const response = await runWithProviderRuntimeContext(runtimeContext, async () => {
    await attachLargeFileRemoteUrls(modelSafeRequest, providerId)
    await uploadLargeFilesToProvider(modelSafeRequest, providerId)
    return provider.executeRequest(modelSafeRequest)
  })

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
