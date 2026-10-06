import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  ASYNC_TOOL_STATUS,
  type AsyncCompletionData,
  type AsyncConfirmationStatus,
} from '@/lib/mothership/async-runs/lifecycle'
import {
  type CompleteAsyncToolCallInput,
  completeAsyncToolCall,
  completeClaimedAsyncToolCall,
  completeOwnedDesktopToolCall,
  completePendingAsyncToolCall,
  detachAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'
import { publishToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'

/** The generic, content-free message stored and published for a client tool outcome. */
export function clientToolCompletionMessage(status: AsyncConfirmationStatus): string {
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.success) return 'Tool completed'
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.background) return 'Tool is running in background'
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.cancelled) return 'Tool cancelled'
  return 'Tool failed'
}

/** The durable status a settled client tool outcome is stored as. */
export function durableClientToolStatus(
  status: Exclude<AsyncConfirmationStatus, typeof ASYNC_TOOL_CONFIRMATION_STATUS.background>
) {
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.success) return ASYNC_TOOL_STATUS.completed
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.cancelled) return ASYNC_TOOL_STATUS.cancelled
  return ASYNC_TOOL_STATUS.failed
}

/**
 * Which transition may settle the call:
 * - `open`: any pending or running call.
 * - `pending`: only a call nobody claimed (the inverse of a claim).
 * - `claimed`: only the exact claim `claimedBy` holds.
 * - `owner`: only the running call this execution token still owns.
 */
export type ClientToolSettlementGuard =
  | { kind: 'open' }
  | { kind: 'pending' }
  | { kind: 'claimed'; claimedBy: string }
  | { kind: 'owner'; ownerToken: string }

function completeUnderGuard(
  completion: CompleteAsyncToolCallInput,
  guard: ClientToolSettlementGuard
) {
  switch (guard.kind) {
    case 'pending':
      return completePendingAsyncToolCall(completion)
    case 'claimed':
      return completeClaimedAsyncToolCall(completion, guard.claimedBy)
    case 'owner':
      return completeOwnedDesktopToolCall(completion, guard.ownerToken)
    case 'open':
      return completeAsyncToolCall(completion)
  }
}

/**
 * Settles a client-executed call and wakes the run waiting on it. The durable transition is a CAS
 * chosen by `guard`, so exactly one settlement wins; only the winner publishes. `background`
 * detaches the call instead of settling it. Returns `conflict` when another transition won.
 */
export async function settleClientToolCall(input: {
  toolCallId: string
  status: AsyncConfirmationStatus
  message: string
  data?: AsyncCompletionData
  executionId?: string
  guard: ClientToolSettlementGuard
}): Promise<'updated' | 'conflict'> {
  const { toolCallId, status, message, data, executionId, guard } = input
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.background) {
    /** A bound workflow execution keeps its claim; anything else releases it. */
    const detached = executionId
      ? await detachAsyncToolCall(toolCallId, { preserveClaim: true })
      : await detachAsyncToolCall(toolCallId)
    if (!detached) return 'conflict'
  } else {
    const completed = await completeUnderGuard(
      {
        toolCallId,
        status: durableClientToolStatus(status),
        result: data ?? null,
        error: status === ASYNC_TOOL_CONFIRMATION_STATUS.success ? null : message || status,
      },
      guard
    )
    if (!completed) return 'conflict'
  }
  publishToolConfirmation({
    toolCallId,
    status,
    message: message || undefined,
    timestamp: new Date().toISOString(),
    data,
    ...(executionId ? { executionId } : {}),
  })
  return 'updated'
}
