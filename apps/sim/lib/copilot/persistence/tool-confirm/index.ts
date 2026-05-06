import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  ASYNC_TOOL_STATUS,
  type AsyncCompletionEnvelope,
  type AsyncConfirmationState,
  isAsyncEphemeralConfirmationStatus,
} from '@/lib/copilot/async-runs/lifecycle'
import { getAsyncToolCalls } from '@/lib/copilot/async-runs/repository'
import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import { getRedisClient } from '@/lib/core/config/redis'
import { createPubSubChannel } from '@/lib/events/pubsub'

const logger = createLogger('CopilotOrchestratorPersistence')
const TOOL_CONFIRMATION_TTL_SECONDS = 60 * 10
const toolConfirmationKey = (toolCallId: string) => `copilot:tool-confirmation:${toolCallId}`

const toolConfirmationChannel = createPubSubChannel<AsyncCompletionEnvelope>({
  channel: 'copilot:tool-confirmation',
  label: 'CopilotToolConfirmation',
})

/**
 * Get a tool call confirmation state from the durable async tool row.
 *
 * The durable row reconstructs only the live execution lifecycle plus the
 * `background` detach signal.
 */
export async function getToolConfirmation(
  toolCallId: string
): Promise<AsyncConfirmationState | null> {
  const [row] = await getAsyncToolCalls([toolCallId]).catch((err) => {
    logger.warn('Failed to fetch async tool calls', {
      toolCallId,
      error: toError(err).message,
    })
    return []
  })
  if (!row) return null
  if (row.status === ASYNC_TOOL_STATUS.delivered) {
    logger.warn('Delivered async tool rows are outside request confirmation flow', {
      toolCallId,
    })
    return null
  }
  return {
    status:
      row.status === ASYNC_TOOL_STATUS.completed
        ? MothershipStreamV1ToolOutcome.success
        : row.status === ASYNC_TOOL_STATUS.failed
          ? MothershipStreamV1ToolOutcome.error
          : row.status === ASYNC_TOOL_STATUS.cancelled
            ? MothershipStreamV1ToolOutcome.cancelled
            : row.status,
    message: row.error || undefined,
    ...(row.result !== undefined ? { data: row.result } : {}),
    timestamp: row.updatedAt?.toISOString?.(),
  }
}

export function publishToolConfirmation(event: AsyncCompletionEnvelope): void {
  logger.info('Publishing tool confirmation event', {
    toolCallId: event.toolCallId,
    status: event.status,
  })
  const redis = getRedisClient()
  if (redis) {
    void redis
      .set(
        toolConfirmationKey(event.toolCallId),
        JSON.stringify(event),
        'EX',
        TOOL_CONFIRMATION_TTL_SECONDS
      )
      .then(() => {
        logger.info('Persisted tool confirmation in Redis', {
          toolCallId: event.toolCallId,
          status: event.status,
          redisKey: toolConfirmationKey(event.toolCallId),
        })
      })
      .catch((error) => {
        logger.warn('Failed to persist tool confirmation in Redis', {
          toolCallId: event.toolCallId,
          error: toError(error).message,
        })
      })
  } else {
    logger.warn('Redis unavailable while publishing tool confirmation', {
      toolCallId: event.toolCallId,
      status: event.status,
    })
  }
  toolConfirmationChannel.publish(event)
}

/**
 * Wait for an async tool confirmation update.
 *
 * `background` still arrives as a request-local detach signal, so it is checked
 * from pubsub before falling back to the durable async tool row.
 */
export async function waitForToolConfirmation(
  toolCallId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
  options: {
    acceptStatus?: (status: AsyncConfirmationState['status']) => boolean
  } = {}
): Promise<AsyncConfirmationState | null> {
  const acceptStatus = options.acceptStatus ?? (() => true)
  return new Promise((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (unsubscribe) unsubscribe()
      abortSignal?.removeEventListener('abort', onAbort)
    }

    const settle = (value: AsyncConfirmationState | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const onAbort = () => settle(null)

    unsubscribe = toolConfirmationChannel.subscribe((event) => {
      if (event.toolCallId !== toolCallId) return
      if (isAsyncEphemeralConfirmationStatus(event.status) && acceptStatus(event.status)) {
        settle({
          status: event.status,
          ...(event.message !== undefined ? { message: event.message } : {}),
          ...(event.data !== undefined ? { data: event.data } : {}),
          ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
        })
        return
      }
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
