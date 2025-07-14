/**
 * Cost calculation functions for tokenization
 */

import { createLogger } from '@/lib/logs/console-logger'
import { createTokenizationError } from '@/lib/tokenization/errors'
import {
  estimateInputTokens,
  estimateOutputTokens,
  estimateTokenCount,
} from '@/lib/tokenization/estimators'
import type {
  CostBreakdown,
  StreamingCostResult,
  TokenizationInput,
  TokenUsage,
} from '@/lib/tokenization/types'
import {
  getProviderForTokenization,
  logTokenizationDetails,
  validateTokenizationInput,
} from '@/lib/tokenization/utils'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('TokenizationCalculators')

/**
 * Calculates cost estimate for streaming execution using token estimation
 */
export function calculateStreamingCost(
  model: string,
  inputText: string,
  outputText: string,
  systemPrompt?: string,
  context?: string,
  messages?: Array<{ role: string; content: string }>
): StreamingCostResult {
  try {
    // Validate inputs
    validateTokenizationInput(model, inputText, outputText)

    const providerId = getProviderForTokenization(model)

    logger.debug('Starting streaming cost calculation', {
      model,
      providerId,
      inputLength: inputText.length,
      outputLength: outputText.length,
      hasSystemPrompt: !!systemPrompt,
      hasContext: !!context,
      hasMessages: !!messages?.length,
    })

    // Estimate input tokens (combine all input sources)
    const inputEstimate = estimateInputTokens(systemPrompt, context, messages, providerId)

    // Add the main input text to the estimation
    const mainInputEstimate = estimateTokenCount(inputText, providerId)
    const totalPromptTokens = inputEstimate.count + mainInputEstimate.count

    // Estimate output tokens
    const outputEstimate = estimateOutputTokens(outputText, providerId)
    const completionTokens = outputEstimate.count

    // Calculate total tokens
    const totalTokens = totalPromptTokens + completionTokens

    // Create token usage object
    const tokens: TokenUsage = {
      prompt: totalPromptTokens,
      completion: completionTokens,
      total: totalTokens,
    }

    // Calculate cost using provider pricing
    const costResult = calculateCost(model, totalPromptTokens, completionTokens, false)

    const cost: CostBreakdown = {
      input: costResult.input,
      output: costResult.output,
      total: costResult.total,
    }

    const result: StreamingCostResult = {
      tokens,
      cost,
      model,
      provider: providerId,
      method: 'tokenization',
    }

    logTokenizationDetails('Streaming cost calculation completed', {
      model,
      provider: providerId,
      inputLength: inputText.length,
      outputLength: outputText.length,
      tokens,
      cost,
      method: 'tokenization',
    })

    return result
  } catch (error) {
    logger.error('Streaming cost calculation failed', {
      model,
      inputLength: inputText?.length || 0,
      outputLength: outputText?.length || 0,
      error: error instanceof Error ? error.message : String(error),
    })

    if (error instanceof Error && error.name === 'TokenizationError') {
      throw error
    }

    throw createTokenizationError(
      'CALCULATION_FAILED',
      `Failed to calculate streaming cost: ${error instanceof Error ? error.message : String(error)}`,
      { model, inputLength: inputText?.length || 0, outputLength: outputText?.length || 0 }
    )
  }
}

/**
 * Calculates cost for tokenization input object
 */
export function calculateTokenizationCost(input: TokenizationInput): StreamingCostResult {
  return calculateStreamingCost(
    input.model,
    input.inputText,
    input.outputText,
    input.systemPrompt,
    input.context,
    input.messages
  )
}

/**
 * Creates a streaming cost result from existing provider response data
 */
export function createCostResultFromProviderData(
  model: string,
  providerTokens: TokenUsage,
  providerCost: CostBreakdown
): StreamingCostResult {
  const providerId = getProviderForTokenization(model)

  return {
    tokens: providerTokens,
    cost: providerCost,
    model,
    provider: providerId,
    method: 'provider_response',
  }
}
