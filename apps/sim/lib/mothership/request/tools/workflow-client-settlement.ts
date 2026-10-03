import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  isTerminalAsyncStatus,
} from '@/lib/mothership/async-runs/lifecycle'
import {
  completeClientWorkflowToolCall,
  detachAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'
import { publishToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'
import {
  createStructuralWorkflowToolCompletionData,
  getWorkflowToolCompletionMessage,
  getWorkflowToolConfirmationStatus,
} from '@/lib/mothership/tools/workflow-tools'
import { getWorkflowExecutionLogStatus } from '@/lib/workflows/executor/execution-state'

interface ReportClientWorkflowToolParams {
  toolCallId: string
  executionId: string
  workflowId: string
}

/**
 * Report a browser-claimed workflow tool's outcome from the execution it bound.
 *
 * The execute route runs the workflow on the browser's behalf and keeps running
 * it after the browser detaches, so the settled execution log already holds the
 * result; the browser's confirmation only carries a wakeup. Recording the same
 * structural completion here means a tab that closes, loses its network, or
 * drops its `pagehide` beacon no longer parks the Chat turn for the full client
 * wait. An execution that ended without ever writing a log failed before it
 * started, which is what the browser reports from its stream error. Whichever of
 * this and the browser's report lands first is the one kept.
 */
export async function reportSettledClientWorkflowTool({
  toolCallId,
  executionId,
  workflowId,
}: ReportClientWorkflowToolParams): Promise<void> {
  const logStatus = await getWorkflowExecutionLogStatus(executionId, workflowId)
  if (logStatus !== undefined && !isTerminalAsyncStatus(logStatus)) return

  const executionStatus = logStatus ?? 'failed'
  const status = getWorkflowToolConfirmationStatus(executionStatus)
  const message = getWorkflowToolCompletionMessage(status)
  const data = createStructuralWorkflowToolCompletionData(status, workflowId, executionId)
  const completed = await completeClientWorkflowToolCall(
    {
      toolCallId,
      status: executionStatus,
      result: data,
      error: executionStatus === 'completed' ? null : message,
    },
    executionId
  )
  if (!completed) return

  publishToolConfirmation({
    toolCallId,
    status,
    message,
    timestamp: new Date().toISOString(),
    data,
    executionId,
  })
}

/**
 * Move a browser-claimed async run to the background once the execute route has
 * queued it, the same transition the browser reports after the queue accepts
 * it. A tab that closes before sending that report no longer parks the Chat
 * turn. Whichever of this and the browser's report lands first is the one kept.
 */
export async function reportQueuedClientWorkflowTool({
  toolCallId,
  executionId,
  workflowId,
}: ReportClientWorkflowToolParams): Promise<void> {
  const detached = await detachAsyncToolCall(toolCallId, { preserveClaim: true })
  if (!detached) return

  const status = ASYNC_TOOL_CONFIRMATION_STATUS.background
  publishToolConfirmation({
    toolCallId,
    status,
    message: getWorkflowToolCompletionMessage(status),
    timestamp: new Date().toISOString(),
    data: createStructuralWorkflowToolCompletionData(status, workflowId, executionId),
    executionId,
  })
}
