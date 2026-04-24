import { type Context, SpanStatusCode } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/copilot/constants'
import {
  type MothershipStreamV1EventType,
  MothershipStreamV1SpanLifecycleEvent,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { CopilotSseCloseReason } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceEvent } from '@/lib/copilot/generated/trace-events-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { fetchGo } from '@/lib/copilot/request/go/fetch'
import {
  buildPreviewContentUpdate,
  createFilePreviewAdapterState,
  decodeJsonStringPrefix,
  extractEditContent,
  processFilePreviewStreamEvent,
} from '@/lib/copilot/request/go/file-preview-adapter'
import { FatalSseEventError, processSSEStream } from '@/lib/copilot/request/go/parser'
import {
  handleSubagentRouting,
  prePersistClientExecutableToolCall,
  sseHandlers,
  subAgentHandlers,
} from '@/lib/copilot/request/handlers'
import {
  flushSubagentThinkingBlock,
  flushThinkingBlock,
} from '@/lib/copilot/request/handlers/types'
import { getCopilotTracer } from '@/lib/copilot/request/otel'
import {
  eventToStreamEvent,
  isSubagentSpanStreamEvent,
  parsePersistedStreamEventEnvelope,
} from '@/lib/copilot/request/session'
import { shouldSkipToolCallEvent, shouldSkipToolResultEvent } from '@/lib/copilot/request/sse-utils'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  StreamingContext,
} from '@/lib/copilot/request/types'

const logger = createLogger('CopilotGoStream')

export { buildPreviewContentUpdate, decodeJsonStringPrefix, extractEditContent }

type JsonRecord = Record<string, unknown>

type SubagentSpanData = {
  pending?: boolean
  toolCallId?: string
}

function asJsonRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

function parseSubagentSpanData(value: unknown): SubagentSpanData | undefined {
  const data = asJsonRecord(value)
  if (!data) {
    return undefined
  }

  const toolCallId = typeof data.tool_call_id === 'string' ? data.tool_call_id : undefined
  const pending = typeof data.pending === 'boolean' ? data.pending : undefined

  return {
    ...(toolCallId ? { toolCallId } : {}),
    ...(pending !== undefined ? { pending } : {}),
  }
}

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

export class BillingLimitError extends Error {
  constructor(public readonly userId: string) {
    super('Usage limit reached')
    this.name = 'BillingLimitError'
  }
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
 */
export async function runStreamLoop(
  fetchUrl: string,
  fetchOptions: RequestInit,
  context: StreamingContext,
  execContext: ExecutionContext,
  options: StreamLoopOptions
): Promise<void> {
  const { timeout = ORCHESTRATION_TIMEOUT_MS, abortSignal } = options
  const filePreviewAdapterState = createFilePreviewAdapterState()

  const pathname = new URL(fetchUrl).pathname
  const requestBodyBytes = estimateBodyBytes(fetchOptions.body)
  const fetchSpan = context.trace.startSpan(`HTTP Request → ${pathname}`, 'sim.http.fetch', {
    url: fetchUrl,
    method: fetchOptions.method ?? 'GET',
    requestBodyBytes,
  })
  const fetchStart = performance.now()
  let response: Response
  try {
    response = await fetchGo(fetchUrl, {
      ...fetchOptions,
      signal: abortSignal,
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
    throw error
  }
  const headersElapsedMs = Math.round(performance.now() - fetchStart)
  fetchSpan.attributes = {
    ...(fetchSpan.attributes ?? {}),
    status: response.status,
    headersMs: headersElapsedMs,
  }

  if (!response.ok) {
    context.trace.endSpan(fetchSpan, 'error')
    const errorText = await response.text().catch(() => '')

    if (response.status === 402) {
      throw new BillingLimitError(execContext.userId)
    }

    throw new CopilotBackendError(
      `Copilot backend error (${response.status}): ${errorText || response.statusText}`,
      { status: response.status, body: errorText || response.statusText }
    )
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
      const result = await rawReader.read()
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
  const decoder = new TextDecoder()

  const timeoutId = setTimeout(() => {
    context.errors.push('Request timed out')
    context.streamComplete = true
    endedOn = CopilotSseCloseReason.Timeout
    reader.cancel().catch(() => {})
  }, timeout)

  try {
    await processSSEStream(reader, decoder, abortSignal, async (raw) => {
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

        const parsedEvent = parsePersistedStreamEventEnvelope(raw)
        if (!parsedEvent.ok) {
          const detail = [parsedEvent.message, ...(parsedEvent.errors ?? [])]
            .filter(Boolean)
            .join('; ')
          const failureMessage = `Received invalid stream event on shared path: ${detail}`
          context.errors.push(failureMessage)
          logger.error('Received invalid stream event on shared path', {
            reason: parsedEvent.reason,
            message: parsedEvent.message,
            errors: parsedEvent.errors,
          })
          throw new FatalSseEventError(failureMessage)
        }

        const envelope = parsedEvent.event
        const streamEvent = eventToStreamEvent(envelope)
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

        if (shouldSkipToolCallEvent(streamEvent) || shouldSkipToolResultEvent(streamEvent)) {
          return
        }

        await processFilePreviewStreamEvent({
          streamId: envelope.stream.streamId,
          streamEvent,
          context,
          execContext,
          options,
          state: filePreviewAdapterState,
        })

        await prePersistClientExecutableToolCall(streamEvent, context)

        try {
          await options.onEvent?.(streamEvent)
        } catch (error) {
          logger.warn('Failed to forward stream event', {
            type: streamEvent.type,
            error: error instanceof Error ? error.message : String(error),
          })
        }

        // Yield a macrotask so Node.js flushes the HTTP response buffer to
        // the browser. Microtask yields (await Promise.resolve()) are not
        // enough — the I/O layer needs a full event loop tick to write.
        await new Promise<void>((resolve) => setImmediate(resolve))

        if (options.onBeforeDispatch?.(streamEvent, context)) {
          return context.streamComplete || undefined
        }

        if (isSubagentSpanStreamEvent(streamEvent)) {
          const spanData = parseSubagentSpanData(streamEvent.payload.data)
          const toolCallId = streamEvent.scope?.parentToolCallId || spanData?.toolCallId
          const subagentName = streamEvent.payload.agent
          const spanEvt = streamEvent.payload.event
          const isPendingPause = spanData?.pending === true
          // A subagent lifecycle boundary breaks the main thinking stream.
          // Flush any open thinking block into contentBlocks BEFORE we push
          // the `subagent` marker, or the persisted order ends up
          // [subagent, thinking] and the UI renders the subagent group
          // above a thinking block that actually happened first.
          flushSubagentThinkingBlock(context)
          flushThinkingBlock(context)
          if (spanEvt === MothershipStreamV1SpanLifecycleEvent.start) {
            const lastParent = context.subAgentParentStack[context.subAgentParentStack.length - 1]
            const lastBlock = context.contentBlocks[context.contentBlocks.length - 1]
            if (toolCallId) {
              if (lastParent !== toolCallId) {
                context.subAgentParentStack.push(toolCallId)
              }
              context.subAgentParentToolCallId = toolCallId
              context.subAgentContent[toolCallId] ??= ''
              context.subAgentToolCalls[toolCallId] ??= []
            }
            if (
              subagentName &&
              !(
                lastParent === toolCallId &&
                lastBlock?.type === 'subagent' &&
                lastBlock.content === subagentName
              )
            ) {
              context.contentBlocks.push({
                type: 'subagent',
                content: subagentName,
                timestamp: Date.now(),
              })
            }
            return
          }
          if (spanEvt === MothershipStreamV1SpanLifecycleEvent.end) {
            if (isPendingPause) {
              return
            }
            if (context.subAgentParentStack.length > 0) {
              context.subAgentParentStack.pop()
            } else {
              logger.warn('subagent end without matching start')
            }
            context.subAgentParentToolCallId =
              context.subAgentParentStack.length > 0
                ? context.subAgentParentStack[context.subAgentParentStack.length - 1]
                : undefined
            if (subagentName) {
              for (let i = context.contentBlocks.length - 1; i >= 0; i--) {
                const b = context.contentBlocks[i]
                if (
                  b.type === 'subagent' &&
                  b.content === subagentName &&
                  b.endedAt === undefined
                ) {
                  b.endedAt = Date.now()
                  break
                }
              }
            }
            return
          }
        }

        if (handleSubagentRouting(streamEvent, context)) {
          const handler = subAgentHandlers[streamEvent.type]
          if (handler) {
            await handler(streamEvent, context, execContext, options)
          }
          return context.streamComplete || undefined
        }

        const handler = sseHandlers[streamEvent.type]
        if (handler) {
          await handler(streamEvent, context, execContext, options)
        }
        return context.streamComplete || undefined
      } finally {
        const dispatchMs = performance.now() - dispatchStart
        counters.totalDispatchMs += dispatchMs
        if (dispatchMs > counters.longestDispatchMs) counters.longestDispatchMs = dispatchMs
      }
    })

    if (!context.streamComplete && !abortSignal?.aborted && !context.wasAborted) {
      const streamPath = new URL(fetchUrl).pathname
      const message = `Copilot backend stream ended before a terminal event on ${streamPath}`
      context.errors.push(message)
      logger.error('Copilot backend stream ended before a terminal event', {
        path: streamPath,
        requestId: context.requestId,
        messageId: context.messageId,
      })
      endedOn = CopilotSseCloseReason.ClosedNoTerminal
      throw new CopilotBackendError(message, { status: 503 })
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
