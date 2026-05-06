import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { type NextRequest, NextResponse } from 'next/server'
import { streamWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  type ExecutionEventEntry,
  type ExecutionStreamStatus,
  readExecutionEventsState,
  readExecutionMetaState,
} from '@/lib/execution/event-buffer'
import type { ExecutionEvent } from '@/lib/workflows/executor/execution-events'
import { formatSSEEvent } from '@/lib/workflows/executor/execution-events'

const logger = createLogger('ExecutionStreamReconnectAPI')

const POLL_INTERVAL_MS = 500
const MAX_POLL_DURATION_MS = 55 * 60 * 1000 // 55 minutes (just under Redis 1hr TTL)

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

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let lastEventId = fromEventId
          const pollDeadline = Date.now() + MAX_POLL_DURATION_MS

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
              lastEventId = entry.eventId
              sawTerminalEvent ||= isTerminalEvent(entry.event)
            }
            return sawTerminalEvent
          }

          const closeWithDone = () => {
            enqueue('data: [DONE]\n\n')
            if (!closed) controller.close()
          }

          const closeAfterTerminalEvent = (events: ExecutionEventEntry[]) => {
            if (!enqueueEvents(events)) {
              throw new Error('Execution reached terminal metadata without a terminal event')
            }
            closeWithDone()
          }

          try {
            const events = await readEventsOrThrow(lastEventId)
            if (enqueueEvents(events)) {
              closeWithDone()
              return
            }

            const currentMeta = await readExecutionMetaState(executionId)
            if (currentMeta.status === 'unavailable') {
              throw new Error(`Execution metadata unavailable: ${currentMeta.error}`)
            }
            if (currentMeta.status === 'missing' || isTerminalStatus(currentMeta.meta.status)) {
              const finalEvents = await readEventsOrThrow(lastEventId)
              closeAfterTerminalEvent(finalEvents)
              return
            }

            while (!closed && Date.now() < pollDeadline) {
              await sleep(POLL_INTERVAL_MS)
              if (closed) return

              const newEvents = await readEventsOrThrow(lastEventId)
              if (enqueueEvents(newEvents)) {
                closeWithDone()
                return
              }

              const polledMeta = await readExecutionMetaState(executionId)
              if (polledMeta.status === 'unavailable') {
                throw new Error(`Execution metadata unavailable: ${polledMeta.error}`)
              }
              if (polledMeta.status === 'missing' || isTerminalStatus(polledMeta.meta.status)) {
                const finalEvents = await readEventsOrThrow(lastEventId)
                closeAfterTerminalEvent(finalEvents)
                return
              }
            }

            if (!closed) {
              logger.warn('Reconnection stream poll deadline reached', { executionId })
              throw new Error('Execution stream ended before a terminal event was available')
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
          }
        },
        cancel() {
          closed = true
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
