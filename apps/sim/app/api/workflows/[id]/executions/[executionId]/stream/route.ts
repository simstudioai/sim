import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { streamWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  EXECUTION_STREAM_PROTOCOL_VERSION,
  type ExecutionEventEntry,
  type ExecutionStreamStatus,
  readExecutionEventsState,
  readExecutionMetaState,
} from '@/lib/execution/event-buffer'
import { type ExecutionSignalReason, getExecutionSignalHub } from '@/lib/execution/execution-signal'
import {
  type ExecutionEvent,
  formatSSEEvent,
  getBlockInvocationKey,
} from '@/lib/workflows/executor/execution-events'

const logger = createLogger('ExecutionStreamReconnectAPI')

const HEARTBEAT_INTERVAL_MS = 15_000
const LEGACY_REPLAY_INTERVAL_MS = 500

function isTerminalStatus(status: ExecutionStreamStatus): boolean {
  return status === 'complete' || status === 'error' || status === 'cancelled'
}

function isTerminalEvent(event: ExecutionEvent): boolean {
  return (
    event.type === 'execution:completed' ||
    event.type === 'execution:error' ||
    event.type === 'execution:cancelled' ||
    event.type === 'execution:paused'
  )
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; executionId: string }> }) => {
    const parsed = await parseRequest(streamWorkflowExecutionContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workflowId, executionId } = parsed.data.params
    const { from: fromEventId } = parsed.data.query

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const workflowAuthorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: session.user.id,
        action: 'read',
      })
      if (!workflowAuthorization.allowed) {
        return NextResponse.json(
          { error: workflowAuthorization.message || 'Access denied' },
          { status: workflowAuthorization.status }
        )
      }

      const metaResult = await readExecutionMetaState(executionId)
      if (metaResult.status === 'unavailable') {
        return NextResponse.json({ error: 'Run buffer temporarily unavailable' }, { status: 503 })
      }
      if (metaResult.status === 'missing') {
        return NextResponse.json({ error: 'Run buffer not found or expired' }, { status: 404 })
      }
      const { meta } = metaResult
      const legacyProducer = meta.protocolVersion !== EXECUTION_STREAM_PROTOCOL_VERSION

      if (meta.workflowId && meta.workflowId !== workflowId) {
        return NextResponse.json({ error: 'Run does not belong to this workflow' }, { status: 403 })
      }

      logger.info('Reconnection stream requested', {
        workflowId,
        executionId,
        fromEventId,
        metaStatus: meta.status,
      })

      const encoder = new TextEncoder()

      let closed = false
      let unsubscribe: (() => void) | undefined
      let wakeStream: (() => void) | undefined

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let lastEventId = fromEventId
          let wakePending = false
          let signalError: Error | undefined
          let lastHeartbeatAt = Date.now()
          const deliveredActiveInvocationKeys = new Set<string>()
          const settledBlockInvocationKeys = new Set<string>()

          const enqueue = (text: string) => {
            if (closed) return
            try {
              controller.enqueue(encoder.encode(text))
            } catch {
              closed = true
            }
          }

          const readEventsOrThrow = async (
            afterEventId: number
          ): Promise<ExecutionEventEntry[]> => {
            const result = await readExecutionEventsState(executionId, afterEventId)
            if (result.status === 'unavailable') {
              throw new Error(`Execution events unavailable: ${result.error}`)
            }
            if (result.status === 'pruned') {
              throw new Error(
                `Execution events pruned before requested event id: earliest retained event is ${result.earliestEventId}`
              )
            }
            let previousEventId = afterEventId
            for (const entry of result.events) {
              if (entry.eventId <= previousEventId) {
                throw new Error(
                  `Execution event replay order violation: previous ${previousEventId}, received ${entry.eventId}`
                )
              }
              previousEventId = entry.eventId
            }
            return result.events
          }

          const enqueueEvents = (events: ExecutionEventEntry[]) => {
            let sawTerminalEvent = false
            for (const entry of events) {
              if (closed) break
              entry.event.eventId = entry.eventId
              enqueue(formatSSEEvent(entry.event))
              if (entry.event.type === 'block:started') {
                const invocationKey = getBlockInvocationKey(entry.event.data)
                deliveredActiveInvocationKeys.add(invocationKey)
                settledBlockInvocationKeys.delete(invocationKey)
              } else if (
                entry.event.type === 'block:completed' ||
                entry.event.type === 'block:error'
              ) {
                const invocationKey = getBlockInvocationKey(entry.event.data)
                deliveredActiveInvocationKeys.delete(invocationKey)
                settledBlockInvocationKeys.add(invocationKey)
              }
              lastEventId = entry.eventId
              sawTerminalEvent ||= isTerminalEvent(entry.event)
            }
            return sawTerminalEvent
          }

          const enqueueActiveBlockStarts = (activeBlockStarts = meta.activeBlockStarts ?? []) => {
            const snapshotInvocationKeys = new Set<string>()
            for (const active of activeBlockStarts) {
              const invocationKey = getBlockInvocationKey(active.data)
              snapshotInvocationKeys.add(invocationKey)
              if (
                active.eventId > lastEventId ||
                deliveredActiveInvocationKeys.has(invocationKey) ||
                settledBlockInvocationKeys.has(invocationKey)
              ) {
                continue
              }
              enqueue(
                formatSSEEvent({
                  type: 'block:started',
                  timestamp: new Date().toISOString(),
                  executionId,
                  workflowId,
                  data: active.data,
                })
              )
              deliveredActiveInvocationKeys.add(invocationKey)
            }
            for (const invocationKey of settledBlockInvocationKeys) {
              if (!snapshotInvocationKeys.has(invocationKey)) {
                settledBlockInvocationKeys.delete(invocationKey)
              }
            }
          }

          const closeWithDone = () => {
            enqueue('data: [DONE]\n\n')
            if (!closed) controller.close()
          }

          const waitForWake = (): Promise<'signal' | 'heartbeat' | 'legacy-poll'> => {
            if (wakePending) {
              wakePending = false
              return Promise.resolve('signal')
            }
            return new Promise<'signal' | 'heartbeat' | 'legacy-poll'>((resolve) => {
              const heartbeatTimer = setTimeout(
                () => {
                  wakeStream = undefined
                  resolve(legacyProducer ? 'legacy-poll' : 'heartbeat')
                },
                legacyProducer ? LEGACY_REPLAY_INTERVAL_MS : HEARTBEAT_INTERVAL_MS
              )
              wakeStream = () => {
                clearTimeout(heartbeatTimer)
                resolve('signal')
              }
            })
          }

          const signal = (reason: ExecutionSignalReason) => {
            if (reason === 'unavailable') {
              signalError = new Error('Execution signal subscription became unavailable')
            }
            if (wakeStream) {
              const resolve = wakeStream
              wakeStream = undefined
              resolve()
              return
            }
            wakePending = true
          }

          const closeAfterTerminalEvent = (events: ExecutionEventEntry[]) => {
            if (!enqueueEvents(events)) {
              logger.warn('Execution reached terminal metadata without a terminal event', {
                executionId,
              })
              enqueue(
                formatSSEEvent({
                  type: 'execution:error',
                  timestamp: new Date().toISOString(),
                  executionId,
                  workflowId,
                  data: {
                    error:
                      'Execution reached a terminal state, but its final event could not be recovered',
                    duration: 0,
                  },
                })
              )
            }
            closeWithDone()
          }

          try {
            const subscribed = await getExecutionSignalHub().subscribe(executionId, signal)
            if (closed) {
              subscribed()
              return
            }
            unsubscribe = subscribed
            const initialMeta = await readExecutionMetaState(executionId)
            if (initialMeta.status === 'unavailable') {
              throw new Error(`Execution metadata unavailable: ${initialMeta.error}`)
            }
            if (initialMeta.status === 'found' && fromEventId > 0) {
              enqueueActiveBlockStarts(initialMeta.meta.activeBlockStarts)
            }
            const events = await readEventsOrThrow(lastEventId)
            if (enqueueEvents(events)) {
              closeWithDone()
              return
            }

            const currentMeta = initialMeta
            if (currentMeta.status === 'missing' || isTerminalStatus(currentMeta.meta.status)) {
              const finalEvents = await readEventsOrThrow(lastEventId)
              closeAfterTerminalEvent(finalEvents)
              return
            }

            while (!closed) {
              const wakeReason = await waitForWake()
              if (closed) return
              if (signalError) throw signalError
              if (wakeReason === 'heartbeat') {
                enqueue(`: ping ${Date.now()}\n\n`)
                lastHeartbeatAt = Date.now()
                continue
              }

              const newEvents = await readEventsOrThrow(lastEventId)
              if (enqueueEvents(newEvents)) {
                closeWithDone()
                return
              }

              const signalledMeta = await readExecutionMetaState(executionId)
              if (signalledMeta.status === 'unavailable') {
                throw new Error(`Execution metadata unavailable: ${signalledMeta.error}`)
              }
              if (signalledMeta.status === 'found') {
                enqueueActiveBlockStarts(signalledMeta.meta.activeBlockStarts)
              }
              if (
                signalledMeta.status === 'missing' ||
                isTerminalStatus(signalledMeta.meta.status)
              ) {
                const finalEvents = await readEventsOrThrow(lastEventId)
                closeAfterTerminalEvent(finalEvents)
                return
              }
              if (
                wakeReason === 'legacy-poll' &&
                Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS
              ) {
                enqueue(`: ping ${Date.now()}\n\n`)
                lastHeartbeatAt = Date.now()
              }
            }
          } catch (error) {
            logger.error('Error in reconnection stream', {
              executionId,
              error: toError(error).message,
            })
            if (!closed) {
              try {
                controller.error(error)
              } catch {}
            }
          } finally {
            unsubscribe?.()
            unsubscribe = undefined
          }
        },
        cancel() {
          closed = true
          wakeStream?.()
          wakeStream = undefined
          unsubscribe?.()
          unsubscribe = undefined
          logger.info('Client disconnected from reconnection stream', { executionId })
        },
      })

      return new NextResponse(stream, {
        headers: {
          ...SSE_HEADERS,
          'X-Execution-Id': executionId,
        },
      })
    } catch (error: any) {
      logger.error('Failed to start reconnection stream', {
        workflowId,
        executionId,
        error: error.message,
      })
      return NextResponse.json(
        { error: error.message || 'Failed to start reconnection stream' },
        { status: 500 }
      )
    }
  }
)
