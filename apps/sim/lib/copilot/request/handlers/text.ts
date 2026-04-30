import { MothershipStreamV1TextChannel } from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamHandler, ToolScope } from './types'
import {
  addContentBlock,
  flushSubagentThinkingBlock,
  flushThinkingBlock,
  getScopedParentToolCallId,
} from './types'

export function handleTextEvent(scope: ToolScope): StreamHandler {
  return (event, context) => {
    if (event.type !== 'text') {
      return
    }

    const chunk = event.payload.text
    if (!chunk) {
      return
    }

    if (scope === 'subagent') {
      const parentToolCallId = getScopedParentToolCallId(event, context)
      if (!parentToolCallId) return
      if (event.payload.channel === MothershipStreamV1TextChannel.thinking) {
        if (
          context.currentSubagentThinkingBlock &&
          context.currentSubagentThinkingBlock.parentToolCallId !== parentToolCallId
        ) {
          flushSubagentThinkingBlock(context)
        }
        if (!context.currentSubagentThinkingBlock) {
          context.currentSubagentThinkingBlock = {
            type: 'subagent_thinking',
            content: '',
            parentToolCallId,
            timestamp: Date.now(),
          }
        }
        context.currentSubagentThinkingBlock.content = `${context.currentSubagentThinkingBlock.content || ''}${chunk}`
        return
      }
      if (context.currentSubagentThinkingBlock) {
        flushSubagentThinkingBlock(context)
      }
      if (context.isInThinkingBlock) {
        flushThinkingBlock(context)
      }
      context.subAgentContent[parentToolCallId] =
        (context.subAgentContent[parentToolCallId] || '') + chunk
      addContentBlock(context, { type: 'subagent_text', content: chunk, parentToolCallId })
      return
    }

    if (event.payload.channel === MothershipStreamV1TextChannel.thinking) {
      if (!context.currentThinkingBlock) {
        context.currentThinkingBlock = {
          type: 'thinking',
          content: '',
          timestamp: Date.now(),
        }
        context.isInThinkingBlock = true
      }
      context.currentThinkingBlock.content = `${context.currentThinkingBlock.content || ''}${chunk}`
      return
    }

    if (context.isInThinkingBlock) {
      flushThinkingBlock(context)
    }
    context.accumulatedContent += chunk
    addContentBlock(context, { type: 'text', content: chunk })
  }
}
