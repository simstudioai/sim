import { createLogger } from '@sim/logger'
import type { AsyncCompletionEnvelope } from '@/lib/copilot/async-runs/lifecycle'
import { getAsyncToolCalls } from '@/lib/copilot/async-runs/repository'
import { createPubSubChannel } from '@/lib/events/pubsub'

const logger = createLogger('CopilotOrchestratorPersistence')

const toolConfirmationChannel = createPubSubChannel<AsyncCompletionEnvelope>({
  channel: 'copilot:tool-confirmation',
  label: 'CopilotToolConfirmation',
})

/**
 * Get a tool call confirmation status from the durable async tool row.
 */
export async function getToolConfirmation(toolCallId: string): Promise<{
  status: string
  message?: string
  timestamp?: string
  data?: Record<string, unknown>
} | null> {
  const [row] = await getAsyncToolCalls([toolCallId]).catch(() => [])
  if (!row) return null
  return {
    status:
      row.status === 'completed'
        ? 'success'
        : row.status === 'failed'
          ? 'error'
          : row.status === 'cancelled'
            ? 'cancelled'
            : row.status,
    message: row.error || undefined,
    data: (row.result as Record<string, unknown> | null) || undefined,
    timestamp: row.updatedAt?.toISOString?.(),
  }
}

export function publishToolConfirmation(event: AsyncCompletionEnvelope): void {
  logger.info('Publishing tool confirmation event', {
    toolCallId: event.toolCallId,
    status: event.status,
  })
  toolConfirmationChannel.publish(event)
}

export async function waitForToolConfirmation(
  toolCallId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
  options: {
    acceptStatus?: (status: string) => boolean
  } = {}
): Promise<{
  status: string
  message?: string
  timestamp?: string
  data?: Record<string, unknown>
} | null> {
  const acceptStatus = options.acceptStatus ?? (() => true)
  const existing = await getToolConfirmation(toolCallId)
  if (existing && acceptStatus(existing.status)) {
    logger.info('Resolved tool confirmation immediately', {
      toolCallId,
      status: existing.status,
    })
    return existing
  }

  return new Promise((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (unsubscribe) unsubscribe()
      abortSignal?.removeEventListener('abort', onAbort)
    }

    const settle = (
      value: {
        status: string
        message?: string
        timestamp?: string
        data?: Record<string, unknown>
      } | null
    ) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const onAbort = () => settle(null)

    unsubscribe = toolConfirmationChannel.subscribe((event) => {
      if (event.toolCallId !== toolCallId) return
      void getToolConfirmation(toolCallId).then((latest) => {
        if (!latest || !acceptStatus(latest.status)) return
        logger.info('Resolved tool confirmation from pubsub', {
          toolCallId,
          status: latest.status,
        })
        settle(latest)
      })
    })

    timeoutId = setTimeout(() => settle(null), timeoutMs)
    if (abortSignal?.aborted) {
      settle(null)
      return
    }
    abortSignal?.addEventListener('abort', onAbort, { once: true })

    void getToolConfirmation(toolCallId).then((latest) => {
      if (latest && acceptStatus(latest.status)) {
        logger.info('Resolved tool confirmation after subscribe', {
          toolCallId,
          status: latest.status,
        })
        settle(latest)
      }
    })
  })
}
