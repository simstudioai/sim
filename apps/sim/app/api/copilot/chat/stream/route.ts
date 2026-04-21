import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { type NextRequest, NextResponse } from 'next/server'
import { getLatestRunForStream } from '@/lib/copilot/async-runs/repository'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/request/http'
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
}) {
  const baseSeq = Number(options.afterCursor || '0')
  const seq = Number.isFinite(baseSeq) ? baseSeq : 0
  const envelopes: ReturnType<typeof createEvent>[] = []

  if (options.status === MothershipStreamV1CompletionStatus.error) {
    envelopes.push(
      createEvent({
        streamId: options.streamId,
        cursor: String(seq + 1),
        seq: seq + 1,
        requestId: '',
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
      requestId: '',
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

  const run = await getLatestRunForStream(streamId, authenticatedUserId).catch((err) => {
    logger.warn('Failed to fetch latest run for stream', {
      streamId,
      error: toError(err).message,
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
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 })
  }

  if (batchMode) {
    const afterSeq = afterCursor || '0'
    const [events, previewSessions] = await Promise.all([
      readEvents(streamId, afterSeq),
      readFilePreviewSessions(streamId).catch((error) => {
        logger.warn('Failed to read preview sessions for stream batch', {
          streamId,
          error: toError(error).message,
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
    return NextResponse.json({
      success: true,
      events: batchEvents,
      previewSessions,
      status: run.status,
    })
  }

  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      let cursor = afterCursor || '0'
      let controllerClosed = false
      let sawTerminalEvent = false

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
          logger.info('[Resume] Flushing events', {
            streamId,
            afterCursor: cursor,
            eventCount: events.length,
          })
        }
        for (const envelope of events) {
          cursor = envelope.stream.cursor ?? String(envelope.seq)
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
        const gap = await checkForReplayGap(streamId, afterCursor)
        if (gap) {
          for (const envelope of gap.envelopes) {
            enqueueEvent(envelope)
          }
          return
        }

        await flushEvents()

        while (!controllerClosed && Date.now() - startTime < MAX_STREAM_MS) {
          const currentRun = await getLatestRunForStream(streamId, authenticatedUserId).catch(
            (err) => {
              logger.warn('Failed to poll latest run for stream', {
                streamId,
                error: toError(err).message,
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
            error: toError(error).message,
          })
          emitTerminalIfMissing(MothershipStreamV1CompletionStatus.error, {
            message: 'The stream replay failed before completion.',
            code: 'resume_internal',
            reason: 'stream_replay_failed',
          })
        }
      } finally {
        request.signal.removeEventListener('abort', abortListener)
        closeController()
      }
    },
  })

  return new Response(stream, { headers: SSE_RESPONSE_HEADERS })
})
