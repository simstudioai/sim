import { randomBytes } from "crypto";
import {
  context,
  SpanStatusCode,
  TraceFlags,
  trace,
  type Context,
  type Span,
  type SpanContext,
} from "@opentelemetry/api";

/**
 * Resolve the tracer lazily on every call. With Next.js 16 + Turbopack dev
 * bundling, a module-level `trace.getTracer(...)` call can be evaluated
 * before the NodeSDK in `instrumentation-node.ts` installs the real
 * TracerProvider. If that happens, the cached tracer is the NoOpTracer,
 * which produces NoOpSpans whose `.end()` never reaches any processor —
 * silently disabling all OTel on the Sim side. Calling `trace.getTracer`
 * per request ensures we always pick up the currently-registered provider.
 */
export function getCopilotTracer() {
  return trace.getTracer("sim-ai-platform", "1.0.0");
}

function getTracer() {
  return getCopilotTracer();
}

/**
 * Run `fn` inside an OTel `tool.execute` span. This mirrors the internal
 * TraceCollector span that already wraps Sim-side tool work, so the
 * external OTLP trace reflects the actual tool execution (the Go side's
 * `tool.execute` is just the async enqueue and stays ~0ms).
 */
export async function withCopilotToolSpan<T>(
  input: {
    toolName: string;
    toolCallId: string;
    runId?: string;
    chatId?: string;
    argsBytes?: number;
    argsPreview?: string;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(
    `tool.execute ${input.toolName}`,
    {
      attributes: {
        "tool.name": input.toolName,
        "tool.call_id": input.toolCallId,
        "tool.executor": "sim",
        ...(input.runId ? { "run.id": input.runId } : {}),
        ...(input.chatId ? { "chat.id": input.chatId } : {}),
        ...(typeof input.argsBytes === "number"
          ? { "tool.args.bytes": input.argsBytes }
          : {}),
        ...(input.argsPreview ? { "tool.args.preview": input.argsPreview } : {}),
      },
    },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
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
    },
  );
}

function isValidSpanContext(spanContext: SpanContext): boolean {
  return (
    /^[0-9a-f]{32}$/.test(spanContext.traceId) &&
    spanContext.traceId !== "00000000000000000000000000000000" &&
    /^[0-9a-f]{16}$/.test(spanContext.spanId) &&
    spanContext.spanId !== "0000000000000000"
  );
}

function createFallbackSpanContext(): SpanContext {
  return {
    traceId: randomBytes(16).toString("hex"),
    spanId: randomBytes(8).toString("hex"),
    traceFlags: TraceFlags.SAMPLED,
  };
}

export interface CopilotOtelScope {
  requestId: string;
  route?: string;
  chatId?: string;
  workflowId?: string;
  executionId?: string;
  runId?: string;
  streamId?: string;
  transport: "headless" | "stream";
}

export async function withCopilotOtelContext<T>(
  scope: CopilotOtelScope,
  fn: (otelContext: Context) => Promise<T>,
): Promise<T> {
  const parentContext = context.active();
  const span = getTracer().startSpan(
    "gen_ai.agent.execute",
    {
      attributes: {
        "gen_ai.agent.name": "mothership",
        "gen_ai.agent.id":
          scope.transport === "stream"
            ? "mothership-stream"
            : "mothership-headless",
        "gen_ai.operation.name":
          scope.transport === "stream" ? "chat" : "invoke_agent",
        "request.id": scope.requestId,
        "sim.request_id": scope.requestId,
        "copilot.route": scope.route ?? "",
        "copilot.transport": scope.transport,
        ...(scope.chatId ? { "chat.id": scope.chatId } : {}),
        ...(scope.workflowId ? { "workflow.id": scope.workflowId } : {}),
        ...(scope.executionId
          ? { "workflow.execution_id": scope.executionId }
          : {}),
        ...(scope.runId ? { "run.id": scope.runId } : {}),
        ...(scope.streamId ? { "stream.id": scope.streamId } : {}),
      },
    },
    parentContext,
  );
  const carrierSpan = isValidSpanContext(span.spanContext())
    ? span
    : trace.wrapSpanContext(createFallbackSpanContext());
  const otelContext = trace.setSpan(parentContext, carrierSpan);
  let sawError = false;

  try {
    return await context.with(otelContext, () => fn(otelContext));
  } catch (error) {
    sawError = true;
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  } finally {
    if (!sawError) {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  }
}
