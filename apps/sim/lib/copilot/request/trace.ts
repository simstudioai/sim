import {
  type RequestTraceV1CostSummary,
  RequestTraceV1Outcome,
  type RequestTraceV1SimReport,
  type RequestTraceV1Span,
  RequestTraceV1SpanSource,
  RequestTraceV1SpanStatus,
  type RequestTraceV1UsageSummary,
} from '@/lib/copilot/generated/request-trace-v1'

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
    usage?: {
      prompt: number
      completion: number
      cacheAttemptedRequests?: number
      cacheHitRequests?: number
      cacheWriteRequests?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
      cacheSavingsRate?: number
    }
    cost?: { input: number; output: number; total: number }
  }): RequestTraceV1SimReport {
    const endMs = Date.now()
    const usage: RequestTraceV1UsageSummary | undefined = params.usage
      ? {
          inputTokens: params.usage.prompt,
          outputTokens: params.usage.completion,
          cacheAttemptedRequests: params.usage.cacheAttemptedRequests ?? 0,
          cacheHitRequests: params.usage.cacheHitRequests ?? 0,
          cacheWriteRequests: params.usage.cacheWriteRequests ?? 0,
          cacheReadTokens: params.usage.cacheReadTokens ?? 0,
          cacheWriteTokens: params.usage.cacheWriteTokens ?? 0,
          cacheSavingsRate: params.usage.cacheSavingsRate ?? 0,
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

export { RequestTraceV1Outcome, RequestTraceV1SpanStatus }
