import { createLogger } from '@sim/logger'
import type { CopilotMessage } from '@/stores/panel/copilot/types'
import { maskCredentialIdsInValue } from './credential-masking'

const logger = createLogger('CopilotMessageSerialization')

export function clearStreamingFlags(toolCall: any): void {
  if (!toolCall) return

  toolCall.subAgentStreaming = false

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
        logger.info('[normalizeMessagesForUI] Loading assistant message', {
          id: message.id,
          hasContent: !!message.content?.trim(),
          contentBlockCount: message.contentBlocks?.length || 0,
          contentBlockTypes: (message.contentBlocks as any[])?.map((b) => b?.type) ?? [],
        })
      }
    }

    for (const message of messages) {
      if (message.contentBlocks) {
        for (const block of message.contentBlocks as any[]) {
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
  } catch {
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
): any[] {
  const result = messages
    .map((msg) => {
      let timestamp: string = msg.timestamp
      if (typeof timestamp !== 'string') {
        const ts = timestamp as any
        timestamp = ts instanceof Date ? ts.toISOString() : new Date().toISOString()
      }

      const serialized: any = {
        id: msg.id,
        role: msg.role,
        content: msg.content || '',
        timestamp,
      }

      if (Array.isArray(msg.contentBlocks) && msg.contentBlocks.length > 0) {
        serialized.contentBlocks = deepClone(msg.contentBlocks)
      }

      if (Array.isArray((msg as any).toolCalls) && (msg as any).toolCalls.length > 0) {
        serialized.toolCalls = deepClone((msg as any).toolCalls)
      }

      if (Array.isArray(msg.fileAttachments) && msg.fileAttachments.length > 0) {
        serialized.fileAttachments = deepClone(msg.fileAttachments)
      }

      if (Array.isArray((msg as any).contexts) && (msg as any).contexts.length > 0) {
        serialized.contexts = deepClone((msg as any).contexts)
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
      logger.info('[serializeMessagesForDB] Input assistant message', {
        id: msg.id,
        hasContent: !!msg.content?.trim(),
        contentBlockCount: msg.contentBlocks?.length || 0,
        contentBlockTypes: (msg.contentBlocks as any[])?.map((b) => b?.type) ?? [],
      })
    }
  }

  logger.info('[serializeMessagesForDB] Serialized messages', {
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
