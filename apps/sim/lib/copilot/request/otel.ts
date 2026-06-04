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
import { toError } from '@sim/utils/errors'
import { RequestTraceV1Outcome } from '@/lib/copilot/generated/request-trace-v1'
import {
  CopilotBranchKind,
  CopilotRequestCancelReason,
  type CopilotRequestCancelReasonValue,
  CopilotSurface,
  CopilotTransport,
} from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { contextFromRequestHeaders } from '@/lib/copilot/request/go/propagation'
import { isExplicitStopReason } from '@/lib/copilot/request/session/abort-reason'

// OTel GenAI content-capture env var (spec:
// https://opentelemetry.io/docs/specs/semconv/gen-ai/). Mirrored on
// the Go side so a single var controls both halves.
const GENAI_CAPTURE_ENV = 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'

// OTLP backends commonly reject attrs over 64 KiB; cap proactively.
const GENAI_MESSAGE_ATTR_MAX_BYTES = 60 * 1024

function isGenAIMessageCaptureEnabled(): boolean {
  const raw = (process.env[GENAI_CAPTURE_ENV] || '').toLowerCase().trim()
  return raw === 'true' || raw === '1' || raw === 'yes'
}

// True iff `err` represents the user explicitly clicking Stop — the
// only cancellation we treat as expected (non-error).
//
// Policy across the codebase: an explicit user stop leaves span
// status UNSET; every other cancellation (client tab close,
// network drop, internal timeout, uncategorized abort) escalates
// to `status=error` so it shows up on error dashboards. This is
// the Sim mirror of `requestctx.IsExplicitUserStop` on the Go
// side; keep the two semantically aligned.
//
// Detection modes:
//
//   - Plain-string reject value: `controller.abort('user_stop:...')`
//     rejects fetch() with the reason STRING directly. Matches
//     `isExplicitStopReason()` exactly (UserStop / RedisPoller).
//   - DOMException / Error object: `controller.abort()` with no arg
//     (or older runtimes) rejects with an AbortError whose `.cause`
//     or `.message` may carry the reason. We inspect both.
//
// Anything that doesn't resolve to an explicit-stop reason (plain
// AbortError with no identifiable cause, timeout-flavored aborts,
// arbitrary Error instances) returns false and gets `status=error`.
export function isExplicitUserStopError(err: unknown): boolean {
  if (err == null) return false
  if (typeof err === 'string') return isExplicitStopReason(err)
  if (typeof err === 'object') {
    const e = err as { cause?: unknown; message?: unknown }
    if (isExplicitStopReason(e.cause)) return true
    if (typeof e.message === 'string' && isExplicitStopReason(e.message)) return true
  }
  return false
}

/**
 * True iff an HTTP response status code represents a real server-side
 * problem (5xx) or a user-visible condition we want to alert on
 * (402 Payment Required, 409 Conflict, 429 Too Many Requests).
 *
 * Everything else — in particular the 4xx flood from bot probes and
 * expected auth/validation rejections — stays UNSET on the span so
 * dashboards don't treat normal rejections as errors.
 *
 * Mirrored on the Go side in
 * `copilot/internal/http/middleware/telemetry.go`. Keep the two in
 * sync if you change the actionable set.
 */
export function isActionableErrorStatus(code: number): boolean {
  if (code >= 500) return true
  return code === 402 || code === 409 || code === 429
}

// Record exception + set ERROR unless the error is an explicit user
// stop (see `isExplicitUserStopError`). Every other cancellation —
// client disconnect, internal timeout, uncategorized AbortError —
// becomes a real error that the dashboards will surface.
export function markSpanForError(span: Span, error: unknown): void {
  const asError = toError(error)
  span.recordException(asError)
  if (!isExplicitUserStopError(error)) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: asError.message,
    })
  }
}

// OTel GenAI message shape (kept minimal). Mirror changes on the Go side.
interface GenAIAgentPart {
  type: 'text' | 'tool_call' | 'tool_call_response'
  content?: string
  id?: string
  name?: string
  arguments?: Record<string, unknown>
  response?: string
}

interface GenAIAgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  parts: GenAIAgentPart[]
}

function marshalAgentMessages(messages: GenAIAgentMessage[]): string | undefined {
  if (messages.length === 0) return undefined
  const json = JSON.stringify(messages)
  if (json.length <= GENAI_MESSAGE_ATTR_MAX_BYTES) return json
  // Simple tail-preserving truncation: drop from the front until we
  // fit. Matches the Go side's behavior. The last message is
  // usually the most diagnostic for span-level outcome.
  let remaining = messages.slice()
  while (remaining.length > 1) {
    remaining = remaining.slice(1)
    const candidate = JSON.stringify(remaining)
    if (candidate.length <= GENAI_MESSAGE_ATTR_MAX_BYTES) return candidate
  }
  // Single message still over cap — truncate the text part in place
  // with a marker so the partial content is still readable.
  const only = remaining[0]
  for (const part of only.parts) {
    if (part.type === 'text' && part.content) {
      const headroom = GENAI_MESSAGE_ATTR_MAX_BYTES - 1024
      if (part.content.length > headroom) {
        part.content = `${part.content.slice(0, headroom)}\n\n[truncated: capture cap ${GENAI_MESSAGE_ATTR_MAX_BYTES} bytes]`
      }
    }
  }
  const final = JSON.stringify([only])
  return final.length <= GENAI_MESSAGE_ATTR_MAX_BYTES ? final : undefined
}

interface CopilotAgentInputMessages {
  userMessage?: string
  systemPrompt?: string
}

interface CopilotAgentOutputMessages {
  assistantText?: string
  toolCalls?: Array<{
    id: string
    name: string
    arguments?: Record<string, unknown>
  }>
}

function setAgentInputMessages(span: Span, input: CopilotAgentInputMessages): void {
  if (!isGenAIMessageCaptureEnabled()) return
  const messages: GenAIAgentMessage[] = []
  if (input.systemPrompt) {
    messages.push({
      role: 'system',
      parts: [{ type: 'text', content: input.systemPrompt }],
    })
  }
  if (input.userMessage) {
    messages.push({
      role: 'user',
      parts: [{ type: 'text', content: input.userMessage }],
    })
  }
  const serialized = marshalAgentMessages(messages)
  if (serialized) {
    span.setAttribute(TraceAttr.GenAiInputMessages, serialized)
  }
}

function setAgentOutputMessages(span: Span, output: CopilotAgentOutputMessages): void {
  if (!isGenAIMessageCaptureEnabled()) return
  const parts: GenAIAgentPart[] = []
  if (output.assistantText) {
    parts.push({ type: 'text', content: output.assistantText })
  }
  for (const tc of output.toolCalls ?? []) {
    parts.push({
      type: 'tool_call',
      id: tc.id,
      name: tc.name,
      ...(tc.arguments ? { arguments: tc.arguments } : {}),
    })
  }
  if (parts.length === 0) return
  const serialized = marshalAgentMessages([{ role: 'assistant', parts }])
  if (serialized) {
    span.setAttribute(TraceAttr.GenAiOutputMessages, serialized)
  }
}

export type CopilotLifecycleOutcome =
  (typeof RequestTraceV1Outcome)[keyof typeof RequestTraceV1Outcome]

// Lazy tracer — Next 16/Turbopack can evaluate modules before NodeSDK
// installs the real TracerProvider; resolving per call avoids a
// cached NoOpTracer silently disabling OTel.
export function getCopilotTracer() {
  return trace.getTracer('sim-ai-platform', '1.0.0')
}

function getTracer() {
  return getCopilotTracer()
}

// Wrap an inbound handler that Go called into so its span parents
// under the Go-side trace (via `traceparent`).
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
        markSpanForError(span, error)
        throw error
      } finally {
        span.end()
      }
    }
  )
}

// Wrap a copilot-lifecycle op in an OTel span. Pass `parentContext`
// explicitly when AsyncLocalStorage-tracked context can be dropped
// across multiple awaits (otherwise the child falls back to a framework
// span that the sampler drops).
export async function withCopilotSpan<T>(
  spanName: string,
  attributes: Record<string, string | number | boolean> | undefined,
  fn: (span: Span) => Promise<T>,
  parentContext?: Context
): Promise<T> {
  const tracer = getTracer()
  const runBody = async (span: Span) => {
    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      markSpanForError(span, error)
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

// External OTel `tool.execute` span for Sim-side tool work (the Go
// side's `tool.execute` is just the enqueue, stays ~0ms).
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
        [TraceAttr.ToolName]: input.toolName,
        [TraceAttr.ToolCallId]: input.toolCallId,
        [TraceAttr.ToolExecutor]: 'sim',
        ...(input.runId ? { [TraceAttr.RunId]: input.runId } : {}),
        ...(input.chatId ? { [TraceAttr.ChatId]: input.chatId } : {}),
        ...(typeof input.argsBytes === 'number'
          ? { [TraceAttr.ToolArgsBytes]: input.argsBytes }
          : {}),
        // argsPreview can leak pasted credentials in tool args; gate
        // behind the GenAI content-capture env var.
        ...(input.argsPreview && isGenAIMessageCaptureEnabled()
          ? { [TraceAttr.ToolArgsPreview]: input.argsPreview }
          : {}),
      },
    },
    async (span) => {
      try {
        const result = await fn(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        markSpanForError(span, error)
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

interface CopilotOtelScope {
  // Leave unset on the chat POST — startCopilotOtelRoot will derive
  // from the root span's OTel trace ID (same value Grafana uses).
  // Set explicitly on paths that need a non-trace-derived ID (headless,
  // resume taking an ID from persisted state).
  requestId?: string
  route?: string
  chatId?: string
  workflowId?: string
  executionId?: string
  runId?: string
  streamId?: string
  transport: 'headless' | 'stream'
  userMessagePreview?: string
}

// Dashboard-column width; long enough for triage disambiguation.
const USER_MESSAGE_PREVIEW_MAX_CHARS = 500
function buildAgentSpanAttributes(
  scope: CopilotOtelScope & { requestId: string }
): Record<string, string | number | boolean> {
  // Gated behind the same env var as full GenAI message capture — a
  // 500-char preview is still user prompt content.
  const preview = isGenAIMessageCaptureEnabled()
    ? truncateUserMessagePreview(scope.userMessagePreview)
    : undefined
  return {
    [TraceAttr.GenAiAgentName]: 'mothership',
    [TraceAttr.GenAiAgentId]:
      scope.transport === CopilotTransport.Stream ? 'mothership-stream' : 'mothership-headless',
    [TraceAttr.GenAiOperationName]:
      scope.transport === CopilotTransport.Stream ? 'chat' : 'invoke_agent',
    [TraceAttr.RequestId]: scope.requestId,
    [TraceAttr.SimRequestId]: scope.requestId,
    [TraceAttr.CopilotRoute]: scope.route ?? '',
    [TraceAttr.CopilotTransport]: scope.transport,
    ...(scope.chatId ? { [TraceAttr.ChatId]: scope.chatId } : {}),
    ...(scope.workflowId ? { [TraceAttr.WorkflowId]: scope.workflowId } : {}),
    ...(scope.executionId ? { [TraceAttr.CopilotExecutionId]: scope.executionId } : {}),
    ...(scope.runId ? { [TraceAttr.RunId]: scope.runId } : {}),
    ...(scope.streamId ? { [TraceAttr.StreamId]: scope.streamId } : {}),
    ...(preview ? { [TraceAttr.CopilotUserMessagePreview]: preview } : {}),
  }
}

function truncateUserMessagePreview(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (!collapsed) return undefined
  if (collapsed.length <= USER_MESSAGE_PREVIEW_MAX_CHARS) return collapsed
  return `${collapsed.slice(0, USER_MESSAGE_PREVIEW_MAX_CHARS - 1)}…`
}

// Request-shape metadata known only after branch resolution. Stamped
// on the root span for dashboard filtering.
interface CopilotOtelRequestShape {
  branchKind?: 'workflow' | 'workspace'
  mode?: string
  model?: string
  provider?: string
  createNewChat?: boolean
  prefetch?: boolean
  fileAttachmentsCount?: number
  resourceAttachmentsCount?: number
  contextsCount?: number
  commandsCount?: number
  pendingStreamWaitMs?: number
  interruptedPriorStream?: boolean
}

interface CopilotOtelRoot {
  span: Span
  context: Context
  /**
   * Finalize the root span. `cancelReason`, when provided, decides
   * whether a `cancelled` outcome leaves span status UNSET (for
   * explicit user stops — our single non-error cancel class) or
   * escalates to ERROR (client disconnect, unknown, etc.). Omit it
   * for non-cancellation outcomes.
   */
  finish: (
    outcome?: CopilotLifecycleOutcome,
    error?: unknown,
    cancelReason?: CopilotRequestCancelReasonValue
  ) => void
  setInputMessages: (input: CopilotAgentInputMessages) => void
  setOutputMessages: (output: CopilotAgentOutputMessages) => void
  setRequestShape: (shape: CopilotOtelRequestShape) => void
}

export function startCopilotOtelRoot(
  scope: CopilotOtelScope
): CopilotOtelRoot & { requestId: string } {
  // TRUE root — don't inherit from Next's HTTP handler span (the
  // sampler drops those; we'd orphan the whole mothership tree).
  const parentContext = ROOT_CONTEXT
  // Start with a placeholder `requestId`, then overwrite using the
  // span's actual trace ID so the UI copy-button value pastes
  // directly into Grafana.
  const span = getTracer().startSpan(
    TraceSpan.GenAiAgentExecute,
    { attributes: buildAgentSpanAttributes({ ...scope, requestId: '' }) },
    parentContext
  )
  const carrierSpan = isValidSpanContext(span.spanContext())
    ? span
    : trace.wrapSpanContext(createFallbackSpanContext())
  const spanContext = carrierSpan.spanContext()
  const requestId =
    scope.requestId ??
    (spanContext.traceId && spanContext.traceId.length === 32 ? spanContext.traceId : '')
  span.setAttribute(TraceAttr.RequestId, requestId)
  span.setAttribute(TraceAttr.SimRequestId, requestId)
  const rootContext = trace.setSpan(parentContext, carrierSpan)

  let finished = false
  const finish: CopilotOtelRoot['finish'] = (outcome, error, cancelReason) => {
    if (finished) return
    finished = true
    const resolvedOutcome = outcome ?? RequestTraceV1Outcome.success
    span.setAttribute(TraceAttr.CopilotRequestOutcome, resolvedOutcome)
    // Policy: `explicit_stop` is the ONLY cancellation we treat as
    // expected (status unset → dashboards see it as OK). Everything
    // else — client_disconnect, unknown reason, bug-case cancels —
    // escalates to ERROR so it shows up on error panels.
    const isExplicitStop = cancelReason === CopilotRequestCancelReason.ExplicitStop
    if (error) {
      markSpanForError(span, error)
      if (isExplicitStop || isExplicitUserStopError(error)) {
        span.setStatus({ code: SpanStatusCode.OK })
      }
    } else if (resolvedOutcome === RequestTraceV1Outcome.success) {
      span.setStatus({ code: SpanStatusCode.OK })
    } else if (resolvedOutcome === RequestTraceV1Outcome.cancelled) {
      if (isExplicitStop) {
        span.setStatus({ code: SpanStatusCode.OK })
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `cancelled: ${cancelReason ?? 'unknown'}`,
        })
      }
    }
    span.end()
  }

  return {
    span,
    context: rootContext,
    requestId,
    finish,
    setInputMessages: (input) => setAgentInputMessages(span, input),
    setOutputMessages: (output) => setAgentOutputMessages(span, output),
    setRequestShape: (shape) => applyRequestShape(span, shape),
  }
}

// Pending-stream-lock wait above this = inferred send-to-interrupt.
const INTERRUPT_WAIT_MS_THRESHOLD = 50

function applyRequestShape(span: Span, shape: CopilotOtelRequestShape): void {
  if (shape.branchKind) {
    span.setAttribute(TraceAttr.CopilotBranchKind, shape.branchKind)
    span.setAttribute(
      TraceAttr.CopilotSurface,
      shape.branchKind === CopilotBranchKind.Workflow
        ? CopilotSurface.Copilot
        : CopilotSurface.Mothership
    )
  }
  if (shape.mode) span.setAttribute(TraceAttr.CopilotMode, shape.mode)
  if (shape.model) span.setAttribute(TraceAttr.GenAiRequestModel, shape.model)
  if (shape.provider) span.setAttribute(TraceAttr.GenAiSystem, shape.provider)
  if (typeof shape.createNewChat === 'boolean') {
    span.setAttribute(TraceAttr.CopilotChatIsNew, shape.createNewChat)
  }
  if (typeof shape.prefetch === 'boolean') {
    span.setAttribute(TraceAttr.CopilotPrefetch, shape.prefetch)
  }
  if (typeof shape.fileAttachmentsCount === 'number') {
    span.setAttribute(TraceAttr.CopilotFileAttachmentsCount, shape.fileAttachmentsCount)
  }
  if (typeof shape.resourceAttachmentsCount === 'number') {
    span.setAttribute(TraceAttr.CopilotResourceAttachmentsCount, shape.resourceAttachmentsCount)
  }
  if (typeof shape.contextsCount === 'number') {
    span.setAttribute(TraceAttr.CopilotContextsCount, shape.contextsCount)
  }
  if (typeof shape.commandsCount === 'number') {
    span.setAttribute(TraceAttr.CopilotCommandsCount, shape.commandsCount)
  }
  if (typeof shape.pendingStreamWaitMs === 'number') {
    span.setAttribute(TraceAttr.CopilotPendingStreamWaitMs, shape.pendingStreamWaitMs)
    const interrupted =
      typeof shape.interruptedPriorStream === 'boolean'
        ? shape.interruptedPriorStream
        : shape.pendingStreamWaitMs > INTERRUPT_WAIT_MS_THRESHOLD
    span.setAttribute(TraceAttr.CopilotInterruptedPriorStream, interrupted)
  } else if (typeof shape.interruptedPriorStream === 'boolean') {
    span.setAttribute(TraceAttr.CopilotInterruptedPriorStream, shape.interruptedPriorStream)
  }
}

export async function withCopilotOtelContext<T>(
  scope: CopilotOtelScope,
  fn: (otelContext: Context) => Promise<T>
): Promise<T> {
  const parentContext = context.active()
  // Same trace-id-derives-requestId dance as startCopilotOtelRoot — see
  // that function for the rationale. Stamp a placeholder, read the real
  // trace ID off the span, then overwrite.
  const span = getTracer().startSpan(
    TraceSpan.GenAiAgentExecute,
    { attributes: buildAgentSpanAttributes({ ...scope, requestId: scope.requestId ?? '' }) },
    parentContext
  )
  const carrierSpan = isValidSpanContext(span.spanContext())
    ? span
    : trace.wrapSpanContext(createFallbackSpanContext())
  const spanContext = carrierSpan.spanContext()
  const resolvedRequestId =
    scope.requestId ??
    (spanContext.traceId && spanContext.traceId.length === 32 ? spanContext.traceId : '')
  if (resolvedRequestId) {
    span.setAttribute(TraceAttr.RequestId, resolvedRequestId)
    span.setAttribute(TraceAttr.SimRequestId, resolvedRequestId)
  }
  const otelContext = trace.setSpan(parentContext, carrierSpan)
  let terminalStatusSet = false

  try {
    const result = await context.with(otelContext, () => fn(otelContext))
    span.setStatus({ code: SpanStatusCode.OK })
    terminalStatusSet = true
    return result
  } catch (error) {
    markSpanForError(span, error)
    terminalStatusSet = true
    throw error
  } finally {
    if (!terminalStatusSet) {
      // Extremely defensive: should be unreachable, but avoids leaking
      // an unset span status if some future refactor breaks both arms.
      span.setStatus({ code: SpanStatusCode.OK })
    }
    span.end()
  }
}
