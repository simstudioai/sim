import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import {
  type ExecutionStreamStatus,
  getExecutionMeta,
  readExecutionEvents,
} from '@/lib/execution/event-buffer'
import { formatSSEEvent } from '@/lib/workflows/executor/execution-events'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'

const logger = createLogger('ExecutionStreamReconnectAPI')

const POLL_INTERVAL_MS = 500

function isTerminalStatus(status: ExecutionStreamStatus): boolean {
  return status === 'complete' || status === 'error' || status === 'cancelled'
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  const { id: workflowId, executionId } = await params

  try {
    const auth = await checkHybridAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const workflowAuthorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId: auth.userId,
      action: 'read',
    })
    if (!workflowAuthorization.allowed) {
      return NextResponse.json(
        { error: workflowAuthorization.message || 'Access denied' },
        { status: workflowAuthorization.status }
      )
    }

    const meta = await getExecutionMeta(executionId)
    if (!meta) {
      return NextResponse.json({ error: 'Execution buffer not found or expired' }, { status: 404 })
    }

    if (meta.workflowId && meta.workflowId !== workflowId) {
      return NextResponse.json(
        { error: 'Execution does not belong to this workflow' },
        { status: 403 }
      )
    }

    const fromParam = req.nextUrl.searchParams.get('from')
    const fromEventId = fromParam ? Number.parseInt(fromParam, 10) : 0

    logger.info('Reconnection stream requested', {
      workflowId,
      executionId,
      fromEventId,
      metaStatus: meta.status,
    })

    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let lastEventId = fromEventId
        let closed = false

        const enqueue = (text: string) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(text))
          } catch {
            closed = true
          }
        }

        try {
          // Replay buffered events
          const events = await readExecutionEvents(executionId, lastEventId)
          for (const entry of events) {
            if (closed) return
            enqueue(formatSSEEvent(entry.event as any))
            lastEventId = entry.eventId
          }

          // Check if execution is already done
          const currentMeta = await getExecutionMeta(executionId)
          if (!currentMeta || isTerminalStatus(currentMeta.status)) {
            enqueue('data: [DONE]\n\n')
            if (!closed) controller.close()
            return
          }

          // Poll for new events until execution completes
          while (!closed) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
            if (closed) return

            const newEvents = await readExecutionEvents(executionId, lastEventId)
            for (const entry of newEvents) {
              if (closed) return
              enqueue(formatSSEEvent(entry.event as any))
              lastEventId = entry.eventId
            }

            const polledMeta = await getExecutionMeta(executionId)
            if (!polledMeta || isTerminalStatus(polledMeta.status)) {
              // One final read to catch any events flushed alongside the meta update
              const finalEvents = await readExecutionEvents(executionId, lastEventId)
              for (const entry of finalEvents) {
                if (closed) return
                enqueue(formatSSEEvent(entry.event as any))
                lastEventId = entry.eventId
              }
              enqueue('data: [DONE]\n\n')
              if (!closed) controller.close()
              return
            }
          }
        } catch (error) {
          logger.error('Error in reconnection stream', {
            executionId,
            error: error instanceof Error ? error.message : String(error),
          })
          if (!closed) {
            try {
              controller.close()
            } catch {}
          }
        }
      },
      cancel() {
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
