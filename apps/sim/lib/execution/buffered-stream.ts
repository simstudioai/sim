import { createLogger } from '@sim/logger'
import {
  type ExecutionStreamStatus,
  getExecutionMeta,
  readExecutionEvents,
} from '@/lib/execution/event-buffer'
import { formatSSEEvent } from '@/lib/workflows/executor/execution-events'

const logger = createLogger('BufferedExecutionStream')

const POLL_INTERVAL_MS = 500
const MAX_POLL_DURATION_MS = 10 * 60 * 1000

function isTerminalStatus(status: ExecutionStreamStatus): boolean {
  return status === 'complete' || status === 'error' || status === 'cancelled'
}

export function createBufferedExecutionStream(
  executionId: string,
  initialEventId = 0
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let closed = false

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastEventId = initialEventId
      const pollDeadline = Date.now() + MAX_POLL_DURATION_MS

      const enqueue = (text: string) => {
        if (closed) {
          return
        }

        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          closed = true
        }
      }

      try {
        const initialEvents = await readExecutionEvents(executionId, lastEventId)
        for (const entry of initialEvents) {
          if (closed) {
            return
          }

          enqueue(formatSSEEvent(entry.event))
          lastEventId = entry.eventId
        }

        while (!closed && Date.now() < pollDeadline) {
          const meta = await getExecutionMeta(executionId)

          if (meta && isTerminalStatus(meta.status)) {
            const finalEvents = await readExecutionEvents(executionId, lastEventId)
            for (const entry of finalEvents) {
              if (closed) {
                return
              }

              enqueue(formatSSEEvent(entry.event))
              lastEventId = entry.eventId
            }

            enqueue('data: [DONE]\n\n')
            controller.close()
            return
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
          if (closed) {
            return
          }

          const newEvents = await readExecutionEvents(executionId, lastEventId)
          for (const entry of newEvents) {
            if (closed) {
              return
            }

            enqueue(formatSSEEvent(entry.event))
            lastEventId = entry.eventId
          }
        }

        if (!closed) {
          logger.warn('Buffered execution stream deadline reached', { executionId })
          enqueue('data: [DONE]\n\n')
          controller.close()
        }
      } catch (error) {
        logger.error('Buffered execution stream failed', {
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
      closed = true
      logger.info('Client disconnected from buffered execution stream', { executionId })
    },
  })
}
