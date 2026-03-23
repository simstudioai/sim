import type { CopilotAsyncToolStatus } from '@sim/db/schema'

export const ASYNC_TOOL_STATUS = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  delivered: 'delivered',
} as const

export type AsyncLifecycleStatus =
  | typeof ASYNC_TOOL_STATUS.pending
  | typeof ASYNC_TOOL_STATUS.running
  | typeof ASYNC_TOOL_STATUS.completed
  | typeof ASYNC_TOOL_STATUS.failed
  | typeof ASYNC_TOOL_STATUS.cancelled

export type AsyncTerminalStatus =
  | typeof ASYNC_TOOL_STATUS.completed
  | typeof ASYNC_TOOL_STATUS.failed
  | typeof ASYNC_TOOL_STATUS.cancelled

export type AsyncFinishedStatus = AsyncTerminalStatus | typeof ASYNC_TOOL_STATUS.delivered

export interface AsyncCompletionEnvelope {
  toolCallId: string
  status: string
  message?: string
  data?: Record<string, unknown>
  runId?: string
  checkpointId?: string
  executionId?: string
  chatId?: string
  timestamp?: string
}

export function isTerminalAsyncStatus(
  status: CopilotAsyncToolStatus | AsyncLifecycleStatus | string | null | undefined
): status is AsyncTerminalStatus {
  return (
    status === ASYNC_TOOL_STATUS.completed ||
    status === ASYNC_TOOL_STATUS.failed ||
    status === ASYNC_TOOL_STATUS.cancelled
  )
}

export function isDeliveredAsyncStatus(
  status: CopilotAsyncToolStatus | string | null | undefined
): status is typeof ASYNC_TOOL_STATUS.delivered {
  return status === ASYNC_TOOL_STATUS.delivered
}

export function inferDeliveredAsyncSuccess(input: {
  result?: Record<string, unknown> | null
  error?: string | null
}) {
  if (input.error) return false
  const result = input.result ?? undefined
  if (!result) return true
  if (result.cancelled === true || result.cancelledByUser === true) return false
  if (typeof result.reason === 'string' && result.reason === 'user_cancelled') return false
  if (typeof result.error === 'string') return false
  return true
}
