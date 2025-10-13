/**
 * Token estimation and accurate counting functions for different providers
 */

import { encodingForModel, type Tiktoken } from 'js-tiktoken'
import { createLogger } from '@/lib/logs/console/logger'
import { MIN_TEXT_LENGTH_FOR_ESTIMATION, TOKENIZATION_CONFIG } from '@/lib/tokenization/constants'
import type { TokenEstimate } from '@/lib/tokenization/types'
import { getProviderConfig } from '@/lib/tokenization/utils'

const logger = createLogger('TokenizationEstimators')

const encodingCache = new Map<string, Tiktoken>()

/**
 * Get or create a cached encoding for a model
 */
function getEncoding(modelName: string): Tiktoken {
  if (encodingCache.has(modelName)) {
    return encodingCache.get(modelName)!
  }

  try {
    const encoding = encodingForModel(modelName as Parameters<typeof encodingForModel>[0])
    encodingCache.set(modelName, encoding)
    return encoding
  } catch (error) {
    logger.warn(`Failed to get encoding for model ${modelName}, falling back to cl100k_base`)
    const encoding = encodingForModel('gpt-4')
    encodingCache.set(modelName, encoding)
    return encoding
  }
}

if (typeof process !== 'undefined') {
  process.on('beforeExit', () => {
    clearEncodingCache()
  })
}

/**
 * Get accurate token count for text using tiktoken
 * This is the exact count OpenAI's API will use
 */
export function getAccurateTokenCount(text: string, modelName = 'text-embedding-3-small'): number {
  if (!text || text.length === 0) {
    return 0
  }

  try {
    const encoding = getEncoding(modelName)
    const tokens = encoding.encode(text)
    return tokens.length
  } catch (error) {
    logger.error('Error counting tokens with tiktoken:', error)
    return Math.ceil(text.length / 4)
  }
}

/**
 * Truncate text to a maximum token count
 * Useful for handling texts that exceed model limits
 */
export function truncateToTokenLimit(
  text: string,
  maxTokens: number,
  modelName = 'text-embedding-3-small'
): string {
  if (!text || maxTokens <= 0) {
    return ''
  }

  try {
    const encoding = getEncoding(modelName)
    const tokens = encoding.encode(text)

    if (tokens.length <= maxTokens) {
      return text
    }

    const truncatedTokens = tokens.slice(0, maxTokens)
    const truncatedText = encoding.decode(truncatedTokens)

    logger.warn(
      `Truncated text from ${tokens.length} to ${maxTokens} tokens (${text.length} to ${truncatedText.length} chars)`
    )

    return truncatedText
  } catch (error) {
    logger.error('Error truncating text:', error)
    const maxChars = maxTokens * 4
    return text.slice(0, maxChars)
  }
}

/**
 * Get token count for multiple texts (for batching decisions)
 * Returns array of token counts in same order as input
 */
export function getTokenCountsForBatch(
  texts: string[],
  modelName = 'text-embedding-3-small'
): number[] {
  return texts.map((text) => getAccurateTokenCount(text, modelName))
}

/**
 * Calculate total tokens across multiple texts
 */
export function getTotalTokenCount(texts: string[], modelName = 'text-embedding-3-small'): number {
  return texts.reduce((total, text) => total + getAccurateTokenCount(text, modelName), 0)
}

/**
 * Batch texts by token count to stay within API limits
 * Returns array of batches where each batch's total tokens <= maxTokensPerBatch
 */
export function batchByTokenLimit(
  texts: string[],
  maxTokensPerBatch: number,
  modelName = 'text-embedding-3-small'
): string[][] {
  const batches: string[][] = []
  let currentBatch: string[] = []
  let currentTokenCount = 0

  for (const text of texts) {
    const tokenCount = getAccurateTokenCount(text, modelName)

    if (tokenCount > maxTokensPerBatch) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch)
        currentBatch = []
        currentTokenCount = 0
      }

      const truncated = truncateToTokenLimit(text, maxTokensPerBatch, modelName)
      batches.push([truncated])
      continue
    }

    if (currentBatch.length > 0 && currentTokenCount + tokenCount > maxTokensPerBatch) {
      batches.push(currentBatch)
      currentBatch = [text]
      currentTokenCount = tokenCount
    } else {
      currentBatch.push(text)
      currentTokenCount += tokenCount
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

/**
 * Clean up cached encodings (call when shutting down)
 */
export function clearEncodingCache(): void {
  encodingCache.clear()
  logger.info('Cleared tiktoken encoding cache')
}

/**
 * Estimates token count for text using provider-specific heuristics
 */
export function estimateTokenCount(text: string, providerId?: string): TokenEstimate {
  if (!text || text.length < MIN_TEXT_LENGTH_FOR_ESTIMATION) {
    return {
      count: 0,
      confidence: 'high',
      provider: providerId || 'unknown',
      method: 'fallback',
    }
  }

  const effectiveProviderId = providerId || TOKENIZATION_CONFIG.defaults.provider
  const config = getProviderConfig(effectiveProviderId)

  let estimatedTokens: number

  switch (effectiveProviderId) {
    case 'openai':
    case 'azure-openai':
      estimatedTokens = estimateOpenAITokens(text)
      break
    case 'anthropic':
      estimatedTokens = estimateAnthropicTokens(text)
      break
    case 'google':
      estimatedTokens = estimateGoogleTokens(text)
      break
    default:
      estimatedTokens = estimateGenericTokens(text, config.avgCharsPerToken)
  }

  return {
    count: Math.max(1, Math.round(estimatedTokens)),
    confidence: config.confidence,
    provider: effectiveProviderId,
    method: 'heuristic',
  }
}

/**
 * OpenAI-specific token estimation using BPE characteristics
 */
function estimateOpenAITokens(text: string): number {
  const words = text.trim().split(/\s+/)
  let tokenCount = 0

  for (const word of words) {
    if (word.length === 0) continue

    if (word.length <= 4) {
      tokenCount += 1
    } else if (word.length <= 8) {
      tokenCount += Math.ceil(word.length / 4.5)
    } else {
      tokenCount += Math.ceil(word.length / 4)
    }

    const punctuationCount = (word.match(/[.,!?;:"'()[\]{}<>]/g) || []).length
    tokenCount += punctuationCount * 0.5
  }

  const newlineCount = (text.match(/\n/g) || []).length
  tokenCount += newlineCount * 0.5

  return tokenCount
}

/**
 * Anthropic Claude-specific token estimation
 */
function estimateAnthropicTokens(text: string): number {
  const words = text.trim().split(/\s+/)
  let tokenCount = 0

  for (const word of words) {
    if (word.length === 0) continue

    if (word.length <= 4) {
      tokenCount += 1
    } else if (word.length <= 8) {
      tokenCount += Math.ceil(word.length / 5)
    } else {
      tokenCount += Math.ceil(word.length / 4.5)
    }
  }

  const newlineCount = (text.match(/\n/g) || []).length
  tokenCount += newlineCount * 0.3

  return tokenCount
}

/**
 * Google Gemini-specific token estimation
 */
function estimateGoogleTokens(text: string): number {
  const words = text.trim().split(/\s+/)
  let tokenCount = 0

  for (const word of words) {
    if (word.length === 0) continue

    if (word.length <= 5) {
      tokenCount += 1
    } else if (word.length <= 10) {
      tokenCount += Math.ceil(word.length / 6)
    } else {
      tokenCount += Math.ceil(word.length / 5)
    }
  }

  return tokenCount
}

/**
 * Generic token estimation fallback
 */
function estimateGenericTokens(text: string, avgCharsPerToken: number): number {
  const charCount = text.trim().length
  return Math.ceil(charCount / avgCharsPerToken)
}

/**
 * Estimates tokens for input content including context
 */
export function estimateInputTokens(
  systemPrompt?: string,
  context?: string,
  messages?: Array<{ role: string; content: string }>,
  providerId?: string
): TokenEstimate {
  let totalText = ''

  if (systemPrompt) {
    totalText += `${systemPrompt}\n`
  }

  if (context) {
    totalText += `${context}\n`
  }

  if (messages) {
    for (const message of messages) {
      totalText += `${message.role}: ${message.content}\n`
    }
  }

  return estimateTokenCount(totalText, providerId)
}

/**
 * Estimates tokens for output content
 */
export function estimateOutputTokens(content: string, providerId?: string): TokenEstimate {
  return estimateTokenCount(content, providerId)
}
