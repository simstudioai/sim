import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncTerminalCompletionSnapshot,
  isAsyncTerminalConfirmationStatus,
} from '@/lib/copilot/async-runs/lifecycle'
import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import { waitForToolConfirmation } from '@/lib/copilot/persistence/tool-confirm'

/**
 * Wait for a client-executable workflow tool to report back.
 *
 * Current browser runtime outcomes are:
 * - `success`, `error`, `cancelled`: the workflow finished in the browser
 * - `background`: the browser detached on `pagehide`, so the server should stop
 *   waiting for a foreground result
 */
export async function waitForToolCompletion(
  toolCallId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<AsyncTerminalCompletionSnapshot | null> {
  const decision = await waitForToolConfirmation(toolCallId, timeoutMs, abortSignal, {
    acceptStatus: (status) =>
      status === MothershipStreamV1ToolOutcome.success ||
      status === MothershipStreamV1ToolOutcome.error ||
      status === ASYNC_TOOL_CONFIRMATION_STATUS.background ||
      status === MothershipStreamV1ToolOutcome.cancelled,
  })
  if (decision && isAsyncTerminalConfirmationStatus(decision.status)) {
    return { ...decision, status: decision.status }
  }
  return null
}
