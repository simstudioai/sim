import {
  context,
  SpanStatusCode,
  trace,
  type Context,
} from "@opentelemetry/api";
import { traceHeaders } from "@/lib/copilot/request/go/propagation";

// Lazy tracer resolution: module-level `trace.getTracer()` can be evaluated
// before `instrumentation-node.ts` installs the TracerProvider under
// Next.js 16 + Turbopack dev, freezing a NoOp tracer and silently dropping
// every outbound Sim → Go span. Resolving per-call avoids the race.
const getTracer = () => trace.getTracer("sim-copilot-http", "1.0.0");

export interface OutboundFetchOptions extends RequestInit {
  otelContext?: Context;
  spanName?: string;
  operation?: string;
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Perform an outbound Sim → Go fetch wrapped in an OTel child span so each
 * call shows up as a distinct segment in Jaeger, and propagates the W3C
 * traceparent so the Go-side span joins the same trace.
 *
 * The span captures generic attributes (method, status, duration, response
 * size, error code) so any future latency investigation — not just images or
 * Bedrock — has uniform metadata to work with.
 */
export async function fetchGo(
  url: string,
  options: OutboundFetchOptions = {},
): Promise<Response> {
  const {
    otelContext,
    spanName,
    operation,
    attributes,
    headers: providedHeaders,
    ...init
  } = options;

  const parsed = safeParseUrl(url);
  const pathname = parsed?.pathname ?? url;
  const method = (init.method ?? "GET").toUpperCase();
  const parentContext = otelContext ?? context.active();

  const span = getTracer().startSpan(
    spanName ?? `sim → go ${pathname}`,
    {
      attributes: {
        "http.method": method,
        "http.url": url,
        "http.target": pathname,
        "net.peer.name": parsed?.host ?? "",
        "copilot.leg": "sim_to_go",
        ...(operation ? { "copilot.operation": operation } : {}),
        ...(attributes ?? {}),
      },
    },
    parentContext,
  );

  const activeContext = trace.setSpan(parentContext, span);
  const propagatedHeaders = traceHeaders({}, activeContext);
  const mergedHeaders = {
    ...(providedHeaders as Record<string, string> | undefined),
    ...propagatedHeaders,
  };

  const start = performance.now();
  try {
    const response = await context.with(activeContext, () =>
      fetch(url, {
        ...init,
        method,
        headers: mergedHeaders,
      }),
    );
    const elapsedMs = performance.now() - start;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    span.setAttribute("http.status_code", response.status);
    span.setAttribute("http.response.headers_ms", Math.round(elapsedMs));
    if (contentLength > 0) {
      span.setAttribute("http.response.content_length", contentLength);
    }
    if (response.status >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${response.status}`,
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    return response;
  } catch (error) {
    span.setAttribute(
      "http.response.headers_ms",
      Math.round(performance.now() - start),
    );
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  } finally {
    span.end();
  }
}

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
