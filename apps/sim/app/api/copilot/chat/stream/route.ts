import { context as otelContext, trace } from '@opentelemetry/api'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { type NextRequest, NextResponse } from 'next/server'
import { getLatestRunForStream } from '@/lib/copilot/async-runs/repository'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  CopilotResumeOutcome,
  CopilotTransport,
} from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { contextFromRequestHeaders } from '@/lib/copilot/request/go/propagation'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request/http'
import { getCopilotTracer, markSpanForError } from '@/lib/copilot/request/otel'
import {
  checkForReplayGap,
  createEvent,
  encodeSSEEnvelope,
  readEvents,
  readFilePreviewSessions,
  SSE_RESPONSE_HEADERS,
} from '@/lib/copilot/request/session'
import { toStreamBatchEvent } from '@/lib/copilot/request/session/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const maxDuration = 3600

const logger = createLogger('CopilotChatStreamAPI')
const POLL_INTERVAL_MS = 250
const MAX_STREAM_MS = 60 * 60 * 1000

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

function isTerminalStatus(
  status: string | null | undefined
): status is MothershipStreamV1CompletionStatus {
  return (
    status === MothershipStreamV1CompletionStatus.complete ||
    status === MothershipStreamV1CompletionStatus.error ||
    status === MothershipStreamV1CompletionStatus.cancelled
  )
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
  const { userId: authenticatedUserId, isAuthenticated } =
    await authenticateCopilotRequestSessionOnly()

  if (!isAuthenticated || !authenticatedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const streamId = url.searchParams.get('streamId') || ''
  const afterCursor = url.searchParams.get('after') || ''
  const batchMode = url.searchParams.get('batch') === 'true'

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
        authenticatedUserId,
        rootSpan,
        rootContext,
      })
    )
  } catch (err) {
    markSpanForError(rootSpan, err)
    rootSpan.end()
    throw err
  }
})

async function handleResumeRequestBody({
  request,
  streamId,
  afterCursor,
  batchMode,
  authenticatedUserId,
  rootSpan,
  rootContext,
}: {
  request: NextRequest
  streamId: string
  afterCursor: string
  batchMode: boolean
  authenticatedUserId: string
  rootSpan: import('@opentelemetry/api').Span
  rootContext: import('@opentelemetry/api').Context
}) {
  const run = await getLatestRunForStream(streamId, authenticatedUserId).catch((err) => {
    logger.warn('Failed to fetch latest run for stream', {
      streamId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  })
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
    const [events, previewSessions] = await Promise.all([
      readEvents(streamId, afterSeq),
      readFilePreviewSessions(streamId).catch((error) => {
        logger.warn('Failed to read preview sessions for stream batch', {
          streamId,
          error: error instanceof Error ? error.message : String(error),
        })
        return []
      }),
    ])
    const batchEvents = events.map(toStreamBatchEvent)
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
    })
  }

  const startTime = Date.now()
  let totalEventsFlushed = 0
  let pollIterations = 0

  const stream = new ReadableStream({
    async start(controller) {
      // Re-enter the root OTel context so any `withCopilotSpan` call below
      // (inside flushEvents/checkForReplayGap/etc.) parents under
      // copilot.resume.request instead of becoming an orphan.
      return otelContext.with(rootContext, () => startInner(controller))
    },
  })

  async function startInner(controller: ReadableStreamDefaultController) {
    let cursor = afterCursor || '0'
    let controllerClosed = false
    let sawTerminalEvent = false
    let currentRequestId = extractRunRequestId(run)
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

    const flushEvents = async () => {
      const events = await readEvents(streamId, cursor)
      if (events.length > 0) {
        totalEventsFlushed += events.length
        logger.debug('[Resume] Flushing events', {
          streamId,
          afterCursor: cursor,
          eventCount: events.length,
        })
      }
      for (const envelope of events) {
        cursor = envelope.stream.cursor ?? String(envelope.seq)
        currentRequestId = extractEnvelopeRequestId(envelope) || currentRequestId
        if (envelope.type === MothershipStreamV1EventType.complete) {
          sawTerminalEvent = true
        }
        if (!enqueueEvent(envelope)) {
          break
        }
      }
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
        cursor = envelope.stream.cursor ?? String(envelope.seq)
        if (envelope.type === MothershipStreamV1EventType.complete) {
          sawTerminalEvent = true
        }
        if (!enqueueEvent(envelope)) {
          break
        }
      }
    }

    try {
      const gap = await checkForReplayGap(streamId, afterCursor, currentRequestId)
      if (gap) {
        for (const envelope of gap.envelopes) {
          enqueueEvent(envelope)
        }
        return
      }

      await flushEvents()

      while (!controllerClosed && Date.now() - startTime < MAX_STREAM_MS) {
        pollIterations += 1
        const currentRun = await getLatestRunForStream(streamId, authenticatedUserId).catch(
          (err) => {
            logger.warn('Failed to poll latest run for stream', {
              streamId,
              error: err instanceof Error ? err.message : String(err),
            })
            return null
          }
        )
        if (!currentRun) {
          emitTerminalIfMissing(MothershipStreamV1CompletionStatus.error, {
            message: 'The stream could not be recovered because its run metadata is unavailable.',
            code: 'resume_run_unavailable',
            reason: 'run_unavailable',
          })
          break
        }

        currentRequestId = extractRunRequestId(currentRun) || currentRequestId

        await flushEvents()

        if (controllerClosed) {
          break
        }
        if (isTerminalStatus(currentRun.status)) {
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

        await sleep(POLL_INTERVAL_MS)
      }
      if (!controllerClosed && Date.now() - startTime >= MAX_STREAM_MS) {
        emitTerminalIfMissing(MothershipStreamV1CompletionStatus.error, {
          message: 'The stream recovery timed out before completion.',
          code: 'resume_timeout',
          reason: 'timeout',
        })
      }
    } catch (error) {
      if (!controllerClosed && !request.signal.aborted) {
        logger.warn('Stream replay failed', {
          streamId,
          error: error instanceof Error ? error.message : String(error),
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
      closeController()
      rootSpan.setAttributes({
        [TraceAttr.CopilotResumeOutcome]: sawTerminalEvent
          ? CopilotResumeOutcome.TerminalDelivered
          : controllerClosed
            ? CopilotResumeOutcome.ClientDisconnected
            : CopilotResumeOutcome.EndedWithoutTerminal,
        [TraceAttr.CopilotResumeEventCount]: totalEventsFlushed,
        [TraceAttr.CopilotResumePollIterations]: pollIterations,
        [TraceAttr.CopilotResumeDurationMs]: Date.now() - startTime,
      })
      rootSpan.end()
    }
  }

  return new Response(stream, { headers: SSE_RESPONSE_HEADERS })
}
