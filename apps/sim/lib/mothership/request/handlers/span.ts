import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
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

const logger = createLogger('MothershipSpan')

/** One lifecycle projection for live frames and replay; completed lanes keep their identity. */
export const handleSpanEvent: StreamHandler = (event, context) => {
  if (event.type !== 'span') {
    return
  }

  const payload = event.payload as {
    kind?: string
    event?: string
    agent?: string
    data?: unknown
  }
  const kind = payload?.kind ?? ''
  const evt = payload?.event ?? ''

  if (kind === MothershipStreamV1SpanPayloadKind.subagent) {
    const data = isRecordLike(payload.data) ? payload.data : undefined
    const parentToolCallId =
      event.scope?.parentToolCallId ??
      (typeof data?.tool_call_id === 'string' ? data.tool_call_id : undefined)
    const spanId = event.scope?.spanId
    const traceKey = spanId ?? parentToolCallId
    if (!traceKey) {
      logger.warn('Subagent lifecycle frame has no lane identity')
      return
    }
    const agent = typeof payload.agent === 'string' && payload.agent ? payload.agent : 'task'
    const name = typeof data?.name === 'string' && data.name ? data.name : undefined
    const error = typeof data?.error === 'string' ? data.error : undefined
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
      if (block?.endedAt !== undefined) return
      context.subAgentTraceSpans ??= new Map()
      if (!context.subAgentTraceSpans.has(traceKey)) {
        context.subAgentTraceSpans.set(
          traceKey,
          context.trace.startSpan(`subagent:${agent}`, 'go.subagent', {
            agent,
            parentToolCallId,
            spanId,
          })
        )
      }
    } else if (evt === MothershipStreamV1SpanLifecycleEvent.end && data?.pending !== true) {
      if (block) {
        block.endedAt ??= Date.now()
        if (error) block.error = error
      }
      const span = context.subAgentTraceSpans?.get(traceKey)
      if (span) {
        context.trace.endSpan(span, error ? 'error' : 'ok')
        context.subAgentTraceSpans?.delete(traceKey)
      }
    }
    return
  }

  if (
    kind === MothershipStreamV1SpanPayloadKind.structured_result ||
    kind === MothershipStreamV1SpanPayloadKind.subagent_result
  ) {
    const span = context.trace.startSpan(`${kind}:${payload.agent ?? 'main'}`, `go.${kind}`, {
      agent: payload.agent,
      hasData: payload.data !== undefined,
    })
    context.trace.endSpan(span, 'ok')
    return
  }
}
