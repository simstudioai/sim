import type { CopilotAsyncToolStatus, CopilotToolPermissionDecision } from '@sim/db/schema'
import {
  MothershipStreamV1AsyncToolRecordStatus,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'

export const ASYNC_TOOL_STATUS = MothershipStreamV1AsyncToolRecordStatus

export const EXECUTABLE_TOOL_PERMISSION_DECISIONS = [
  'allow',
  'allow_chat',
  'always_allow',
] as const satisfies readonly CopilotToolPermissionDecision[]

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

/**
 * Confirmation statuses sent on the request-local async tool confirmation channel.
 *
 * `background` is still emitted by the current browser workflow runtime on `pagehide`.
 */
export const ASYNC_TOOL_CONFIRMATION_STATUS = {
  background: 'background',
  success: MothershipStreamV1ToolOutcome.success,
  error: MothershipStreamV1ToolOutcome.error,
  cancelled: MothershipStreamV1ToolOutcome.cancelled,
} as const

export type AsyncConfirmationStatus =
  (typeof ASYNC_TOOL_CONFIRMATION_STATUS)[keyof typeof ASYNC_TOOL_CONFIRMATION_STATUS]

export type AsyncTerminalConfirmationStatus = AsyncConfirmationStatus

export type AsyncConfirmationProgressStatus =
  | typeof ASYNC_TOOL_STATUS.pending
  | typeof ASYNC_TOOL_STATUS.running

export type AsyncEphemeralConfirmationStatus = typeof ASYNC_TOOL_CONFIRMATION_STATUS.background

export type AsyncConfirmationStateStatus = AsyncConfirmationProgressStatus | AsyncConfirmationStatus

export type AsyncPromiseStatus = typeof ASYNC_TOOL_STATUS.running | AsyncTerminalConfirmationStatus

export type AsyncCompletionData = unknown

export interface AsyncCompletionEnvelope {
  toolCallId: string
  status: AsyncConfirmationStatus
  message?: string
  data?: AsyncCompletionData
  runId?: string
  checkpointId?: string
  executionId?: string
  chatId?: string
  timestamp?: string
}

export type AsyncCompletionSnapshot = Pick<
  AsyncCompletionEnvelope,
  'status' | 'message' | 'data' | 'timestamp'
>

export interface AsyncTerminalCompletionSnapshot extends AsyncCompletionSnapshot {
  status: AsyncTerminalConfirmationStatus
}

export interface AsyncConfirmationState {
  status: AsyncConfirmationStateStatus
  message?: string
  data?: AsyncCompletionData
  timestamp?: string
}

export interface AsyncCompletionSignal {
  status: AsyncPromiseStatus
  message?: string
  data?: AsyncCompletionData
}

export function isExecutableToolPermissionDecision(
  decision: CopilotToolPermissionDecision | null | undefined
): boolean {
  return decision !== null && decision !== undefined && decision !== 'skip'
}

export function isWorkflowToolExecutionClaimable(
  status: CopilotAsyncToolStatus,
  permissionDecision: CopilotToolPermissionDecision | null | undefined
): boolean {
  return (
    status === ASYNC_TOOL_STATUS.running ||
    status === ASYNC_TOOL_STATUS.delivered ||
    (status === ASYNC_TOOL_STATUS.pending && isExecutableToolPermissionDecision(permissionDecision))
  )
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

export function isAsyncTerminalConfirmationStatus(
  status: string | null | undefined
): status is AsyncTerminalConfirmationStatus {
  return (
    status === ASYNC_TOOL_CONFIRMATION_STATUS.background ||
    status === ASYNC_TOOL_CONFIRMATION_STATUS.success ||
    status === ASYNC_TOOL_CONFIRMATION_STATUS.error ||
    status === ASYNC_TOOL_CONFIRMATION_STATUS.cancelled
  )
}

export function isAsyncEphemeralConfirmationStatus(
  status: string | null | undefined
): status is AsyncEphemeralConfirmationStatus {
  return status === ASYNC_TOOL_CONFIRMATION_STATUS.background
}
