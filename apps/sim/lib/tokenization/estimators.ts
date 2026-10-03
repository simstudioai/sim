/**
 * Character-heuristic token estimation. Exact, tokenizer-backed counting lives
 * in `@/lib/tokenization/accurate`.
 */

import { MIN_TEXT_LENGTH_FOR_ESTIMATION, TOKENIZATION_CONFIG } from '@/lib/tokenization/constants'
import type { TokenEstimate } from '@/lib/tokenization/types'
import { getProviderConfig } from '@/lib/tokenization/utils'

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
    case 'azure-anthropic':
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
