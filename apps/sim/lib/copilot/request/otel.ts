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
import { RequestTraceV1Outcome } from '@/lib/copilot/generated/request-trace-v1'
import {
  CopilotBranchKind,
  CopilotSurface,
} from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { contextFromRequestHeaders } from '@/lib/copilot/request/go/propagation'

/**
 * OTel GenAI experimental semantic conventions env var. When set to a
 * truthy value, each `gen_ai.*` span carries the full input and
 * output conversation content as attributes. Mirrors the Go-side
 * gate in `copilot/internal/providers/telemetry.go` so operators
 * control both halves with one variable.
 *
 * Spec: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
const GENAI_CAPTURE_ENV = 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'

/**
 * Attribute-size cap for `gen_ai.{input,output}.messages`. Most OTLP
 * backends reject attributes larger than ~64 KiB, so we truncate
 * proactively to keep the rest of the span alive if a conversation
 * runs long. Matches the Go-side cap to keep truncation behavior
 * symmetrical between the two halves.
 */
const GENAI_MESSAGE_ATTR_MAX_BYTES = 60 * 1024

function isGenAIMessageCaptureEnabled(): boolean {
  const raw = (process.env[GENAI_CAPTURE_ENV] || '').toLowerCase().trim()
  return raw === 'true' || raw === '1' || raw === 'yes'
}

/**
 * Returns true if `err` is a user-initiated / upstream cancellation
 * rather than a genuine failure. We check every flavor that the
 * JS/Node runtime surfaces when an `AbortSignal` fires:
 *
 *   - `DOMException` with `name === 'AbortError'` (browser + Node 18+ fetch)
 *   - plain `Error` with `name === 'AbortError'` (older polyfills)
 *   - Node's undici-shaped `code === 'ABORT_ERR'`
 *   - Bare `'AbortError'` strings rethrown as errors
 *
 * Callers use this to suppress `SpanStatusCode.ERROR` on cancel paths —
 * dashboards should not light up red every time a user hits Stop.
 * Matches the Go-side treatment of `context.Canceled` /
 * `context.DeadlineExceeded` in `internal/core/errors.go:RecordError`
 * and `internal/storage/postgres/tracing.go:dbSpan.End`.
 */
function isCancellationError(err: unknown): boolean {
  if (err == null) return false
  if (typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown; message?: unknown }
    if (e.name === 'AbortError') return true
    if (e.code === 'ABORT_ERR') return true
    // Some wrappers stringify into the message but lose the name.
    if (typeof e.message === 'string' && /aborted|AbortError/i.test(e.message)) {
      return true
    }
  }
  return false
}

/**
 * Apply terminal status to `span` based on whether the thrown `error`
 * is a real failure or a cancellation. Always records the exception
 * event for forensics; only sets `codes.ERROR` for real failures.
 * Centralized so every span wrapper has identical classification.
 */
function markSpanForError(span: Span, error: unknown): void {
  const asError = error instanceof Error ? error : new Error(String(error))
  span.recordException(asError)
  if (!isCancellationError(error)) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Canonical OTel GenAI message shape used for both input and output
 * attributes. Kept minimal — only the three part types we actually
 * emit: `text`, `tool_call`, and `tool_call_response`. Adding more
 * part types is cheap, but every additional shape here has to be
 * mirrored in the Go serializer.
 */
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

export interface CopilotAgentInputMessages {
  userMessage?: string
  systemPrompt?: string
}

export interface CopilotAgentOutputMessages {
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
        markSpanForError(span, error)
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
        [TraceAttr.ToolName]: input.toolName,
        [TraceAttr.ToolCallId]: input.toolCallId,
        [TraceAttr.ToolExecutor]: 'sim',
        ...(input.runId ? { [TraceAttr.RunId]: input.runId } : {}),
        ...(input.chatId ? { [TraceAttr.ChatId]: input.chatId } : {}),
        ...(typeof input.argsBytes === 'number'
          ? { [TraceAttr.ToolArgsBytes]: input.argsBytes }
          : {}),
        ...(input.argsPreview ? { [TraceAttr.ToolArgsPreview]: input.argsPreview } : {}),
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

export interface CopilotOtelScope {
  /**
   * Optional override for the logical request ID surfaced on
   * `request.id` / `sim.request_id` span attributes. Leave unset on
   * the primary chat POST path — `startCopilotOtelRoot` will derive
   * it from the newly-created root span's OTel trace ID, which is the
   * same 32-hex value that flows through `traceparent` and shows up
   * in Grafana. Pass an explicit value only for paths that need a
   * non-trace-derived identifier (e.g. headless / resume taking an
   * ID from persisted state).
   */
  requestId?: string
  route?: string
  chatId?: string
  workflowId?: string
  executionId?: string
  runId?: string
  streamId?: string
  transport: 'headless' | 'stream'
  /**
   * First ~500 chars of the user's prompt, surfaced as
   * `copilot.user.message_preview` on the root span. Lets dashboards
   * show a "what was this request about" column without having to
   * parse the full `gen_ai.input.messages` JSON attribute (which is
   * also gated on a separate env var). Safe even when full-content
   * capture is off — a preview snippet is useful for operators
   * scanning trace lists, low-risk relative to full prompts.
   */
  userMessagePreview?: string
}

/**
 * Max characters kept in `copilot.user.message_preview`. Chosen to
 * fit in a dashboard table cell without truncation (most Grafana
 * table cells render ~300 chars before wrapping), but long enough
 * to disambiguate requests in triage.
 */
const USER_MESSAGE_PREVIEW_MAX_CHARS = 500

/**
 * Build the canonical `gen_ai.agent.execute` attribute set from a scope.
 * Shared between `withCopilotOtelContext` (fully-managed lifetime) and
 * `startCopilotOtelRoot` (manually-managed, for handlers that need the
 * span to outlive the synchronous handler body — e.g. SSE routes).
 */
function buildAgentSpanAttributes(
  scope: CopilotOtelScope & { requestId: string }
): Record<string, string | number | boolean> {
  const preview = truncateUserMessagePreview(scope.userMessagePreview)
  return {
    'gen_ai.agent.name': 'mothership',
    'gen_ai.agent.id': scope.transport === 'stream' ? 'mothership-stream' : 'mothership-headless',
    'gen_ai.operation.name': scope.transport === 'stream' ? 'chat' : 'invoke_agent',
    // `request.id` and `sim.request_id` intentionally carry the SAME
    // value. For chat POSTs (where scope.requestId is not provided
    // by the caller) this is the OTel trace ID of this root span —
    // meaning the value pasted from the UI's "copy request ID"
    // button works directly in Grafana's trace-ID search box.
    'request.id': scope.requestId,
    'sim.request_id': scope.requestId,
    'copilot.route': scope.route ?? '',
    'copilot.transport': scope.transport,
    ...(scope.chatId ? { 'chat.id': scope.chatId } : {}),
    ...(scope.workflowId ? { 'workflow.id': scope.workflowId } : {}),
    ...(scope.executionId ? { 'workflow.execution_id': scope.executionId } : {}),
    ...(scope.runId ? { 'run.id': scope.runId } : {}),
    ...(scope.streamId ? { 'stream.id': scope.streamId } : {}),
    ...(preview ? { 'copilot.user.message_preview': preview } : {}),
  }
}

/**
 * Collapse newlines and trim the user's prompt to a fixed length so
 * it fits cleanly in a single dashboard table cell. Non-strings are
 * ignored (the chat schema enforces string, but this is defensive
 * against upstream shape changes).
 */
function truncateUserMessagePreview(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (!collapsed) return undefined
  if (collapsed.length <= USER_MESSAGE_PREVIEW_MAX_CHARS) return collapsed
  return `${collapsed.slice(0, USER_MESSAGE_PREVIEW_MAX_CHARS - 1)}…`
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
/**
 * Request-shape metadata that's only known AFTER the branch resolves
 * (can't be set at startCopilotOtelRoot time). Stamped on the root
 * `gen_ai.agent.execute` span so dashboards can slice requests by how
 * they were sent: which product surface, which mode, which model, with
 * attachments or not, and whether the request arrived while a prior
 * stream was still alive (i.e. user hit send-to-interrupt).
 */
export interface CopilotOtelRequestShape {
  /**
   * Product surface. Derived from `branch.kind` — "workflow" means the
   * copilot sidebar (attached to a specific workflow), "workspace"
   * means the mothership workspace-level chat. Also stamped as a
   * human-friendly `copilot.surface` (`copilot` | `mothership`).
   */
  branchKind?: 'workflow' | 'workspace'
  /** Mothership request mode — `agent`, `ask`, `build`, etc. */
  mode?: string
  /** LLM model identifier the caller selected. */
  model?: string
  /** LLM provider the caller selected (`anthropic`, `openai`, …). */
  provider?: string
  /** Whether this POST created a brand-new chat. */
  createNewChat?: boolean
  /** `true` when the caller sent `prefetch: true` (UI speculative send). */
  prefetch?: boolean
  /** How many file attachments were present. */
  fileAttachmentsCount?: number
  /** How many resource attachments (workspace files, knowledge, …). */
  resourceAttachmentsCount?: number
  /** Free-form context blocks the caller attached. */
  contextsCount?: number
  /** Explicit commands (e.g. slash commands) present in the request. */
  commandsCount?: number
  /**
   * Time spent waiting for the per-chat stream lock, in ms. Values
   * above ~50ms strongly imply this request arrived while a prior
   * stream for the same chat was still in flight (i.e. user pressed
   * send-to-interrupt, or a tab refresh overlapped with an active
   * request).
   */
  pendingStreamWaitMs?: number
  /** True if `pendingStreamWaitMs` was non-trivially long. */
  interruptedPriorStream?: boolean
}

export interface CopilotOtelRoot {
  span: Span
  context: Context
  finish: (outcome?: CopilotLifecycleOutcome, error?: unknown) => void
  /**
   * Record `gen_ai.input.messages` on the root agent span. Gated on
   * `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` — no-op when
   * capture is disabled. Safe to call multiple times; the latest
   * call wins.
   */
  setInputMessages: (input: CopilotAgentInputMessages) => void
  /**
   * Record `gen_ai.output.messages` on the root agent span. Gated on
   * the same env var as `setInputMessages`. Typically called from the
   * stream finalize callback once the assistant's final content and
   * invoked tool calls are known.
   */
  setOutputMessages: (output: CopilotAgentOutputMessages) => void
  /**
   * Stamp request-shape attributes that are only known after the
   * branch resolves (mode, provider, model, surface, attachment
   * counts, interrupt signal). Safe to call multiple times — later
   * calls override earlier ones for the same key.
   */
  setRequestShape: (shape: CopilotOtelRequestShape) => void
}

export function startCopilotOtelRoot(
  scope: CopilotOtelScope
): CopilotOtelRoot & { requestId: string } {
  // Create gen_ai.agent.execute as a TRUE root span — do not inherit
  // from Next.js's HTTP handler span. The framework span is dropped by
  // our sampler (it has `next.span_type`), so if we parented under it,
  // this span would appear orphaned in Jaeger ("span has missing parent"
  // warning) and any descendant whose AsyncLocalStorage propagation was
  // disrupted would inherit the same dropped parent. Starting from
  // ROOT_CONTEXT gives the mothership lifecycle its own clean trace tree.
  const parentContext = ROOT_CONTEXT
  // Start the span FIRST with a placeholder requestId, so we can read
  // its actual trace ID and stamp it as the canonical `request.id`.
  // This makes the ID the UI exposes (via `msg.requestId`) identical
  // to the trace ID Grafana uses — one ID, pasteable anywhere. When
  // the caller provided an explicit override (resume / headless /
  // tests) we keep that instead.
  const span = getTracer().startSpan(
    TraceSpan.GenAiAgentExecute,
    { attributes: buildAgentSpanAttributes({ ...scope, requestId: '' }) },
    parentContext
  )
  const carrierSpan = isValidSpanContext(span.spanContext())
    ? span
    : trace.wrapSpanContext(createFallbackSpanContext())
  const spanContext = carrierSpan.spanContext()
  // Derived ID: use the caller's override when given, otherwise the
  // real OTel trace ID. Fall back to an empty string only when OTel
  // itself failed to produce a valid span (shouldn't happen in prod
  // but the carrier branch above already handles that defensively).
  const requestId =
    scope.requestId ??
    (spanContext.traceId && spanContext.traceId.length === 32 ? spanContext.traceId : '')
  // Re-stamp with the resolved ID (overwriting the placeholder empties
  // set above). Cheap — both `request.id` and `sim.request_id` get the
  // same value.
  span.setAttribute('request.id', requestId)
  span.setAttribute('sim.request_id', requestId)
  const rootContext = trace.setSpan(parentContext, carrierSpan)

  let finished = false
  const finish: CopilotOtelRoot['finish'] = (outcome, error) => {
    if (finished) return
    finished = true
    const resolvedOutcome = outcome ?? RequestTraceV1Outcome.success
    span.setAttribute(TraceAttr.CopilotRequestOutcome, resolvedOutcome)
    if (error) {
      // `markSpanForError` records the exception event but only sets
      // `codes.ERROR` for real failures — a cancellation-shaped error
      // here stays `unset` (or `OK` if we resolve it below) so the
      // trace doesn't look red when the user intentionally stopped.
      markSpanForError(span, error)
      if (isCancellationError(error)) {
        span.setStatus({ code: SpanStatusCode.OK })
      }
    } else if (
      resolvedOutcome === RequestTraceV1Outcome.success ||
      resolvedOutcome === RequestTraceV1Outcome.cancelled
    ) {
      // Explicitly mark cancelled outcomes as OK so dashboards keying
      // off span status don't treat "user hit Stop" as a failure — the
      // rich detail lives on `copilot.request.cancel_reason` and the
      // `request.cancelled` event.
      span.setStatus({ code: SpanStatusCode.OK })
    }
    span.end()
  }

  return {
    span,
    context: rootContext,
    // Surface the resolved requestId so callers can thread it through
    // trackers, log prefixes, and persisted `msg.requestId` without
    // having to dig it back out of span attributes.
    requestId,
    finish,
    setInputMessages: (input) => setAgentInputMessages(span, input),
    setOutputMessages: (output) => setAgentOutputMessages(span, output),
    setRequestShape: (shape) => applyRequestShape(span, shape),
  }
}

/**
 * Threshold (ms) above which we consider a pending-stream-lock wait
 * to indicate this request interrupted a prior in-flight stream. Well
 * above the typical uncontested acquire (<10ms) but below any normal
 * human-caused delay. Tuned to flag overlap cases — not perfect, but
 * useful for filtering dashboards.
 */
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
    span.setAttribute('request.id', resolvedRequestId)
    span.setAttribute('sim.request_id', resolvedRequestId)
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
