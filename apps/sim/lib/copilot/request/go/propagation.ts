import { context, type Context } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

const propagator = new W3CTraceContextPropagator();
const headerSetter = {
  set(carrier: Record<string, string>, key: string, value: string) {
    carrier[key] = value;
  },
};

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
  otelContext?: Context,
): Record<string, string> {
  const headers: Record<string, string> = carrier ?? {};
  propagator.inject(otelContext ?? context.active(), headers, headerSetter);
  return headers;
}
