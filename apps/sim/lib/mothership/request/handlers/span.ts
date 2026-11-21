import { createLogger } from '@sim/logger'
import {
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { StreamHandler } from '@/lib/mothership/request/handlers/types'
import {
  addContentBlock,
  flushSubagentThinkingBlock,
  flushThinkingBlock,
} from '@/lib/mothership/request/handlers/types'
import { subagentSpanData } from '@/lib/mothership/request/session/contract'

const logger = createLogger('MothershipSpan')

/** One lifecycle projection for live frames and replay; completed lanes keep their identity. */
export const handleSpanEvent: StreamHandler = (event, context) => {
  if (event.type !== 'span') {
    return
  }

  const { kind, event: evt, agent: payloadAgent } = event.payload

  if (kind === MothershipStreamV1SpanPayloadKind.subagent) {
    const parentToolCallId = event.scope?.parentToolCallId
    const spanId = event.scope?.spanId
    if (!spanId && !parentToolCallId) {
      logger.warn('Subagent lifecycle frame has no lane identity')
      return
    }
    const agent = payloadAgent || 'task'
    const { name, error } = subagentSpanData(event.payload.data)
    flushSubagentThinkingBlock(context)
    flushThinkingBlock(context)
    const block = context.contentBlocks.find(
      (entry) =>
        entry.type === 'subagent' &&
        (spanId ? entry.spanId === spanId : entry.parentToolCallId === parentToolCallId)
    )
    if (evt === MothershipStreamV1SpanLifecycleEvent.start) {
      if (parentToolCallId) {
        context.subAgentContent[parentToolCallId] ??= ''
        context.subAgentToolCalls[parentToolCallId] ??= []
      }
      if (!block) {
        addContentBlock(context, {
          type: 'subagent',
          content: agent,
          ...(name ? { subagentName: name } : {}),
          ...(parentToolCallId ? { parentToolCallId } : {}),
          ...(spanId ? { spanId } : {}),
          ...(event.scope?.parentSpanId ? { parentSpanId: event.scope.parentSpanId } : {}),
        })
      } else if (name) block.subagentName = name
    } else if (evt === MothershipStreamV1SpanLifecycleEvent.end && block) {
      block.endedAt ??= Date.now()
      if (error) block.error = error
    }
    return
  }
}
