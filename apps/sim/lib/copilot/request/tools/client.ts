import {
  MothershipStreamV1AsyncToolRecordStatus,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { waitForToolConfirmation } from '@/lib/copilot/persistence/tool-confirm'

/**
 * Wait for a tool completion signal (success/error/rejected) from the client.
 * Ignores intermediate statuses like `accepted` and only returns terminal statuses:
 * - success: client finished executing successfully
 * - error: client execution failed
 * - rejected: user clicked Skip (subagent run tools where user hasn't auto-allowed)
 *
 * Used for client-executable run tools: the client executes the workflow
 * and posts success/error to /api/copilot/confirm when done. The server
 * waits here until that completion signal arrives.
 */
export async function waitForToolCompletion(
  toolCallId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<{ status: string; message?: string; data?: Record<string, unknown> } | null> {
  const decision = await waitForToolConfirmation(toolCallId, timeoutMs, abortSignal, {
    acceptStatus: (status) =>
      status === MothershipStreamV1ToolOutcome.success ||
      status === MothershipStreamV1ToolOutcome.error ||
      status === MothershipStreamV1ToolOutcome.rejected ||
      status === 'background' ||
      status === MothershipStreamV1ToolOutcome.cancelled ||
      status === MothershipStreamV1AsyncToolRecordStatus.delivered,
  })
  if (
    decision?.status === MothershipStreamV1ToolOutcome.success ||
    decision?.status === MothershipStreamV1ToolOutcome.error ||
    decision?.status === MothershipStreamV1ToolOutcome.rejected ||
    decision?.status === 'background' ||
    decision?.status === MothershipStreamV1ToolOutcome.cancelled ||
    decision?.status === MothershipStreamV1AsyncToolRecordStatus.delivered
  ) {
    return decision
  }
  return null
}
