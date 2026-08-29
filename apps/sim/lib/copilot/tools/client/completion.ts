import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { backoffWithJitter } from '@sim/utils/retry'
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
  data?: AsyncCompletionData,
  executionId?: string
): Promise<void> {
  const basePayload = {
    toolCallId,
    ...(executionId ? { executionId } : {}),
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

  // A lost confirmation strands the server-side waiter forever (the turn shows
  // the tool as running indefinitely), so ride out multi-second network blips:
  // 5 attempts with jittered exponential backoff (~15s total) instead of a
  // sub-second give-up. The confirm endpoint claims each resume exactly once,
  // so duplicate deliveries from retries are discarded server-side.
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
            ...(executionId ? { executionId } : {}),
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

    if (attempt < maxAttempts) {
      await sleep(backoffWithJitter(attempt, null))
    }
  }

  logger.error('Client tool completion failed after retries', {
    toolCallId,
    error: lastError?.message,
  })
  throw new CompletionReportError(lastError?.message ?? 'Failed to report tool completion')
}

/**
 * Makes one unload-safe attempt to deliver a compact terminal result. The
 * caller must keep the serialized payload below the browser's keepalive quota.
 */
export async function reportClientToolCompletionOnPageExit(
  toolCallId: string,
  status: AsyncConfirmationStatus,
  message: string,
  data?: AsyncCompletionData
): Promise<void> {
  // boundary-raw-fetch: keepalive is required so a terminal desktop result survives page unload
  const response = await fetch(COPILOT_CONFIRM_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...traceparentHeader() },
    body: JSON.stringify({
      toolCallId,
      status,
      message,
      ...(data !== undefined ? { data } : {}),
    }),
    keepalive: true,
  })
  if (!response.ok) {
    throw new CompletionReportError(`Page-exit completion failed with status ${response.status}`)
  }
}
