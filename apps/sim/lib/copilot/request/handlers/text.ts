import {
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { getEventData } from '@/lib/copilot/request/sse-utils'
import type { StreamHandler, ToolScope } from './types'
import { addContentBlock, getScopedParentToolCallId } from './types'

export function handleTextEvent(scope: ToolScope): StreamHandler {
  return (event, context) => {
    const d = getEventData(event)

    if (scope === 'subagent') {
      const parentToolCallId = getScopedParentToolCallId(event, context)
      if (!parentToolCallId || d?.channel !== MothershipStreamV1TextChannel.assistant) return
      const chunk = d?.text as string | undefined
      if (!chunk) return
      context.subAgentContent[parentToolCallId] =
        (context.subAgentContent[parentToolCallId] || '') + chunk
      addContentBlock(context, { type: 'subagent_text', content: chunk })
      return
    }

    if (d?.channel === MothershipStreamV1TextChannel.thinking) {
      const phase = d.phase as string | undefined
      if (phase === MothershipStreamV1SpanLifecycleEvent.start) {
        context.isInThinkingBlock = true
        context.currentThinkingBlock = {
          type: 'thinking',
          content: '',
          timestamp: Date.now(),
        }
        return
      }
      if (phase === MothershipStreamV1SpanLifecycleEvent.end) {
        if (context.currentThinkingBlock) {
          context.contentBlocks.push(context.currentThinkingBlock)
        }
        context.isInThinkingBlock = false
        context.currentThinkingBlock = null
        return
      }
      const chunk = d?.text as string | undefined
      if (!chunk || !context.currentThinkingBlock) return
      context.currentThinkingBlock.content = `${context.currentThinkingBlock.content || ''}${chunk}`
      return
    }

    const chunk = d?.text as string | undefined
    if (!chunk) return
    context.accumulatedContent += chunk
    addContentBlock(context, { type: 'text', content: chunk })
  }
}
