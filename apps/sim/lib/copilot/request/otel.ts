import { randomBytes } from 'crypto'
import {
  type Context,
  context,
  ROOT_CONTEXT,
  type Span,
  type SpanContext,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  trace,
} from '@opentelemetry/api'
import type { RequestTraceV1Outcome } from '@/lib/copilot/generated/request-trace-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { contextFromRequestHeaders } from '@/lib/copilot/request/go/propagation'

/**
 * Reuse the generated RequestTraceV1Outcome string values for every
 * lifecycle outcome field. This keeps our OTel attributes, internal
 * TraceCollector outcomes, and the trace-ingestion wire contract all
 * using the same three strings ("success" | "error" | "cancelled")
 * without scattering the literals through the codebase.
 */
export type CopilotLifecycleOutcome =
  (typeof RequestTraceV1Outcome)[keyof typeof RequestTraceV1Outcome]

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
  return trace.getTracer('sim-ai-platform', '1.0.0')
}

function getTracer() {
  return getCopilotTracer()
}

/**
 * Wrap an inbound Next.js route handler that Go calls into (e.g. billing
 * update-cost, api-key validate) so the Sim-side work shows up as a
 * child of the originating Go span in the same trace.
 *
 * Reads `traceparent` / `tracestate` from the request headers, installs
 * that remote span as the active parent, and starts a server-kind OTel
 * span around `fn`. Any `withCopilotSpan`/`withDbSpan`/etc. call below
 * nests automatically via AsyncLocalStorage.
 *
 * If the request has no trace context (e.g. hand-rolled curl, browser
 * test), this still produces a valid root span for the handler — you
 * just won't see the Go-side parent.
 */
export async function withIncomingGoSpan<T>(
  headers: Headers,
  spanName: string,
  attributes: Record<string, string | number | boolean> | undefined,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const parentContext = contextFromRequestHeaders(headers)
  const tracer = getTracer()
  return tracer.startActiveSpan(
    spanName,
    { kind: SpanKind.SERVER, attributes },
    parentContext,
    async (span) => {
      try {
        const result = await fn(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        })
        span.recordException(error instanceof Error ? error : new Error(String(error)))
        throw error
      } finally {
        span.end()
      }
    }
  )
}

/**
 * Generic helper for wrapping a copilot-lifecycle operation in an OTel
 * span. Use this for post-tool processing, session recovery, subagent
 * orchestration, async-runs DB calls, etc. — anywhere the work is part
 * of a mothership request and we want it reflected in the external OTLP
 * trace.
 *
 * The returned span honors the currently-active OTel context, so it
 * threads under `gen_ai.agent.execute` (or a `tool.execute` parent) if
 * one is live. If there's no active span, it becomes a root — which is
 * almost never what you want; call this from inside a mothership request
 * handler, not from arbitrary background code.
 */
export async function withCopilotSpan<T>(
  spanName: string,
  attributes: Record<string, string | number | boolean> | undefined,
  fn: (span: Span) => Promise<T>,
  /**
   * Optional explicit parent context. Useful when the caller is in a
   * code path where Next.js / Turbopack / multiple awaits can drop the
   * AsyncLocalStorage-tracked context we installed at the top of the
   * request — passing the captured root context explicitly guarantees
   * the new span parents correctly instead of falling back to whatever
   * framework span is currently active (which then gets dropped by our
   * sampler, stranding this span in the trace).
   */
  parentContext?: Context
): Promise<T> {
  const tracer = getTracer()
  const runBody = async (span: Span) => {
    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      })
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      span.end()
    }
  }
  if (parentContext) {
    return tracer.startActiveSpan(spanName, { attributes }, parentContext, runBody)
  }
  return tracer.startActiveSpan(spanName, { attributes }, runBody)
}

/**
 * Run `fn` inside an OTel `tool.execute` span. This mirrors the internal
 * TraceCollector span that already wraps Sim-side tool work, so the
 * external OTLP trace reflects the actual tool execution (the Go side's
 * `tool.execute` is just the async enqueue and stays ~0ms).
 */
export async function withCopilotToolSpan<T>(
  input: {
    toolName: string
    toolCallId: string
    runId?: string
    chatId?: string
    argsBytes?: number
    argsPreview?: string
  },
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const tracer = getTracer()
  return tracer.startActiveSpan(
    `tool.execute ${input.toolName}`,
    {
      attributes: {
        'tool.name': input.toolName,
        'tool.call_id': input.toolCallId,
        'tool.executor': 'sim',
        ...(input.runId ? { 'run.id': input.runId } : {}),
        ...(input.chatId ? { 'chat.id': input.chatId } : {}),
        ...(typeof input.argsBytes === 'number' ? { 'tool.args.bytes': input.argsBytes } : {}),
        ...(input.argsPreview ? { 'tool.args.preview': input.argsPreview } : {}),
      },
    },
    async (span) => {
      try {
        const result = await fn(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        })
        span.recordException(error instanceof Error ? error : new Error(String(error)))
        throw error
      } finally {
        span.end()
      }
    }
  )
}

function isValidSpanContext(spanContext: SpanContext): boolean {
  return (
    /^[0-9a-f]{32}$/.test(spanContext.traceId) &&
    spanContext.traceId !== '00000000000000000000000000000000' &&
    /^[0-9a-f]{16}$/.test(spanContext.spanId) &&
    spanContext.spanId !== '0000000000000000'
  )
}

function createFallbackSpanContext(): SpanContext {
  return {
    traceId: randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
    traceFlags: TraceFlags.SAMPLED,
  }
}

export interface CopilotOtelScope {
  requestId: string
  route?: string
  chatId?: string
  workflowId?: string
  executionId?: string
  runId?: string
  streamId?: string
  transport: 'headless' | 'stream'
}

/**
 * Build the canonical `gen_ai.agent.execute` attribute set from a scope.
 * Shared between `withCopilotOtelContext` (fully-managed lifetime) and
 * `startCopilotOtelRoot` (manually-managed, for handlers that need the
 * span to outlive the synchronous handler body — e.g. SSE routes).
 */
function buildAgentSpanAttributes(
  scope: CopilotOtelScope
): Record<string, string | number | boolean> {
  return {
    'gen_ai.agent.name': 'mothership',
    'gen_ai.agent.id': scope.transport === 'stream' ? 'mothership-stream' : 'mothership-headless',
    'gen_ai.operation.name': scope.transport === 'stream' ? 'chat' : 'invoke_agent',
    'request.id': scope.requestId,
    'sim.request_id': scope.requestId,
    'copilot.route': scope.route ?? '',
    'copilot.transport': scope.transport,
    ...(scope.chatId ? { 'chat.id': scope.chatId } : {}),
    ...(scope.workflowId ? { 'workflow.id': scope.workflowId } : {}),
    ...(scope.executionId ? { 'workflow.execution_id': scope.executionId } : {}),
    ...(scope.runId ? { 'run.id': scope.runId } : {}),
    ...(scope.streamId ? { 'stream.id': scope.streamId } : {}),
  }
}

/**
 * Start a `gen_ai.agent.execute` root span with manually-managed
 * lifetime. Returns the span, its context, and a `finish` callback the
 * caller MUST invoke when the whole request lifecycle is over (including
 * any SSE streaming that outlives the Next.js handler return).
 *
 * Use this for the chat POST handler path:
 *   1. Start the root at the top so `persistUserMessage` and every other
 *      setup span is a child instead of orphaning into a new trace.
 *   2. Pass the context into `createSSEStream` so the stream callback
 *      re-enters it (AsyncLocalStorage does not survive the Next.js
 *      handler return into the ReadableStream runtime).
 *   3. Call `finish()` from the stream's terminal code path.
 *
 * Prefer `withCopilotOtelContext` when the work is fully inside one
 * async function (e.g. headless invoke) — it handles the lifecycle for
 * you.
 */
export interface CopilotOtelRoot {
  span: Span
  context: Context
  finish: (outcome?: CopilotLifecycleOutcome, error?: unknown) => void
}

export function startCopilotOtelRoot(scope: CopilotOtelScope): CopilotOtelRoot {
  // Create gen_ai.agent.execute as a TRUE root span — do not inherit
  // from Next.js's HTTP handler span. The framework span is dropped by
  // our sampler (it has `next.span_type`), so if we parented under it,
  // this span would appear orphaned in Jaeger ("span has missing parent"
  // warning) and any descendant whose AsyncLocalStorage propagation was
  // disrupted would inherit the same dropped parent. Starting from
  // ROOT_CONTEXT gives the mothership lifecycle its own clean trace tree.
  const parentContext = ROOT_CONTEXT
  const span = getTracer().startSpan(
    TraceSpan.GenAiAgentExecute,
    { attributes: buildAgentSpanAttributes(scope) },
    parentContext
  )
  const carrierSpan = isValidSpanContext(span.spanContext())
    ? span
    : trace.wrapSpanContext(createFallbackSpanContext())
  const rootContext = trace.setSpan(parentContext, carrierSpan)

  let finished = false
  const finish: CopilotOtelRoot['finish'] = (outcome, error) => {
    if (finished) return
    finished = true
    span.setAttribute('copilot.request.outcome', outcome)
    if (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      })
      span.recordException(error instanceof Error ? error : new Error(String(error)))
    } else if (outcome === 'success') {
      span.setStatus({ code: SpanStatusCode.OK })
    }
    span.end()
  }

  return { span, context: rootContext, finish }
}

export async function withCopilotOtelContext<T>(
  scope: CopilotOtelScope,
  fn: (otelContext: Context) => Promise<T>
): Promise<T> {
  const parentContext = context.active()
  const span = getTracer().startSpan(
    TraceSpan.GenAiAgentExecute,
    { attributes: buildAgentSpanAttributes(scope) },
    parentContext
  )
  const carrierSpan = isValidSpanContext(span.spanContext())
    ? span
    : trace.wrapSpanContext(createFallbackSpanContext())
  const otelContext = trace.setSpan(parentContext, carrierSpan)
  let sawError = false

  try {
    return await context.with(otelContext, () => fn(otelContext))
  } catch (error) {
    sawError = true
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    })
    span.recordException(error instanceof Error ? error : new Error(String(error)))
    throw error
  } finally {
    if (!sawError) {
      span.setStatus({ code: SpanStatusCode.OK })
    }
    span.end()
  }
}
