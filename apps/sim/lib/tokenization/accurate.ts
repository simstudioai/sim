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
import {
  getEncoding as createEncoding,
  getEncodingNameForModel,
  type Tiktoken,
  type TiktokenEncoding,
  type TiktokenModel,
} from 'js-tiktoken'
import { LRUCache } from 'lru-cache'

const logger = createLogger('TokenizationAccurate')

/** Keyed by encoding, not model: each instance holds a full rank table, so models share one. */
const encodingCache = new Map<TiktokenEncoding, Tiktoken>()

/** Memory backstop for {@link encodingNameByModel}; model ids are caller-supplied strings. */
const ENCODING_NAME_CACHE_MAX_MODELS = 1_000

/**
 * Model id → encoding name, so a non-OpenAI model does not throw and catch inside
 * `getEncodingNameForModel` on every count.
 */
const encodingNameByModel = new LRUCache<string, TiktokenEncoding>({
  max: ENCODING_NAME_CACHE_MAX_MODELS,
})

/** OpenAI families tokenized with `o200k_base` that `js-tiktoken`'s exact-name table may not list yet. */
const O200K_MODEL_FAMILY = /^(?:gpt-(?:4o|4\.1|4\.5|5|6|oss)|chatgpt-4o|o\d)/

/**
 * The encoding for a model id. Exact OpenAI names resolve through `js-tiktoken`; newer
 * OpenAI ids resolve by family; every other model (Claude, Gemini, …) has no public
 * tiktoken encoding and is approximated with `cl100k_base`.
 */
function resolveEncodingName(modelName: string): TiktokenEncoding {
  const cached = encodingNameByModel.get(modelName)
  if (cached) return cached
  let encodingName: TiktokenEncoding
  try {
    encodingName = getEncodingNameForModel(modelName as TiktokenModel)
  } catch {
    const baseModel = modelName.slice(modelName.lastIndexOf('/') + 1).toLowerCase()
    encodingName = O200K_MODEL_FAMILY.test(baseModel) ? 'o200k_base' : 'cl100k_base'
  }
  encodingNameByModel.set(modelName, encodingName)
  return encodingName
}

function getEncoding(modelName: string): Tiktoken {
  const encodingName = resolveEncodingName(modelName)
  const cached = encodingCache.get(encodingName)
  if (cached) return cached
  const encoding = createEncoding(encodingName)
  encodingCache.set(encodingName, encoding)
  return encoding
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
