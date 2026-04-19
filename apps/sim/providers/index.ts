import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getApiKeyWithBYOK } from '@/lib/api-key/byok'
import { getCostMultiplier } from '@/lib/core/config/feature-flags'
import type { StreamingExecution } from '@/executor/types'
import { getProviderExecutor } from '@/providers/registry'
import type { ProviderId, ProviderRequest, ProviderResponse } from '@/providers/types'
import {
  calculateCost,
  generateStructuredOutputInstructions,
  shouldBillModelUsage,
  sumToolCosts,
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

function sanitizeRequest(request: ProviderRequest): ProviderRequest {
  const sanitizedRequest = { ...request }
  const model = sanitizedRequest.model

  if (model && !supportsTemperature(model)) {
    sanitizedRequest.temperature = undefined
  }

  if (model && !supportsReasoningEffort(model)) {
    sanitizedRequest.reasoningEffort = undefined
  }

  if (model && !supportsVerbosity(model)) {
    sanitizedRequest.verbosity = undefined
  }

  if (model && !supportsThinking(model)) {
    sanitizedRequest.thinkingLevel = undefined
  }

  return sanitizedRequest
}

function isStreamingExecution(response: any): response is StreamingExecution {
  return response && typeof response === 'object' && 'stream' in response && 'execution' in response
}

function isReadableStream(response: any): response is ReadableStream {
  return response instanceof ReadableStream
}

const ZERO_COST = Object.freeze({
  input: 0,
  output: 0,
  total: 0,
  pricing: Object.freeze({ input: 0, output: 0, updatedAt: new Date(0).toISOString() }),
})

/**
 * Prevents streaming callbacks from writing non-zero model cost for BYOK users
 * while preserving tool costs. The property is frozen via defineProperty because
 * providers set cost inside streaming callbacks that fire after this function returns.
 */
function zeroCostForBYOK(response: StreamingExecution): void {
  const output = response.execution?.output
  if (!output || typeof output !== 'object') {
    logger.warn('zeroCostForBYOK: output not available at intercept time; cost may not be zeroed')
    return
  }

  let toolCost = 0
  Object.defineProperty(output, 'cost', {
    get: () => (toolCost > 0 ? { ...ZERO_COST, toolCost, total: toolCost } : ZERO_COST),
    set: (value: Record<string, unknown>) => {
      if (value?.toolCost && typeof value.toolCost === 'number') {
        toolCost = value.toolCost
      }
    },
    configurable: true,
    enumerable: true,
  })
}

export async function executeProviderRequest(
  providerId: string,
  request: ProviderRequest
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

  const response = await provider.executeRequest(sanitizedRequest)

  if (isStreamingExecution(response)) {
    logger.info('Provider returned StreamingExecution', { isBYOK })
    if (isBYOK) {
      zeroCostForBYOK(response)
    }
    return response
  }

  if (isReadableStream(response)) {
    logger.info('Provider returned ReadableStream')
    return response
  }

  if (response.tokens) {
    const { input: promptTokens = 0, output: completionTokens = 0 } = response.tokens
    const useCachedInput = !!request.context && request.context.length > 0

    const shouldBill = shouldBillModelUsage(response.model) && !isBYOK
    if (shouldBill) {
      const costMultiplier = getCostMultiplier()
      response.cost = calculateCost(
        response.model,
        promptTokens,
        completionTokens,
        useCachedInput,
        costMultiplier,
        costMultiplier
      )
    } else {
      response.cost = {
        input: 0,
        output: 0,
        total: 0,
        pricing: {
          input: 0,
          output: 0,
          updatedAt: new Date().toISOString(),
        },
      }
      if (isBYOK) {
        logger.info(`Not billing model usage for ${response.model} - workspace BYOK key used`)
      } else {
        logger.info(
          `Not billing model usage for ${response.model} - user provided API key or not hosted model`
        )
      }
    }
  }

  const toolCost = sumToolCosts(response.toolResults)
  if (toolCost > 0 && response.cost) {
    response.cost.toolCost = toolCost
    response.cost.total += toolCost
  }

  return response
}
