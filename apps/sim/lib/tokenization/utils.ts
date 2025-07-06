/**
 * Utility functions for tokenization
 */

import { createLogger } from '@/lib/logs/console-logger'
import { getProviderFromModel } from '@/providers/utils'
import { LLM_BLOCK_TYPES, MAX_PREVIEW_LENGTH, TOKENIZATION_CONFIG } from './constants'
import { createTokenizationError } from './errors'
import type { ProviderTokenizationConfig, TokenUsage } from './types'

const logger = createLogger('TokenizationUtils')

/**
 * Gets tokenization configuration for a specific provider
 */
export function getProviderConfig(providerId: string): ProviderTokenizationConfig {
  const config =
    TOKENIZATION_CONFIG.providers[providerId as keyof typeof TOKENIZATION_CONFIG.providers]

  if (!config) {
    logger.debug(`No specific config for provider ${providerId}, using fallback`, { providerId })
    return TOKENIZATION_CONFIG.fallback
  }

  return config
}

/**
 * Extracts provider ID from model name
 */
export function getProviderForTokenization(model: string): string {
  try {
    return getProviderFromModel(model)
  } catch (error) {
    logger.warn(`Failed to get provider for model ${model}, using default`, {
      model,
      error: error instanceof Error ? error.message : String(error),
    })
    return TOKENIZATION_CONFIG.defaults.provider
  }
}

/**
 * Checks if a block type should be tokenized
 */
export function isTokenizableBlockType(blockType?: string): boolean {
  if (!blockType) return false
  return LLM_BLOCK_TYPES.includes(blockType as any)
}

/**
 * Checks if tokens/cost data is meaningful (non-zero)
 */
export function hasRealTokenData(tokens?: TokenUsage): boolean {
  if (!tokens) return false
  return tokens.total > 0 || tokens.prompt > 0 || tokens.completion > 0
}

/**
 * Checks if cost data is meaningful (non-zero)
 */
export function hasRealCostData(cost?: {
  total?: number
  input?: number
  output?: number
}): boolean {
  if (!cost) return false
  return (cost.total || 0) > 0 || (cost.input || 0) > 0 || (cost.output || 0) > 0
}

/**
 * Safely extracts text content from various input formats
 */
export function extractTextContent(input: unknown): string {
  if (typeof input === 'string') {
    return input.trim()
  }

  if (input && typeof input === 'object') {
    try {
      return JSON.stringify(input)
    } catch (error) {
      logger.warn('Failed to stringify input object', {
        inputType: typeof input,
        error: error instanceof Error ? error.message : String(error),
      })
      return ''
    }
  }

  return String(input || '')
}

/**
 * Creates a preview of text for logging (truncated)
 */
export function createTextPreview(text: string): string {
  if (text.length <= MAX_PREVIEW_LENGTH) {
    return text
  }
  return `${text.substring(0, MAX_PREVIEW_LENGTH)}...`
}

/**
 * Validates tokenization input
 */
export function validateTokenizationInput(
  model: string,
  inputText: string,
  outputText: string
): void {
  if (!model?.trim()) {
    throw createTokenizationError('INVALID_MODEL', 'Model is required for tokenization', { model })
  }

  if (!inputText?.trim() && !outputText?.trim()) {
    throw createTokenizationError(
      'MISSING_TEXT',
      'Either input text or output text must be provided',
      { inputLength: inputText?.length || 0, outputLength: outputText?.length || 0 }
    )
  }
}

/**
 * Formats token count for display
 */
export function formatTokenCount(count: number): string {
  if (count === 0) return '0'
  if (count < 1000) return count.toString()
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`
  return `${(count / 1000000).toFixed(1)}M`
}

/**
 * Logs tokenization operation details
 */
export function logTokenizationDetails(
  operation: string,
  details: {
    blockId?: string
    blockType?: string
    model?: string
    provider?: string
    inputLength?: number
    outputLength?: number
    tokens?: TokenUsage
    cost?: { input?: number; output?: number; total?: number }
    method?: string
  }
): void {
  logger.info(`${operation}`, {
    blockId: details.blockId,
    blockType: details.blockType,
    model: details.model,
    provider: details.provider,
    inputLength: details.inputLength,
    outputLength: details.outputLength,
    tokens: details.tokens,
    cost: details.cost,
    method: details.method,
  })
}
