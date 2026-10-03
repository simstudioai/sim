import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { traceHeaders } from '@/lib/mothership/request/go/propagation'
import { getCopilotTracer } from '@/lib/mothership/request/otel'

/** Links internal CLI HTTP calls to their tool; the span ends at response headers. */
export function createTracedCliTransport(endpoint: string, transport: typeof fetch): typeof fetch {
  const origin = new URL(endpoint).origin
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.origin !== origin) return transport(input, init)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    return getCopilotTracer().startActiveSpan(
      TraceSpan.CopilotCliHttpHeaders,
      {
        kind: SpanKind.CLIENT,
        attributes: { [TraceAttr.HttpMethod]: method, [TraceAttr.HttpPath]: url.pathname },
      },
      async (span) => {
        try {
          const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined)
          )
          for (const [key, value] of Object.entries(traceHeaders())) headers.set(key, value)
          const response = await transport(input, { ...init, headers })
          span.setAttribute(TraceAttr.HttpStatusCode, response.status)
          if (!response.ok) span.setStatus({ code: SpanStatusCode.ERROR })
          return response
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR })
          throw error
        } finally {
          span.end()
        }
      }
    )
  }
}
