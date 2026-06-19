import {
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamHandler } from './types'

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
