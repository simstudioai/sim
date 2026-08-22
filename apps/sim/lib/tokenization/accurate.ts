/**
 * Exact token counting backed by `js-tiktoken`.
 *
 * Split out of `estimators.ts` because `js-tiktoken` embeds every BPE rank table
 * (5.4 MB of source, 2.5 MB over the wire). `estimators.ts` is reached from the
 * workflow editor through `tokenization/index` -> `calculators` -> `estimators`,
 * so a static import there put the whole tokenizer on the critical path of a
 * route that only needs the character-heuristic estimators. Callers that need an
 * exact count import this module directly; nothing re-exports it from the
 * barrel, which is what keeps it out of the shared client chunk.
 */

import { createLogger } from '@sim/logger'
import { encodingForModel, type Tiktoken } from 'js-tiktoken'

const logger = createLogger('TokenizationAccurate')

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
 * Get individual tokens as strings for visualization
 * Returns an array of token strings that can be displayed with colors
 */
export function getTokenStrings(text: string, modelName = 'text-embedding-3-small'): string[] {
  if (!text || text.length === 0) {
    return []
  }

  try {
    const encoding = getEncoding(modelName)
    const tokenIds = encoding.encode(text)

    const textChars = [...text]
    const result: string[] = []
    let prevCharCount = 0

    for (let i = 0; i < tokenIds.length; i++) {
      const decoded = encoding.decode(tokenIds.slice(0, i + 1))
      const currentCharCount = [...decoded].length
      const tokenCharCount = currentCharCount - prevCharCount

      const tokenStr = textChars.slice(prevCharCount, prevCharCount + tokenCharCount).join('')
      result.push(tokenStr)
      prevCharCount = currentCharCount
    }

    return result
  } catch (error) {
    logger.error('Error getting token strings:', error)
    return text.split(/(\s+)/).filter((s) => s.length > 0)
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
