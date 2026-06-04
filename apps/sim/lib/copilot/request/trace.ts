import type { Context } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import {
  type RequestTraceV1CostSummary,
  RequestTraceV1Outcome,
  type RequestTraceV1SimReport,
  type RequestTraceV1Span,
  RequestTraceV1SpanSource,
  RequestTraceV1SpanStatus,
  type RequestTraceV1UsageSummary,
} from '@/lib/copilot/generated/request-trace-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { env } from '@/lib/core/config/env'

const logger = createLogger('RequestTrace')

export class TraceCollector {
  private readonly spans: RequestTraceV1Span[] = []
  private readonly startMs = Date.now()
  private goTraceId?: string
  private activeSpan?: RequestTraceV1Span

  startSpan(
    name: string,
    kind: string,
    attributes?: Record<string, unknown>,
    parent?: RequestTraceV1Span
  ): RequestTraceV1Span {
    const startMs = Date.now()
    const span: RequestTraceV1Span = {
      name,
      kind,
      startMs,
      endMs: startMs,
      durationMs: 0,
      status: RequestTraceV1SpanStatus.ok,
      source: RequestTraceV1SpanSource.sim,
      ...(parent
        ? { parentName: parent.name }
        : this.activeSpan
          ? { parentName: this.activeSpan.name }
          : {}),
      ...(attributes && Object.keys(attributes).length > 0 ? { attributes } : {}),
    }
    this.spans.push(span)
    return span
  }

  endSpan(
    span: RequestTraceV1Span,
    status: RequestTraceV1SpanStatus | string = RequestTraceV1SpanStatus.ok
  ): void {
    span.endMs = Date.now()
    span.durationMs = span.endMs - span.startMs
    span.status = status as RequestTraceV1SpanStatus
  }

  setActiveSpan(span: RequestTraceV1Span | undefined): void {
    this.activeSpan = span
  }

  setGoTraceId(id: string): void {
    if (!this.goTraceId && id) {
      this.goTraceId = id
    }
  }

  build(params: {
    outcome: RequestTraceV1Outcome
    simRequestId: string
    streamId?: string
    chatId?: string
    runId?: string
    executionId?: string
    // Original user prompt, surfaced on the `request_traces.message`
    // column at row-insert time so it's queryable from the DB without
    // going through Tempo. Sim already has this at chat-POST time; it's
    // threaded through here to the trace report so the row is complete
    // the moment it's first written instead of waiting on the late
    // analytics UPDATE.
    userMessage?: string
    usage?: { prompt: number; completion: number }
    cost?: { input: number; output: number; total: number }
  }): RequestTraceV1SimReport {
    const endMs = Date.now()
    const usage: RequestTraceV1UsageSummary | undefined = params.usage
      ? {
          inputTokens: params.usage.prompt,
          outputTokens: params.usage.completion,
        }
      : undefined

    const cost: RequestTraceV1CostSummary | undefined = params.cost
      ? {
          rawTotalCost: params.cost.total,
          billedTotalCost: params.cost.total,
        }
      : undefined

    return {
      simRequestId: params.simRequestId,
      goTraceId: this.goTraceId,
      streamId: params.streamId,
      chatId: params.chatId,
      runId: params.runId,
      executionId: params.executionId,
      ...(params.userMessage ? { userMessage: params.userMessage } : {}),
      startMs: this.startMs,
      endMs,
      durationMs: endMs - this.startMs,
      outcome: params.outcome,
      usage,
      cost,
      spans: this.spans,
    }
  }
}

export async function reportTrace(
  trace: RequestTraceV1SimReport,
  otelContext?: Context
): Promise<void> {
  const { fetchGo } = await import('@/lib/copilot/request/go/fetch')
  const body = JSON.stringify(trace)
  const response = await fetchGo(`${SIM_AGENT_API_URL}/api/traces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
    },
    body,
    otelContext,
    spanName: 'sim → go /api/traces',
    operation: 'report_trace',
    attributes: {
      [TraceAttr.RequestId]: trace.simRequestId ?? '',
      [TraceAttr.HttpRequestContentLength]: body.length,
      [TraceAttr.CopilotTraceSpanCount]: trace.spans?.length ?? 0,
    },
  })

  if (!response.ok) {
    logger.warn('Failed to report trace', {
      status: response.status,
      simRequestId: trace.simRequestId,
    })
  }
}

export { RequestTraceV1Outcome, RequestTraceV1SpanStatus }
