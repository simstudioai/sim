import {
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamHandler } from './types'
import { addContentBlock } from './types'

/**
 * Mirror Go-emitted span lifecycle events onto the Sim-side TraceCollector.
 *
 * Go publishes `span` events for subagent lifecycles and structured-result
 * payloads. For subagents, the start/end pair is also used for UI routing
 * elsewhere; here we additionally record a named span on the trace collector
 * so the final RequestTraceV1 report shows the full nested structure without
 * requiring the reader to inspect the raw envelope stream.
 */
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
    const scopeAgent =
      typeof payload.agent === 'string' && payload.agent ? payload.agent : 'subagent'
    // Key by the deterministic spanId so two concurrent runs of the SAME agent
    // (e.g. two parallel `research` subagents) get distinct trace spans. Fall
    // back to agent:parentToolCallId for legacy events that predate span ids.
    const traceKey = event.scope?.spanId || `${scopeAgent}:${event.scope?.parentToolCallId || ''}`
    // Persist the lane's lifecycle markers. Without a `subagent` start block,
    // the transcript parser falls back to grouping lane content by agent NAME
    // — so a respawned agent of the same type (a second concurrent `search`)
    // silently merges into the first one's card and appears "missing" until
    // that one resolves. Keyed and deduped by spanId, so every invocation —
    // including same-type concurrent respawns — gets its own group.
    const startData = payload.data as Record<string, unknown> | undefined
    if (evt === MothershipStreamV1SpanLifecycleEvent.start) {
      context.openSubagentSpans ??= new Set()
      if (!context.openSubagentSpans.has(traceKey)) {
        context.openSubagentSpans.add(traceKey)
        addContentBlock(context, {
          type: 'subagent',
          content: scopeAgent,
          ...(event.scope?.parentToolCallId
            ? { parentToolCallId: event.scope.parentToolCallId }
            : {}),
          ...(event.scope?.spanId ? { spanId: event.scope.spanId } : {}),
          ...(event.scope?.parentSpanId ? { parentSpanId: event.scope.parentSpanId } : {}),
          ...(typeof startData?.name === 'string' && startData.name
            ? { subagentName: startData.name }
            : {}),
        })
      }
    } else if (evt === MothershipStreamV1SpanLifecycleEvent.end) {
      if (context.openSubagentSpans?.has(traceKey)) {
        context.openSubagentSpans.delete(traceKey)
        for (let i = context.contentBlocks.length - 1; i >= 0; i--) {
          const b = context.contentBlocks[i]
          if (
            b.type === 'subagent' &&
            b.endedAt === undefined &&
            (b.spanId || '') === (event.scope?.spanId || '')
          ) {
            b.endedAt = Date.now()
            break
          }
        }
      }
    }
    if (evt === MothershipStreamV1SpanLifecycleEvent.start) {
      const span = context.trace.startSpan(`subagent:${scopeAgent}`, 'go.subagent', {
        agent: scopeAgent,
        parentToolCallId: event.scope?.parentToolCallId,
        spanId: event.scope?.spanId,
      })
      context.subAgentTraceSpans ??= new Map()
      context.subAgentTraceSpans.set(traceKey, span)
    } else if (evt === MothershipStreamV1SpanLifecycleEvent.end) {
      const span = context.subAgentTraceSpans?.get(traceKey)
      if (span) {
        context.trace.endSpan(span, 'ok')
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
