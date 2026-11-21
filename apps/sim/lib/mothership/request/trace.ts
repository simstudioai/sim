/** How a copilot request ended, shared by the lifecycle, finalization and OTel root spans. */
export const RequestTraceOutcome = {
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
} as const

export type RequestTraceOutcome = (typeof RequestTraceOutcome)[keyof typeof RequestTraceOutcome]

export const RequestTraceSpanStatus = {
  ok: 'ok',
  error: 'error',
  cancelled: 'cancelled',
  pending: 'pending',
} as const

export type RequestTraceSpanStatus =
  (typeof RequestTraceSpanStatus)[keyof typeof RequestTraceSpanStatus]

export interface RequestTraceSpan {
  name: string
  kind: string
  startMs: number
  endMs: number
  durationMs: number
  status: RequestTraceSpanStatus
  parentName?: string
  attributes?: Record<string, unknown>
}

export class TraceCollector {
  private readonly spans: RequestTraceSpan[] = []
  private activeSpan?: RequestTraceSpan

  startSpan(
    name: string,
    kind: string,
    attributes?: Record<string, unknown>,
    parent?: RequestTraceSpan
  ): RequestTraceSpan {
    const startMs = Date.now()
    const span: RequestTraceSpan = {
      name,
      kind,
      startMs,
      endMs: startMs,
      durationMs: 0,
      status: RequestTraceSpanStatus.ok,
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
    span: RequestTraceSpan,
    status: RequestTraceSpanStatus | string = RequestTraceSpanStatus.ok
  ): void {
    span.endMs = Date.now()
    span.durationMs = span.endMs - span.startMs
    span.status = status as RequestTraceSpanStatus
  }

  setActiveSpan(span: RequestTraceSpan | undefined): void {
    this.activeSpan = span
  }
}
