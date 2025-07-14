/**
 * Streaming-specific tokenization helpers
 */

import { createLogger } from '@/lib/logs/console-logger'
import { calculateStreamingCost } from '@/lib/tokenization/calculators'
import { TOKENIZATION_CONFIG } from '@/lib/tokenization/constants'
import {
  extractTextContent,
  hasRealCostData,
  hasRealTokenData,
  isTokenizableBlockType,
  logTokenizationDetails,
} from '@/lib/tokenization/utils'
import type { BlockLog } from '@/executor/types'

const logger = createLogger('StreamingTokenization')

/**
 * Processes a block log and adds tokenization data if needed
 */
export function processStreamingBlockLog(log: BlockLog, streamedContent: string): boolean {
  // Check if this block should be tokenized
  if (!isTokenizableBlockType(log.blockType)) {
    return false
  }

  // Check if we already have meaningful token/cost data
  if (hasRealTokenData(log.output?.tokens) && hasRealCostData(log.output?.cost)) {
    logger.debug(`Block ${log.blockId} already has real token/cost data`, {
      blockType: log.blockType,
      tokens: log.output?.tokens,
      cost: log.output?.cost,
    })
    return false
  }

  // Check if we have content to tokenize
  if (!streamedContent?.trim()) {
    logger.debug(`Block ${log.blockId} has no content to tokenize`, {
      blockType: log.blockType,
      contentLength: streamedContent?.length || 0,
    })
    return false
  }

  try {
    // Determine model to use
    const model = getModelForBlock(log)

    // Prepare input text from log
    const inputText = extractTextContent(log.input)

    logger.debug(`Starting tokenization for streaming block ${log.blockId}`, {
      blockType: log.blockType,
      model,
      inputLength: inputText.length,
      outputLength: streamedContent.length,
      hasInput: !!log.input,
    })

    // Calculate streaming cost
    const result = calculateStreamingCost(
      model,
      inputText,
      streamedContent,
      log.input?.systemPrompt,
      log.input?.context,
      log.input?.messages
    )

    // Update the log output with tokenization data
    if (!log.output) {
      log.output = {}
    }

    log.output.tokens = result.tokens
    log.output.cost = result.cost
    log.output.model = result.model

    logTokenizationDetails(`Streaming tokenization completed for ${log.blockType}`, {
      blockId: log.blockId,
      blockType: log.blockType,
      model: result.model,
      provider: result.provider,
      inputLength: inputText.length,
      outputLength: streamedContent.length,
      tokens: result.tokens,
      cost: result.cost,
      method: result.method,
    })

    return true
  } catch (error) {
    logger.error(`Streaming tokenization failed for block ${log.blockId}`, {
      blockType: log.blockType,
      error: error instanceof Error ? error.message : String(error),
      contentLength: streamedContent?.length || 0,
    })

    // Don't throw - graceful degradation
    return false
  }
}

/**
 * Determines the appropriate model for a block
 */
function getModelForBlock(log: BlockLog): string {
  // Try to get model from output first
  if (log.output?.model?.trim()) {
    return log.output.model
  }

  // Try to get model from input
  if (log.input?.model?.trim()) {
    return log.input.model
  }

  // Use block type specific defaults
  const blockType = log.blockType
  if (blockType === 'agent' || blockType === 'router' || blockType === 'evaluator') {
    return TOKENIZATION_CONFIG.defaults.model
  }

  // Final fallback
  return TOKENIZATION_CONFIG.defaults.model
}

/**
 * Processes multiple block logs for streaming tokenization
 */
export function processStreamingBlockLogs(
  logs: BlockLog[],
  streamedContentMap: Map<string, string>
): number {
  let processedCount = 0

  logger.debug('Processing streaming block logs for tokenization', {
    totalLogs: logs.length,
    streamedBlocks: streamedContentMap.size,
  })

  for (const log of logs) {
    const content = streamedContentMap.get(log.blockId)
    if (content && processStreamingBlockLog(log, content)) {
      processedCount++
    }
  }

  logger.info(`Streaming tokenization summary`, {
    totalLogs: logs.length,
    processedBlocks: processedCount,
    streamedBlocks: streamedContentMap.size,
  })

  return processedCount
}
