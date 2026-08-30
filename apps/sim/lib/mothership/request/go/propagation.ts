import { type Context, context } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'

const propagator = new W3CTraceContextPropagator()
const headerSetter = {
  set(carrier: Record<string, string>, key: string, value: string) {
    carrier[key] = value
  },
}

const headerGetter = {
  keys(carrier: Headers): string[] {
    const out: string[] = []
    carrier.forEach((_, key) => {
      out.push(key)
    })
    return out
  },
  get(carrier: Headers, key: string): string | undefined {
    return carrier.get(key) ?? undefined
  },
}

/**
 * Injects W3C trace context (traceparent, tracestate) into outbound HTTP
 * headers so Go-side spans join the same OTel trace tree as the calling
 * Sim span.
 *
 * Usage: spread the result into your fetch headers:
 *   fetch(url, { headers: { ...myHeaders, ...traceHeaders() } })
 */
export function traceHeaders(
  carrier?: Record<string, string>,
  otelContext?: Context
): Record<string, string> {
  const headers: Record<string, string> = carrier ?? {}
  propagator.inject(otelContext ?? context.active(), headers, headerSetter)
  return headers
}

/**
 * Extracts W3C trace context from incoming request headers (traceparent /
 * tracestate) and returns an OTel Context seeded with the upstream span.
 *
 * Use this at the top of inbound Sim route handlers that Go calls into
 * (e.g. /api/billing/update-cost, /api/copilot/api-keys/validate) so the
 * Sim-side span becomes a proper child of the Go-side client span in the
 * same trace — closing the round trip in Jaeger.
 *
 * When no traceparent is present (e.g. calls from a browser or a client
 * that hasn't been instrumented), this returns `context.active()`
 * unchanged, and any span started under it becomes a new root — the same
 * behavior as before this helper existed.
 */
export function contextFromRequestHeaders(headers: Headers): Context {
  return propagator.extract(context.active(), headers, headerGetter)
}
