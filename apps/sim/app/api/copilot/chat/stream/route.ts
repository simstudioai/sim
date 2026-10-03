import { type Context, context as otelContext, type Span, trace } from '@opentelemetry/api'
import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotChatStreamContract } from '@/lib/api/contracts/copilot'
import { parseRequest } from '@/lib/api/server'
import {
  InternalUnauthenticatedError,
  internalOrchestrationErrorPolicy,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { encodeSSEComment } from '@/lib/core/utils/sse'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { MOTHERSHIP_STREAM_REPLAY_HEADER } from '@/lib/mothership/constants'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/mothership/generated/mothership-stream-v1'
import {
  CopilotResumeOutcome,
  CopilotTransport,
} from '@/lib/mothership/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { readChatStream } from '@/lib/mothership/request/application/recover-stream'
import { contextFromRequestHeaders } from '@/lib/mothership/request/go/propagation'
import { getCopilotTracer, markSpanForError } from '@/lib/mothership/request/otel'
import {
  createEvent,
  encodeSSEEnvelope,
  findReplayGap,
  forwardRunReplay,
  isTerminalStreamStatus,
  openRunReplay,
  RunReplayUnavailableError,
  readEvents,
  readFilePreviewSessions,
  readRingPosition,
  replayGapTerminal,
  ringCanServe,
  SSE_RESPONSE_HEADERS,
} from '@/lib/mothership/request/session'
import { toReplayEnvelope, toStreamBatchEvent } from '@/lib/mothership/request/session/types'

export const maxDuration = 3600

const logger = createLogger('CopilotChatStreamAPI')
const POLL_INTERVAL_MS = 250
const POLL_INTERVAL_MAX_MS = 2_000
const REPLAY_KEEPALIVE_INTERVAL_MS = 15_000
/** How often a tail that is still flushing events checks that its ring can serve it. */
const RING_CHECK_EVERY_BUSY_POLLS = 8
/**
 * One replay response stays open at most this long, inside the route's `maxDuration`.
 * A run still going at the cap is not over: the response ends without a terminal
 * event and the client re-attaches from its cursor.
 */
const MAX_STREAM_MS = 60 * 60 * 1000 - 60_000

/**
 * Whether ring events read after `cursor` start right after it. The ring can trim its
 * head between a gap check and the read, and a read that starts later would silently
 * skip part of the turn.
 */
function startsAfterCursor(events: readonly { seq: number }[], cursor: string): boolean {
  return events.length === 0 || events[0].seq <= Number(cursor || '0') + 1
}

function extractCanonicalRequestId(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : ''
}

function extractRunRequestId(run: { requestContext?: unknown } | null | undefined): string {
  if (!run || typeof run.requestContext !== 'object' || run.requestContext === null) {
    return ''
  }
  const requestContext = run.requestContext as Record<string, unknown>
  return (
    extractCanonicalRequestId(requestContext.requestId) ||
    extractCanonicalRequestId(requestContext.simRequestId)
  )
}

function extractEnvelopeRequestId(envelope: { trace?: { requestId?: unknown } }): string {
  return extractCanonicalRequestId(envelope.trace?.requestId)
}

function buildResumeTerminalEnvelopes(options: {
  streamId: string
  afterCursor: string
  status: MothershipStreamV1CompletionStatus
  message?: string
  code: string
  reason?: string
  requestId?: string
}) {
  const baseSeq = Number(options.afterCursor || '0')
  const seq = Number.isFinite(baseSeq) ? baseSeq : 0
  const envelopes: ReturnType<typeof createEvent>[] = []
  const rid = options.requestId ?? ''

  if (options.status === MothershipStreamV1CompletionStatus.error) {
    envelopes.push(
      createEvent({
        streamId: options.streamId,
        cursor: String(seq + 1),
        seq: seq + 1,
        requestId: rid,
        type: MothershipStreamV1EventType.error,
        payload: {
          message: options.message || 'Stream recovery failed before completion.',
          code: options.code,
        },
      })
    )
  }

  envelopes.push(
    createEvent({
      streamId: options.streamId,
      cursor: String(seq + envelopes.length + 1),
      seq: seq + envelopes.length + 1,
      requestId: rid,
      type: MothershipStreamV1EventType.complete,
      payload: {
        status: options.status,
        ...(options.reason ? { reason: options.reason } : {}),
      },
    })
  )

  return envelopes
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  let principal: SessionPrincipal
  try {
    principal = await internalSessionAuth.authenticate()
  } catch (error) {
    if (error instanceof InternalUnauthenticatedError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    throw error
  }
  const authenticatedUserId = principal.userId

  const parsed = await parseRequest(copilotChatStreamContract, request, {})
  if (!parsed.success) return parsed.response
  const { streamId, after: afterCursor, batch: batchMode, source } = parsed.data.query

  if (!streamId) {
    return NextResponse.json({ error: 'streamId is required' }, { status: 400 })
  }

  // Root span for the whole resume/reconnect request. In stream mode the
  // work happens inside `ReadableStream.start`, which the Node runtime
  // invokes after this function returns and OUTSIDE the AsyncLocalStorage
  // scope installed by `startActiveSpan`. We therefore start the span
  // manually, capture its context, and re-enter that context inside the
  // stream callback so every nested `withCopilotSpan` / `withDbSpan` call
  // attaches to this root.
  //
  // `contextFromRequestHeaders` extracts the W3C `traceparent` the
  // client echoed (set via `streamTraceparentRef` on Sim's chat POST
  // response), so the resume span becomes a child of the original
  // chat's `gen_ai.agent.execute` trace instead of a disconnected
  // new root. On reconnects after page reload (client ref was wiped)
  // the header is absent and extraction leaves the ambient context
  // alone → the resume span becomes its own root. Same as pre-
  // linking behavior; no regression.
  const incomingContext = contextFromRequestHeaders(request.headers)
  const rootSpan = getCopilotTracer().startSpan(
    TraceSpan.CopilotResumeRequest,
    {
      attributes: {
        [TraceAttr.CopilotTransport]: batchMode ? CopilotTransport.Batch : CopilotTransport.Stream,
        [TraceAttr.StreamId]: streamId,
        [TraceAttr.UserId]: authenticatedUserId,
        [TraceAttr.CopilotResumeAfterCursor]: afterCursor || '0',
      },
    },
    incomingContext
  )
  const rootContext = trace.setSpan(incomingContext, rootSpan)

  try {
    return await otelContext.with(rootContext, () =>
      handleResumeRequestBody({
        request,
        streamId,
        afterCursor,
        batchMode,
        fromLog: source === 'log',
        principal,
        rootSpan,
        rootContext,
      })
    )
  } catch (err) {
    markSpanForError(rootSpan, err)
    rootSpan.end()
    const errorResponse =
      internalOrchestrationErrorPolicy.project(err) ?? internalOrchestrationErrorPolicy.unhandled!()
    return NextResponse.json(errorResponse.body, {
      status: errorResponse.status,
      headers: errorResponse.headers,
    })
  }
})

async function handleResumeRequestBody({
  request,
  streamId,
  afterCursor,
  batchMode,
  fromLog,
  principal,
  rootSpan,
  rootContext,
}: {
  request: NextRequest
  streamId: string
  afterCursor: string
  batchMode: boolean
  /** The reader's cursor came from a log re-sync, so the ring never serves it. */
  fromLog: boolean
  principal: SessionPrincipal
  rootSpan: Span
  rootContext: Context
}) {
  const readRun = () =>
    readChatStream.execute({
      principal,
      input: { streamId },
    })
  const run = await readRun()
  logger.info('[Resume] Stream lookup', {
    streamId,
    afterCursor,
    batchMode,
    hasRun: !!run,
    runStatus: run?.status,
  })
  if (!run) {
    rootSpan.setAttribute(TraceAttr.CopilotResumeOutcome, CopilotResumeOutcome.StreamNotFound)
    rootSpan.end()
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
  }
  rootSpan.setAttribute(TraceAttr.CopilotRunStatus, run.status)

  if (batchMode) {
    const afterSeq = afterCursor || '0'
    const [gap, events, previewSessions] = await Promise.all([
      fromLog ? null : findReplayGap(streamId, afterSeq, extractRunRequestId(run)),
      readEvents(streamId, afterSeq),
      readFilePreviewSessions(streamId).catch((error) => {
        logger.warn('Failed to read preview sessions for stream batch', {
          streamId,
          error: getErrorMessage(error),
        })
        return []
      }),
    ])
    // A reader the ring cannot serve, or whose next event it trimmed after the gap check,
    // is re-synced from the worker log by the live tail.
    const batchEvents =
      fromLog || gap || !startsAfterCursor(events, afterSeq) ? [] : events.map(toStreamBatchEvent)
    logger.info('[Resume] Batch response', {
      streamId,
      afterCursor: afterSeq,
      eventCount: batchEvents.length,
      previewSessionCount: previewSessions.length,
      runStatus: run.status,
    })
    rootSpan.setAttributes({
      [TraceAttr.CopilotResumeOutcome]: CopilotResumeOutcome.BatchDelivered,
      [TraceAttr.CopilotResumeEventCount]: batchEvents.length,
      [TraceAttr.CopilotResumePreviewSessionCount]: previewSessions.length,
    })
    rootSpan.end()
    return NextResponse.json({
      success: true,
      events: batchEvents,
      previewSessions,
      status: run.status,
      ...(run.chatId ? { chatId: run.chatId } : {}),
    })
  }

  const startTime = Date.now()
  let totalEventsFlushed = 0
  let pollIterations = 0

  /**
   * A reader the ring cannot serve is re-synced from the worker's durable log for the
   * rest of this response, never handed back to the ring: the log and the ring have
   * no shared position to join on. The header tells the client to rebuild the turn
   * from an empty response, since the replay's cursors restart at 1.
   */
  const ringGap = fromLog
    ? null
    : await findReplayGap(streamId, afterCursor || '0', extractRunRequestId(run))
  // A finished run whose buffer expired answers its terminal; its transcript is persisted.
  const gap =
    ringGap && !(ringGap.latestSeq <= 0 && isTerminalStreamStatus(run.status)) ? ringGap : null
  const resyncFromLog = fromLog || gap !== null
  let replayBody: ReadableStream<Uint8Array> | null = null
  /** Releases the worker's replay once this response ends; the request signal may never fire. */
  const replayAbort = new AbortController()
  const replaySignal = AbortSignal.any([request.signal, replayAbort.signal])
  if (resyncFromLog && run.chatId) {
    try {
      replayBody = await openRunReplay({
        streamId,
        chatId: run.chatId,
        userId: principal.userId,
        signal: replaySignal,
      })
    } catch (error) {
      if (!(error instanceof RunReplayUnavailableError)) throw error
      logger.warn('Run replay unavailable; the client will retry', {
        streamId,
        error: getErrorMessage(error),
      })
      markSpanForError(rootSpan, error)
      rootSpan.end()
      return NextResponse.json({ error: 'Stream replay is unavailable' }, { status: 503 })
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Re-enter the root OTel context so any `withCopilotSpan` call below
      // (inside flushEvents/replayGapTerminal/etc.) parents under
      // copilot.resume.request instead of becoming an orphan.
      return otelContext.with(rootContext, () => startInner(controller))
    },
  })

  async function startInner(controller: ReadableStreamDefaultController) {
    let cursor = afterCursor || '0'
    let controllerClosed = false
    let sawTerminalEvent = false
    let currentRequestId = extractRunRequestId(run)
    let lastWriteTime = Date.now()
    // Stamp the logical request id + chat id on the resume root as soon
    // as we resolve them from the run row, so TraceQL joins work on
    // resume legs the same way they do on the original POST.
    if (currentRequestId) {
      rootSpan.setAttribute(TraceAttr.RequestId, currentRequestId)
      rootSpan.setAttribute(TraceAttr.SimRequestId, currentRequestId)
    }
    if (run?.chatId) {
      rootSpan.setAttribute(TraceAttr.ChatId, run.chatId)
    }

    const closeController = () => {
      if (controllerClosed) return
      controllerClosed = true
      try {
        controller.close()
      } catch {
        // Controller already closed by runtime/client
      }
    }

    const enqueueEvent = (payload: unknown) => {
      if (controllerClosed) return false
      try {
        controller.enqueue(encodeSSEEnvelope(payload))
        lastWriteTime = Date.now()
        return true
      } catch {
        controllerClosed = true
        return false
      }
    }

    const enqueueComment = (comment: string) => {
      if (controllerClosed) return false
      try {
        controller.enqueue(encodeSSEComment(comment))
        lastWriteTime = Date.now()
        return true
      } catch {
        controllerClosed = true
        return false
      }
    }

    const abortListener = () => {
      controllerClosed = true
    }
    request.signal.addEventListener('abort', abortListener, { once: true })

    /** Delivers the ring's events after the cursor, or returns null if it trimmed the next one. */
    const flushEvents = async (): Promise<number | null> => {
      const events = await readEvents(streamId, cursor)
      if (!startsAfterCursor(events, cursor)) {
        logger.warn('Replay ring trimmed past a reader cursor', { streamId, cursor })
        return null
      }
      if (events.length > 0) {
        logger.debug('[Resume] Flushing events', {
          streamId,
          afterCursor: cursor,
          eventCount: events.length,
        })
      }
      for (const envelope of events) {
        if (!enqueueEvent(toReplayEnvelope(envelope))) {
          break
        }
        totalEventsFlushed += 1
        cursor = envelope.stream.cursor ?? String(envelope.seq)
        currentRequestId = extractEnvelopeRequestId(envelope) || currentRequestId
        if (envelope.type === MothershipStreamV1EventType.complete) {
          sawTerminalEvent = true
        }
      }
      return events.length
    }

    const emitTerminalIfMissing = (
      status: MothershipStreamV1CompletionStatus,
      options?: { message?: string; code: string; reason?: string }
    ) => {
      if (controllerClosed || sawTerminalEvent) {
        return
      }
      for (const envelope of buildResumeTerminalEnvelopes({
        streamId,
        afterCursor: cursor,
        status,
        message: options?.message,
        code: options?.code ?? 'resume_terminal',
        reason: options?.reason,
        requestId: currentRequestId,
      })) {
        if (!enqueueEvent(envelope)) {
          break
        }
        cursor = envelope.stream.cursor ?? String(envelope.seq)
        if (envelope.type === MothershipStreamV1EventType.complete) {
          sawTerminalEvent = true
        }
      }
    }

    /** Forwards the worker's replay, keeping the response alive while it waits. */
    const streamRunReplay = async (body: ReadableStream<Uint8Array>) => {
      const keepalive = setInterval(() => {
        if (Date.now() - lastWriteTime < REPLAY_KEEPALIVE_INTERVAL_MS) return
        if (!enqueueComment('keepalive')) replayAbort.abort()
      }, REPLAY_KEEPALIVE_INTERVAL_MS)
      try {
        const end = await forwardRunReplay({
          body,
          streamId,
          signal: replaySignal,
          write: (envelope) => {
            if (!enqueueEvent(envelope)) return false
            totalEventsFlushed += 1
            cursor = envelope.stream.cursor ?? cursor
            if (envelope.type === MothershipStreamV1EventType.complete) sawTerminalEvent = true
            return true
          },
          readRunStatus: async () => (await readRun().catch(() => null))?.status ?? null,
          isClosed: () => controllerClosed,
          deadlineAt: startTime + MAX_STREAM_MS,
        })
        logger.info('[Resume] Run replay ended', { streamId, end, eventCount: totalEventsFlushed })
      } finally {
        clearInterval(keepalive)
        replayAbort.abort()
      }
    }

    try {
      enqueueComment('accepted')

      if (replayBody) {
        await streamRunReplay(replayBody)
        return
      }
      if (resyncFromLog) {
        const position = gap ?? (await readRingPosition(streamId, cursor))
        const terminal = await replayGapTerminal(streamId, position, currentRequestId)
        for (const envelope of terminal.envelopes) {
          if (!enqueueEvent(envelope)) {
            break
          }
          cursor = envelope.stream.cursor ?? String(envelope.seq)
          currentRequestId = extractEnvelopeRequestId(envelope) || currentRequestId
          if (envelope.type === MothershipStreamV1EventType.complete) {
            sawTerminalEvent = true
          }
        }
        return
      }

      let lastFlushed = await flushEvents()
      if (lastFlushed === null) return

      let pollDelayMs = POLL_INTERVAL_MS
      while (!controllerClosed && Date.now() - startTime < MAX_STREAM_MS) {
        pollIterations += 1
        const currentRun = await readRun().catch((err) => {
          logger.warn('Failed to poll latest run for stream', {
            streamId,
            error: getErrorMessage(err),
          })
          return null
        })
        if (!currentRun) {
          emitTerminalIfMissing(MothershipStreamV1CompletionStatus.error, {
            message: 'The stream could not be recovered because its run metadata is unavailable.',
            code: 'resume_run_unavailable',
            reason: 'run_unavailable',
          })
          break
        }
        // The ring lost its head, restarted or expired under this live tail; the re-attach
        // re-syncs, and a finished run answers its terminal instead. Only a quiet ring can
        // restart or be re-sent into by a recovery, so a busy tail checks every few polls.
        const checkRing = lastFlushed === 0 || pollIterations % RING_CHECK_EVERY_BUSY_POLLS === 0
        if (
          checkRing &&
          !isTerminalStreamStatus(currentRun.status) &&
          !ringCanServe(await readRingPosition(streamId, cursor))
        ) {
          logger.warn('Replay ring can no longer serve a live tail', { streamId, cursor })
          break
        }

        currentRequestId = extractRunRequestId(currentRun) || currentRequestId

        const flushed = await flushEvents()
        if (flushed === null) break
        lastFlushed = flushed
        /* Adaptive tail: 4 Hz only while events are actually flowing; a quiet stream
           decays toward the cap so an attached client doesn't hammer Postgres + Redis
           at 4 Hz for up to an hour. Any flushed event snaps back to full rate. */
        pollDelayMs =
          flushed > 0 ? POLL_INTERVAL_MS : Math.min(pollDelayMs * 2, POLL_INTERVAL_MAX_MS)

        if (controllerClosed) {
          break
        }
        if (isTerminalStreamStatus(currentRun.status)) {
          emitTerminalIfMissing(currentRun.status, {
            message:
              currentRun.status === MothershipStreamV1CompletionStatus.error
                ? typeof currentRun.error === 'string'
                  ? currentRun.error
                  : 'The recovered stream ended with an error.'
                : undefined,
            code: 'resume_terminal_status',
            reason: 'terminal_status',
          })
          break
        }

        if (request.signal.aborted) {
          controllerClosed = true
          break
        }

        if (Date.now() - lastWriteTime >= REPLAY_KEEPALIVE_INTERVAL_MS) {
          enqueueComment('keepalive')
        }

        await sleep(pollDelayMs)
      }
    } catch (error) {
      if (!controllerClosed && !request.signal.aborted) {
        logger.warn('Stream replay failed', {
          streamId,
          error: getErrorMessage(error),
        })
        emitTerminalIfMissing(MothershipStreamV1CompletionStatus.error, {
          message: 'The stream replay failed before completion.',
          code: 'resume_internal',
          reason: 'stream_replay_failed',
        })
      }
      markSpanForError(rootSpan, error)
    } finally {
      request.signal.removeEventListener('abort', abortListener)
      // Read before closing: closing the controller here is this route ending, not the client.
      const clientDisconnected = controllerClosed
      closeController()
      rootSpan.setAttributes({
        [TraceAttr.CopilotResumeOutcome]: sawTerminalEvent
          ? CopilotResumeOutcome.TerminalDelivered
          : clientDisconnected
            ? CopilotResumeOutcome.ClientDisconnected
            : CopilotResumeOutcome.EndedWithoutTerminal,
        [TraceAttr.CopilotResumeEventCount]: totalEventsFlushed,
        [TraceAttr.CopilotResumePollIterations]: pollIterations,
        [TraceAttr.CopilotResumeDurationMs]: Date.now() - startTime,
      })
      rootSpan.end()
    }
  }

  return new Response(stream, {
    headers: replayBody
      ? { ...SSE_RESPONSE_HEADERS, [MOTHERSHIP_STREAM_REPLAY_HEADER]: 'log' }
      : SSE_RESPONSE_HEADERS,
  })
}
