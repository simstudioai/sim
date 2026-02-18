import { createLogger } from '@sim/logger'
import { resolveToolDisplay } from '@/lib/copilot/store-utils'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-display-registry'
import type { CopilotMessage, CopilotToolCall } from '@/stores/panel/copilot/types'
import { maskCredentialIdsInValue } from './credential-masking'

const logger = createLogger('CopilotMessageSerialization')

const TERMINAL_STATES = new Set<string>([
  ClientToolCallState.success,
  ClientToolCallState.error,
  ClientToolCallState.rejected,
  ClientToolCallState.aborted,
  ClientToolCallState.review,
  ClientToolCallState.background,
])

/**
 * Clears streaming flags and normalizes non-terminal tool call states to 'aborted'.
 * This ensures that tool calls loaded from DB after a refresh/abort don't render
 * as in-progress with shimmer animations or interrupt buttons.
 */
export function clearStreamingFlags(toolCall: CopilotToolCall): void {
  if (!toolCall) return

  toolCall.subAgentStreaming = false

  // Normalize non-terminal states when loading from DB.
  // 'executing' → 'success': the server was running it, assume it completed.
  // 'pending'/'generating' → 'aborted': never reached execution.
  if (toolCall.state && !TERMINAL_STATES.has(toolCall.state)) {
    const normalized =
      toolCall.state === ClientToolCallState.executing
        ? ClientToolCallState.success
        : ClientToolCallState.aborted
    toolCall.state = normalized
    toolCall.display = resolveToolDisplay(toolCall.name, normalized, toolCall.id, toolCall.params, toolCall.serverUI)
  }

  if (Array.isArray(toolCall.subAgentBlocks)) {
    for (const block of toolCall.subAgentBlocks) {
      if (block?.type === 'subagent_tool_call' && block.toolCall) {
        clearStreamingFlags(block.toolCall)
      }
    }
  }
  if (Array.isArray(toolCall.subAgentToolCalls)) {
    for (const subTc of toolCall.subAgentToolCalls) {
      clearStreamingFlags(subTc)
    }
  }
}

export function normalizeMessagesForUI(messages: CopilotMessage[]): CopilotMessage[] {
  try {
    for (const message of messages) {
      if (message.role === 'assistant') {
        logger.debug('[normalizeMessagesForUI] Loading assistant message', {
          id: message.id,
          hasContent: !!message.content?.trim(),
          contentBlockCount: message.contentBlocks?.length || 0,
          contentBlockTypes: message.contentBlocks?.map((b) => b?.type) ?? [],
        })
      }
    }

    for (const message of messages) {
      if (message.contentBlocks) {
        for (const block of message.contentBlocks) {
          if (block?.type === 'tool_call' && block.toolCall) {
            clearStreamingFlags(block.toolCall)
          }
        }
      }
      if (message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          clearStreamingFlags(toolCall)
        }
      }
    }
    return messages
  } catch (error) {
    logger.warn('[normalizeMessagesForUI] Failed to normalize messages', {
      error: error instanceof Error ? error.message : String(error),
    })
    return messages
  }
}

export function deepClone<T>(obj: T): T {
  try {
    const json = JSON.stringify(obj)
    if (!json || json === 'undefined') {
      logger.warn('[deepClone] JSON.stringify returned empty for object', {
        type: typeof obj,
        isArray: Array.isArray(obj),
        length: Array.isArray(obj) ? obj.length : undefined,
      })
      return obj
    }
    const parsed = JSON.parse(json)
    if (Array.isArray(obj) && (!Array.isArray(parsed) || parsed.length !== obj.length)) {
      logger.warn('[deepClone] Array clone mismatch', {
        originalLength: obj.length,
        clonedLength: Array.isArray(parsed) ? parsed.length : 'not array',
      })
    }
    return parsed
  } catch (err) {
    logger.error('[deepClone] Failed to clone object', {
      error: String(err),
      type: typeof obj,
      isArray: Array.isArray(obj),
    })
    return obj
  }
}

export function serializeMessagesForDB(
  messages: CopilotMessage[],
  credentialIds: Set<string>
): CopilotMessage[] {
  const result = messages
    .map((msg) => {
      let timestamp: string = msg.timestamp
      if (typeof timestamp !== 'string') {
        const ts = timestamp as unknown
        timestamp = ts instanceof Date ? ts.toISOString() : new Date().toISOString()
      }

      const serialized: CopilotMessage = {
        id: msg.id,
        role: msg.role,
        content: msg.content || '',
        timestamp,
      }

      if (Array.isArray(msg.contentBlocks) && msg.contentBlocks.length > 0) {
        serialized.contentBlocks = deepClone(msg.contentBlocks)
      }

      if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
        serialized.toolCalls = deepClone(msg.toolCalls)
      }

      if (Array.isArray(msg.fileAttachments) && msg.fileAttachments.length > 0) {
        serialized.fileAttachments = deepClone(msg.fileAttachments)
      }

      if (Array.isArray(msg.contexts) && msg.contexts.length > 0) {
        serialized.contexts = deepClone(msg.contexts)
      }

      if (Array.isArray(msg.citations) && msg.citations.length > 0) {
        serialized.citations = deepClone(msg.citations)
      }

      if (msg.errorType) {
        serialized.errorType = msg.errorType
      }

      return maskCredentialIdsInValue(serialized, credentialIds)
    })
    .filter((msg) => {
      if (msg.role === 'assistant') {
        const hasContent = typeof msg.content === 'string' && msg.content.trim().length > 0
        const hasTools = Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0
        const hasBlocks = Array.isArray(msg.contentBlocks) && msg.contentBlocks.length > 0
        return hasContent || hasTools || hasBlocks
      }
      return true
    })

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      logger.debug('[serializeMessagesForDB] Input assistant message', {
        id: msg.id,
        hasContent: !!msg.content?.trim(),
        contentBlockCount: msg.contentBlocks?.length || 0,
        contentBlockTypes: msg.contentBlocks?.map((b) => b?.type) ?? [],
      })
    }
  }

  logger.debug('[serializeMessagesForDB] Serialized messages', {
    inputCount: messages.length,
    outputCount: result.length,
    sample:
      result.length > 0
        ? {
            role: result[result.length - 1].role,
            hasContent: !!result[result.length - 1].content,
            contentBlockCount: result[result.length - 1].contentBlocks?.length || 0,
            toolCallCount: result[result.length - 1].toolCalls?.length || 0,
          }
        : null,
  })

  return result
}
