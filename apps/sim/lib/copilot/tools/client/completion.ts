import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import type {
  AsyncCompletionData,
  AsyncConfirmationStatus,
} from '@/lib/copilot/async-runs/lifecycle'
import { COPILOT_CONFIRM_API_PATH } from '@/lib/copilot/constants'
import { traceparentHeader } from '@/lib/copilot/tools/client/trace-context'

const logger = createLogger('CopilotClientToolCompletion')

export class CompletionReportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompletionReportError'
  }
}

/**
 * Persist a client-executed tool result and wake the server-side async waiter.
 * Shared by workflow execution and desktop-native client tools.
 */
export async function reportClientToolCompletion(
  toolCallId: string,
  status: AsyncConfirmationStatus,
  message?: string,
  data?: AsyncCompletionData
): Promise<void> {
  const basePayload = {
    toolCallId,
    status,
    message: message || (status === 'success' ? 'Tool completed' : 'Tool failed'),
    ...(data !== undefined ? { data } : {}),
  }
  const send = async (body: string) =>
    fetch(COPILOT_CONFIRM_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...traceparentHeader() },
      body,
    })

  const body = JSON.stringify(basePayload)
  const largePayloadThreshold = 10 * 1024 * 1024
  const bodySize = new Blob([body]).size
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await send(body)
      if (response.ok) return

      if (isRecordLike(data) && bodySize > largePayloadThreshold) {
        const { logs: _logs, ...dataWithoutLogs } = data
        logger.warn('Completion failed with large payload, retrying without logs', {
          toolCallId,
          status: response.status,
          bodySize,
        })
        const retryResponse = await send(
          JSON.stringify({
            toolCallId,
            status,
            message: message || (status === 'success' ? 'Tool completed' : 'Tool failed'),
            data: dataWithoutLogs,
          })
        )
        if (retryResponse.ok) return
        lastError = new Error(`Completion retry failed with status ${retryResponse.status}`)
      } else {
        lastError = new Error(`Completion failed with status ${response.status}`)
      }
    } catch (error) {
      lastError = toError(error)
    }

    if (attempt < 2) {
      await sleep(250)
    }
  }

  logger.error('Client tool completion failed after retries', {
    toolCallId,
    error: lastError?.message,
  })
  throw new CompletionReportError(lastError?.message ?? 'Failed to report tool completion')
}
