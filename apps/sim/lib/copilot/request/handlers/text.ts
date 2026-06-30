import { MothershipStreamV1TextChannel } from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamHandler, ToolScope } from './types'
import {
  addContentBlock,
  flushSubagentThinkingBlock,
  flushThinkingBlock,
  getScopedParentToolCallId,
  getScopedSpanIdentity,
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
      const spanIdentity = getScopedSpanIdentity(event)
      if (event.payload.channel === MothershipStreamV1TextChannel.thinking) {
        // Per-lane thinking: each concurrent subagent accumulates into its own
        // block keyed by parentToolCallId, so interleaved chunks from a sibling
        // subagent never flush or corrupt this lane's reasoning.
        let block = context.subagentThinkingBlocks.get(parentToolCallId)
        if (!block) {
          block = {
            type: 'subagent_thinking',
            content: '',
            parentToolCallId,
            ...spanIdentity,
            timestamp: Date.now(),
          }
          context.subagentThinkingBlocks.set(parentToolCallId, block)
        }
        block.content = `${block.content || ''}${chunk}`
        return
      }
      // Real text for this lane: close this lane's thinking block first so the
      // persisted order is [thinking, text] within the lane.
      flushSubagentThinkingBlock(context, parentToolCallId)
      if (context.isInThinkingBlock) {
        flushThinkingBlock(context)
      }
      context.subAgentContent[parentToolCallId] =
        (context.subAgentContent[parentToolCallId] || '') + chunk
      addContentBlock(context, {
        type: 'subagent_text',
        content: chunk,
        parentToolCallId,
        ...spanIdentity,
      })
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
    context.finalAssistantContent += chunk
    addContentBlock(context, { type: 'text', content: chunk })
  }
}
