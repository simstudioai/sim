import { type Context, SpanStatusCode } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecordOrNull } from '@sim/utils/object'
import { WORKER_STREAM_IDLE_TIMEOUT_MS } from '@/lib/mothership/constants'
import { MothershipStreamV1EventType } from '@/lib/mothership/generated/mothership-stream-v1'
import { CopilotSseCloseReason } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceEvent } from '@/lib/mothership/generated/trace-events-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import {
  buildPreviewContentUpdate,
  createFilePreviewAdapterState,
  decodeJsonStringPrefix,
  extractEditContent,
  processFilePreviewStreamEvent,
} from '@/lib/mothership/request/go/file-preview-adapter'
import { prepareStreamImages } from '@/lib/mothership/request/go/inline-images'
import {
  FatalSseEventError,
  processSSEStream,
  StreamContinuityError,
} from '@/lib/mothership/request/go/parser'
import { reconcileTextEvent } from '@/lib/mothership/request/go/text-receipt'
import { scopeProviderToolCallEvent } from '@/lib/mothership/request/go/tool-call-identity'
import {
  applyStreamEvent,
  prePersistClientExecutableToolCall,
} from '@/lib/mothership/request/handlers'
import {
  flushSubagentThinkingBlock,
  flushThinkingBlock,
} from '@/lib/mothership/request/handlers/types'
import { getCopilotTracer } from '@/lib/mothership/request/otel'
import {
  AbortReason,
  eventToStreamEvent,
  hasAbortMarker,
  parsePersistedStreamEventEnvelope,
} from '@/lib/mothership/request/session'
import {
  shouldSkipToolCallEvent,
  shouldSkipToolResultEvent,
} from '@/lib/mothership/request/sse-utils'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
} from '@/lib/mothership/request/types'

const logger = createLogger('CopilotGoStream')

export { buildPreviewContentUpdate, decodeJsonStringPrefix, extractEditContent }

export class CopilotBackendError extends Error {
  status?: number
  body?: string

  constructor(message: string, options?: { status?: number; body?: string }) {
    super(message)
    this.name = 'CopilotBackendError'
    this.status = options?.status
    this.body = options?.body
  }
}

const BACKEND_UNAVAILABLE_MESSAGE =
  'The agent service is temporarily unavailable. Please try again.'
const BACKEND_REJECTED_MESSAGE = 'The agent service could not process this request.'

/**
 * The request never reached a worker: the connection failed before any response
 * headers arrived. The network error stays on `cause` for logs.
 */
export class WorkerUnreachableError extends Error {
  constructor(cause: unknown) {
    super(BACKEND_UNAVAILABLE_MESSAGE, { cause })
    this.name = 'WorkerUnreachableError'
  }
}

/**
 * The worker's response body failed mid-stream (the connection was reset or
 * closed). The worker answered, so a retry reattaches under the short budget.
 * The read error stays on `cause` for logs.
 */
export class WorkerStreamInterruptedError extends Error {
  constructor(cause: unknown) {
    super(BACKEND_UNAVAILABLE_MESSAGE, { cause })
    this.name = 'WorkerStreamInterruptedError'
  }
}

/**
 * A worker rejection message the user can act on: short, one line, plain text,
 * and free of identifiers (`userId`, `protocol_version_mismatch`) that only mean
 * something to the code that raised them.
 */
function userFacingRejection(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const message = value.trim()
  if (!message || message.length > 200 || /[<\n]/.test(message)) return undefined
  if (/\b\w*[a-z][A-Z]\w*\b|\b\w+_\w+\b/.test(message)) return undefined
  return message
}

/**
 * What the user is told about a failed backend response. A 5xx or a gateway page
 * is upstream detail and stays on the error for logs; a 4xx may carry the
 * worker's own reason, which is shown when it is safe to.
 */
function backendErrorMessage(status: number, body: string): string {
  if (status >= 500) return BACKEND_UNAVAILABLE_MESSAGE
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return BACKEND_REJECTED_MESSAGE
  }
  // The worker puts its reason in `error`, or a code there and the reason in `message`.
  const record = toRecordOrNull(parsed)
  const reason = record && 'message' in record ? record.message : record?.error
  return userFacingRejection(reason) ?? BACKEND_REJECTED_MESSAGE
}

export class BillingLimitError extends Error {
  /** `member` when the actor hit the cap their organization set, so the card names who can raise it. */
  constructor(
    public readonly userId: string,
    public readonly scope?: 'actor' | 'payer' | 'member'
  ) {
    super('Usage limit reached')
    this.name = 'BillingLimitError'
  }
}

/**
 * Shown to the user when a leg ends early. It must not promise that retrying
 * helps: the backend has already produced its outcome for this leg, and the
 * turn's completed work is persisted by the finalizer.
 */
export const STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE =
  'The assistant stopped before finishing this turn. The work it already completed has been saved — send a message to continue from there.'

/**
 * The SSE body closed after HTTP 200 without a terminal receipt. The durable
 * run may still be active or complete; recovery reuses its identity and delivery
 * position instead of inferring an execution outcome from the connection close.
 */
export class StreamEndedWithoutTerminalError extends Error {
  readonly path: string

  constructor(path: string) {
    super(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)
    this.name = 'StreamEndedWithoutTerminalError'
    this.path = path
  }
}

/** No bytes, keepalives included, arrived from the worker within the idle timeout. */
function workerStreamIdleError(): Error {
  return new Error(`No bytes from the worker in ${WORKER_STREAM_IDLE_TIMEOUT_MS / 1000} s`)
}

/**
 * Options for the shared stream processing loop.
 */
export interface StreamLoopOptions extends OrchestratorOptions {
  /**
   * Called for each normalized event BEFORE standard handler dispatch.
   * Return true to skip the default handler for this event.
   */
  onBeforeDispatch?: (event: StreamEvent, context: StreamingContext) => boolean | undefined
  /**
   * Called when the Go backend's trace ID (go_trace_id) is first received via SSE.
   */
  onGoTraceId?: (goTraceId: string) => void
  otelContext?: Context
}

/**
 * Run the SSE stream processing loop against the Go backend.
 *
 * Handles: fetch -> parse -> normalize -> dedupe -> subagent routing -> handler dispatch.
 * Callers provide the fetch URL/options and can intercept events via onBeforeDispatch.
 * Feature-specific normalization runs through dedicated adapters before the raw event is forwarded.
 *
 * A leg has no wall clock unless the caller sets `timeout`. Its liveness is the
 * worker's own traffic: while Sim waits for response headers or the next bytes,
 * {@link WORKER_STREAM_IDLE_TIMEOUT_MS} of silence fails the leg as unreachable
 * or interrupted, which the caller's retry window re-attaches.
 */
export async function runStreamLoop(
  fetchUrl: string,
  fetchOptions: RequestInit,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: StreamLoopOptions
): Promise<void> {
  const { timeout, abortSignal } = options
  const idle = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const armIdleTimeout = (onIdle?: () => void) => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idle.abort(workerStreamIdleError())
      onIdle?.()
    }, WORKER_STREAM_IDLE_TIMEOUT_MS)
  }
  const requestSignal = AbortSignal.any([
    idle.signal,
    ...(abortSignal ? [abortSignal] : []),
    ...(timeout === undefined ? [] : [AbortSignal.timeout(Math.ceil(timeout))]),
  ])
  const filePreviewAdapterState = createFilePreviewAdapterState()
  const attemptedInlineImages = new Set<string>()

  const pathname = new URL(fetchUrl).pathname
  const requestBodyBytes = estimateBodyBytes(fetchOptions.body)
  const fetchSpan = context.trace.startSpan(`HTTP Request → ${pathname}`, 'sim.http.fetch', {
    url: fetchUrl,
    method: fetchOptions.method ?? 'GET',
    requestBodyBytes,
  })
  const fetchStart = performance.now()
  let response: Response
  armIdleTimeout()
  try {
    response = await fetchGo(fetchUrl, {
      ...fetchOptions,
      signal: requestSignal,
      otelContext: options.otelContext,
      spanName: `sim → go ${pathname}`,
      operation: 'stream',
      attributes: {
        [TraceAttr.CopilotStream]: true,
        ...(requestBodyBytes ? { [TraceAttr.HttpRequestContentLength]: requestBodyBytes } : {}),
      },
    })
  } catch (error) {
    fetchSpan.attributes = {
      ...(fetchSpan.attributes ?? {}),
      headersMs: Math.round(performance.now() - fetchStart),
    }
    context.trace.endSpan(fetchSpan, abortSignal?.aborted ? 'cancelled' : 'error')
    if (idle.signal.aborted) throw new WorkerUnreachableError(idle.signal.reason)
    if (requestSignal.aborted) throw error
    throw new WorkerUnreachableError(error)
  } finally {
    clearTimeout(idleTimer)
  }
  const headersElapsedMs = Math.round(performance.now() - fetchStart)
  fetchSpan.attributes = {
    ...(fetchSpan.attributes ?? {}),
    status: response.status,
    headersMs: headersElapsedMs,
  }

  if (!response.ok) {
    context.trace.endSpan(fetchSpan, 'error')
    // An error body is bounded by the same silence as the leg; a stalled one reads as empty.
    armIdleTimeout()
    const errorText = await new Promise<string>((resolve) => {
      idle.signal.addEventListener('abort', () => resolve(''), { once: true })
      response.text().then(resolve, () => resolve(''))
    }).finally(() => clearTimeout(idleTimer))

    if (response.status === 402) {
      throw new BillingLimitError(execContext.userId)
    }

    throw new CopilotBackendError(backendErrorMessage(response.status, errorText), {
      status: response.status,
      body: errorText || response.statusText,
    })
  }

  if (!response.body) {
    context.trace.endSpan(fetchSpan, 'error')
    throw new CopilotBackendError('Copilot backend response missing body')
  }

  context.trace.endSpan(fetchSpan)

  const bodySpan = context.trace.startSpan(`SSE Body → ${pathname}`, 'sim.http.stream_body', {
    url: fetchUrl,
    method: fetchOptions.method ?? 'GET',
  })

  // Aggregate counters populated inline by the reader wrapper + onEvent
  // dispatcher below and flushed to both the legacy TraceCollector span
  // and the OTel read-loop span when the loop terminates. Kept as plain
  // JS variables (not span attrs) so incrementing them is free — we
  // only pay OTel cost once at span End().
  //
  // Idle-gap tracking is split two ways so we can tell apart
  // upstream-silent from we-were-busy:
  //
  //   - `longestInboundGapMs`: biggest time between consecutive
  //     `reader.read()` calls returning bytes. Upper bound on
  //     "Go silent". Actually also includes Node waiting for main
  //     thread free, so see dispatchMs below.
  //   - `longestDispatchMs`: biggest time any single event handler
  //     took between "event received" and "returned control". Upper
  //     bound on "Sim was CPU-bound on a handler". If this is high
  //     AND inbound gap is high at the same time, it's Sim. If only
  //     inbound gap is high, it's upstream.
  //   - `totalDispatchMs`: sum of all handler times. Helps gauge
  //     whether handlers in aggregate ate a meaningful fraction of
  //     the read loop.
  const counters = {
    bytes: 0,
    chunks: 0,
    events: 0,
    eventsByType: {
      session: 0,
      text: 0,
      tool: 0,
      span: 0,
      resource: 0,
      run: 0,
      error: 0,
      complete: 0,
    } as Record<MothershipStreamV1EventType, number>,
    firstEventMs: undefined as number | undefined,
    lastChunkMs: performance.now(),
    longestInboundGapMs: 0,
    longestDispatchMs: 0,
    totalDispatchMs: 0,
  }
  const bodyStart = performance.now()
  let endedOn: string = CopilotSseCloseReason.Terminal

  // Wrap the body's reader so we can track per-chunk bytes and the gap
  // between chunks. `processSSEStream` consumes this reader exactly as
  // it would the raw one — no API changes there.
  const IDLE_GAP_EVENT_THRESHOLD_MS = 10000
  const rawReader = response.body.getReader()
  const reader: ReadableStreamDefaultReader<Uint8Array> = {
    async read() {
      let result: ReadableStreamReadResult<Uint8Array>
      armIdleTimeout(() => rawReader.cancel(idle.signal.reason).catch(() => {}))
      try {
        result = await rawReader.read()
      } catch (error) {
        if (idle.signal.aborted) {
          endedOn = CopilotSseCloseReason.Timeout
          throw new WorkerStreamInterruptedError(idle.signal.reason)
        }
        if (requestSignal.aborted) throw error
        throw new WorkerStreamInterruptedError(error)
      } finally {
        clearTimeout(idleTimer)
      }
      if (idle.signal.aborted) {
        endedOn = CopilotSseCloseReason.Timeout
        throw new WorkerStreamInterruptedError(idle.signal.reason)
      }
      if (!result.done && result.value) {
        const now = performance.now()
        const gap = now - counters.lastChunkMs
        if (gap > counters.longestInboundGapMs) counters.longestInboundGapMs = gap
        counters.lastChunkMs = now
        counters.chunks += 1
        counters.bytes += result.value.byteLength
      }
      return result
    },
    cancel: (reason) => rawReader.cancel(reason),
    releaseLock: () => rawReader.releaseLock(),
    get closed() {
      return rawReader.closed
    },
  }

  const timeoutId =
    timeout === undefined
      ? undefined
      : setTimeout(() => {
          context.errors.push('Request timed out')
          context.streamComplete = true
          endedOn = CopilotSseCloseReason.Timeout
          reader.cancel().catch(() => {})
        }, timeout)

  try {
    await processSSEStream(reader, abortSignal, async (raw) => {
      // Track how long THIS handler invocation takes so we can tell
      // apart "Go was silent" from "we were CPU-bound on a handler".
      // `longestInboundGapMs` includes handler time (the next reader.read
      // doesn't run until the previous handler returns), so dispatch
      // time is the correction needed to isolate upstream silence.
      const dispatchStart = performance.now()
      try {
        if (counters.events === 0) {
          counters.firstEventMs = Math.round(performance.now() - bodyStart)
        }
        counters.events += 1
        if (abortSignal?.aborted) {
          context.wasAborted = true
          return true
        }

        await options.assertControllerOwnership?.()
        const parsedEvent = parsePersistedStreamEventEnvelope(raw)
        if (!parsedEvent.ok) {
          const detail = [parsedEvent.message, ...(parsedEvent.errors ?? [])]
            .filter(Boolean)
            .join('; ')
          const failureMessage = `Received invalid stream event on shared path: ${detail}`
          context.errors.push(failureMessage)
          logger.error('Received invalid stream event on shared path', {
            reason: parsedEvent.reason,
            detail: parsedEvent.message,
            errors: parsedEvent.errors,
          })
          throw new FatalSseEventError(failureMessage)
        }

        const envelope = parsedEvent.event
        let scopedEvent: ReturnType<typeof eventToStreamEvent>
        try {
          scopedEvent = scopeProviderToolCallEvent(
            eventToStreamEvent(envelope),
            context.providerToolCallIdentity
          )
        } catch (error) {
          throw new FatalSseEventError(getErrorMessage(error))
        }
        const streamEvent = reconcileTextEvent(scopedEvent, context.accumulatedContent)
        if (!streamEvent) return
        if (envelope.trace?.requestId) {
          const goTraceId = envelope.trace.goTraceId || envelope.trace.requestId
          context.trace.setGoTraceId(goTraceId)
          options.onGoTraceId?.(goTraceId)
        }

        // Per-type counters for the copilot.sse.read_loop span. Bound set
        // (8 types) so this can never blow up into high cardinality.
        if (streamEvent.type in counters.eventsByType) {
          counters.eventsByType[streamEvent.type as MothershipStreamV1EventType] += 1
        }

        // Surface the full error payload the moment it arrives on the wire. This
        // is the single chokepoint every error event passes through (main AND
        // subagent lanes), before subagent routing — which has no `error`
        // handler — would otherwise swallow it. The client only renders
        // `message`/`displayMessage`, so log `code`/`provider`/`data` (the raw
        // upstream provider error) here to explain a client-side "Stream error".
        if (streamEvent.type === MothershipStreamV1EventType.error) {
          const errorPayload = streamEvent.payload
          logger.error('Received error event from Go copilot stream', {
            path: pathname,
            lane: streamEvent.scope?.lane ?? 'main',
            parentToolCallId: streamEvent.scope?.parentToolCallId,
            agentId: streamEvent.scope?.agentId,
            code: errorPayload.code,
            provider: errorPayload.provider,
            errorMessage: errorPayload.message,
            error: errorPayload.error,
            displayMessage: errorPayload.displayMessage,
            data: errorPayload.data,
            requestId: context.requestId,
            messageId: context.messageId,
          })
        }

        if (
          shouldSkipToolCallEvent(context, streamEvent) ||
          shouldSkipToolResultEvent(context, streamEvent)
        ) {
          return
        }

        // Presentation only. A throw here abandons the rest of the event, so
        // the tool-call frame never registers its arguments and the call is
        // later dispatched with an empty payload.
        try {
          await processFilePreviewStreamEvent({
            streamId: envelope.stream.streamId,
            streamEvent,
            context,
            execContext,
            options,
            state: filePreviewAdapterState,
          })
        } catch (error) {
          logger.warn('Failed to process file preview stream event', {
            type: streamEvent.type,
            requestId: context.requestId,
            messageId: context.messageId,
            error: getErrorMessage(error),
          })
        }

        await prePersistClientExecutableToolCall(streamEvent, context, options, execContext)

        await prepareStreamImages(
          streamEvent,
          context,
          execContext,
          attemptedInlineImages,
          requestSignal
        )

        if (streamEvent.type === MothershipStreamV1EventType.resource) {
          try {
            await applyStreamEvent(streamEvent, context, execContext, options)
          } catch (error) {
            // No receipt advances past an uncommitted effect. Reattach and replay
            // this tool's saved result instead of silently dropping its panel.
            throw new StreamContinuityError(getErrorMessage(error), { cause: error })
          }
        }

        try {
          await options.onEvent?.(streamEvent)
        } catch (error) {
          if (options.assertControllerOwnership) throw error
          logger.warn('Failed to forward stream event', {
            type: streamEvent.type,
            error: getErrorMessage(error),
          })
        }

        // Yield a macrotask so Node.js flushes the HTTP response buffer to
        // the browser. Microtask yields (await Promise.resolve()) are not
        // enough — the I/O layer needs a full event loop tick to write.
        // Headless legs (no client response attached) opt out via flushAfterEvent.
        if (options.flushAfterEvent !== false) {
          await new Promise<void>((resolve) => setImmediate(resolve))
        }

        if (options.onBeforeDispatch?.(streamEvent, context)) {
          return context.streamComplete || undefined
        }

        if (streamEvent.type !== MothershipStreamV1EventType.resource) {
          await applyStreamEvent(streamEvent, context, execContext, options)
        }
        return context.streamComplete || undefined
      } finally {
        const dispatchMs = performance.now() - dispatchStart
        counters.totalDispatchMs += dispatchMs
        if (dispatchMs > counters.longestDispatchMs) counters.longestDispatchMs = dispatchMs
      }
    })

    if (!context.streamComplete && !abortSignal?.aborted && !context.wasAborted) {
      let abortRequested = false
      try {
        abortRequested = await hasAbortMarker(context.messageId)
      } catch (error) {
        logger.warn('Failed to read abort marker at body close', {
          streamId: context.messageId,
          error: getErrorMessage(error),
        })
      }

      if (abortRequested) {
        options.onAbortObserved?.(AbortReason.MarkerObservedAtBodyClose)
        context.wasAborted = true
        endedOn = CopilotSseCloseReason.Aborted
      } else {
        context.errors.push(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)
        logger.error('Copilot backend stream ended before a terminal event', {
          path: pathname,
          requestId: context.requestId,
          messageId: context.messageId,
        })
        endedOn = CopilotSseCloseReason.ClosedNoTerminal
        throw new StreamEndedWithoutTerminalError(pathname)
      }
    }
  } catch (error) {
    if (error instanceof FatalSseEventError && !context.errors.includes(error.message)) {
      context.errors.push(error.message)
    }
    if (endedOn === CopilotSseCloseReason.Terminal) {
      endedOn =
        error instanceof CopilotBackendError
          ? CopilotSseCloseReason.BackendError
          : error instanceof BillingLimitError
            ? CopilotSseCloseReason.BillingLimit
            : CopilotSseCloseReason.Error
    }
    throw error
  } finally {
    if (abortSignal?.aborted) {
      context.wasAborted = true
      await reader.cancel().catch(() => {})
      if (endedOn === CopilotSseCloseReason.Terminal) {
        endedOn = CopilotSseCloseReason.Aborted
      }
    }
    // An abort or error can tear down the loop mid-thinking. Flush any
    // open thinking blocks so partial-persistence on /chat/stop sees
    // them in contentBlocks with endedAt stamped, instead of silently
    // dropping the in-flight reasoning.
    flushSubagentThinkingBlock(context)
    flushThinkingBlock(context)
    clearTimeout(timeoutId)
    clearTimeout(idleTimer)

    // Legacy TraceCollector span (consumed by the in-memory trace
    // collector, kept for backwards compatibility with existing
    // tooling). The real OTel span is stamped below.
    const bodyDurationMs = Math.round(performance.now() - bodyStart)
    bodySpan.attributes = {
      ...(bodySpan.attributes ?? {}),
      eventsReceived: counters.events,
      firstEventMs: counters.firstEventMs,
      endedOn,
      durationMs: bodyDurationMs,
    }
    context.trace.endSpan(
      bodySpan,
      endedOn === CopilotSseCloseReason.Terminal
        ? 'ok'
        : endedOn === CopilotSseCloseReason.Aborted
          ? 'cancelled'
          : 'error'
    )

    // Real OTel span for Tempo/Grafana. Stamped aggregate-only so
    // there is no per-chunk OTel cost — one span per read loop with
    // integer counters, plus a bounded set of events.
    //
    // `expectedTerminal` = "the caller considered this leg the FINAL
    // leg and genuinely expected a terminal event on the wire." We
    // derive it from `context.streamComplete` MINUS the tool-pause
    // case: when the server emits a `run.checkpoint_pause`, its
    // handler also sets `streamComplete=true` to stop the read loop
    // cleanly, but no `complete` SSE event is ever sent in that
    // case — that's the tool-pause protocol, not a missing terminal.
    // `awaitingAsyncContinuation` is set by the same handler, so
    // its presence distinguishes "tool pause, no terminal expected"
    // from "caller thought stream was done but server never said so"
    // (= the real disappeared-response bug class).
    const expectedTerminal = context.streamComplete && !context.awaitingAsyncContinuation
    stampSseReadLoopSpan(bodyStart, counters, endedOn, fetchUrl, pathname, {
      idleGapEventThresholdMs: IDLE_GAP_EVENT_THRESHOLD_MS,
      expectedTerminal,
    })
  }
}

function estimateBodyBytes(body: BodyInit | null | undefined): number {
  if (!body) {
    return 0
  }
  if (typeof body === 'string') {
    return body.length
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength
  }
  return 0
}

type SseReadLoopCounters = {
  bytes: number
  chunks: number
  events: number
  eventsByType: Record<MothershipStreamV1EventType, number>
  firstEventMs: number | undefined
  longestInboundGapMs: number
  longestDispatchMs: number
  totalDispatchMs: number
}

/**
 * Ship a one-shot `copilot.sse.read_loop` OTel span with the aggregate
 * counters collected during the read loop. Uses `startTime` so the
 * span's duration reflects the actual loop wall clock even though we
 * only talk to OTel once at the end.
 *
 * Deliberately synchronous, no per-chunk span calls: total OTel cost
 * per read loop is fixed (~10 attrs + up to 3 events), independent of
 * chunk count.
 */
function stampSseReadLoopSpan(
  startPerfMs: number,
  counters: SseReadLoopCounters,
  closeReason: string,
  fetchUrl: string,
  pathname: string,
  opts: { idleGapEventThresholdMs: number; expectedTerminal: boolean }
): void {
  // Translate performance.now() values into wall-clock Date values so
  // the span's timestamps land in real time (OTel accepts both, but we
  // need to pair startTime with a matching "now" for .end()).
  const nowPerf = performance.now()
  const nowWall = Date.now()
  const startWall = nowWall - (nowPerf - startPerfMs)

  const terminalEventSeen = counters.eventsByType.complete > 0 || counters.eventsByType.error > 0
  // `terminal_event_missing` is the single-attribute dashboard signal
  // for the "disappeared response" bug class: the caller considered
  // this leg to be the final one (`context.streamComplete === true`)
  // but no terminal `complete` or `error` event arrived on the wire.
  // Tool-pause legs have expectedTerminal=false and never trip this, so
  // dashboards can filter on `{ .copilot.sse.terminal_event_missing = true }`
  // without false positives.
  const terminalEventMissing = opts.expectedTerminal && !terminalEventSeen

  const tracer = getCopilotTracer()
  const span = tracer.startSpan(TraceSpan.CopilotSseReadLoop, {
    startTime: startWall,
    attributes: {
      [TraceAttr.HttpUrl]: fetchUrl,
      [TraceAttr.HttpPath]: pathname,
      [TraceAttr.CopilotSseBytesReceived]: counters.bytes,
      [TraceAttr.CopilotSseChunksReceived]: counters.chunks,
      [TraceAttr.CopilotSseEventsReceived]: counters.events,
      [TraceAttr.CopilotSseEventsSession]: counters.eventsByType.session,
      [TraceAttr.CopilotSseEventsText]: counters.eventsByType.text,
      [TraceAttr.CopilotSseEventsTool]: counters.eventsByType.tool,
      [TraceAttr.CopilotSseEventsSpan]: counters.eventsByType.span,
      [TraceAttr.CopilotSseEventsResource]: counters.eventsByType.resource,
      [TraceAttr.CopilotSseEventsRun]: counters.eventsByType.run,
      [TraceAttr.CopilotSseEventsError]: counters.eventsByType.error,
      [TraceAttr.CopilotSseEventsComplete]: counters.eventsByType.complete,
      [TraceAttr.CopilotSseLongestInboundGapMs]: Math.round(counters.longestInboundGapMs),
      [TraceAttr.CopilotSseLongestDispatchMs]: Math.round(counters.longestDispatchMs),
      [TraceAttr.CopilotSseTotalDispatchMs]: Math.round(counters.totalDispatchMs),
      [TraceAttr.CopilotSseCloseReason]: closeReason,
      [TraceAttr.CopilotSseExpectedTerminal]: opts.expectedTerminal,
      [TraceAttr.CopilotSseTerminalEventSeen]: terminalEventSeen,
      [TraceAttr.CopilotSseTerminalEventMissing]: terminalEventMissing,
    },
  })

  if (counters.firstEventMs !== undefined) {
    span.setAttribute(TraceAttr.CopilotSseFirstEventMs, counters.firstEventMs)
    // Anchor the event to the moment the first SSE event was actually
    // received (startWall + firstEventMs), not `now`, so a trace
    // waterfall shows the diamond at the TTFT point — not at span end.
    span.addEvent(
      TraceEvent.CopilotSseFirstEvent,
      { [TraceAttr.CopilotSseFirstEventMs]: counters.firstEventMs },
      startWall + counters.firstEventMs
    )
  }
  // Fire the idle-gap event when the INBOUND gap (time between TCP
  // reads returning bytes) exceeds the threshold. This is the
  // "upstream was silent or Sim was CPU-bound" signal; dispatch time
  // on its own doesn't warrant an event because it's within our
  // control and visible on a dedicated attribute.
  if (counters.longestInboundGapMs >= opts.idleGapEventThresholdMs) {
    span.addEvent(TraceEvent.CopilotSseIdleGapExceeded, {
      [TraceAttr.CopilotSseLongestInboundGapMs]: Math.round(counters.longestInboundGapMs),
      [TraceAttr.CopilotSseLongestDispatchMs]: Math.round(counters.longestDispatchMs),
    })
  }
  if (terminalEventSeen) {
    span.addEvent(TraceEvent.CopilotSseTerminalEventReceived)
  }

  // Span status: only mark ERROR for real failures. User aborts and
  // clean terminals stay UNSET so dashboards filtering `status=error`
  // don't light up for normal cancellations. Tool-pause legs (caller
  // didn't set streamComplete) are NOT errors even though they have
  // no complete event.
  if (terminalEventMissing) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'SSE read loop finished without terminal event (caller expected one)',
    })
  } else if (
    closeReason !== CopilotSseCloseReason.Terminal &&
    closeReason !== CopilotSseCloseReason.Aborted
  ) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `SSE read loop ended with reason: ${closeReason}`,
    })
  }

  span.end(nowWall)
}
