import { createLogger } from '@sim/logger'
import { completeClientWorkflowToolCall } from '@/lib/mothership/async-runs/repository'
import { publishToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'
import {
  createStructuralWorkflowToolCompletionData,
  getWorkflowToolCompletionMessage,
  getWorkflowToolConfirmationStatus,
} from '@/lib/mothership/tools/workflow-tools'
import { getTrustedWorkflowToolExecution } from '@/lib/workflows/executor/execution-state'

const logger = createLogger('CopilotWorkflowClientSettlement')

interface ReportSettledClientWorkflowToolParams {
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
 * wait. Whichever of this and the browser's report lands first is the one kept.
 */
export async function reportSettledClientWorkflowTool({
  toolCallId,
  executionId,
  workflowId,
}: ReportSettledClientWorkflowToolParams): Promise<void> {
  const execution = await getTrustedWorkflowToolExecution(executionId, workflowId, toolCallId)
  if (!execution) {
    logger.warn('Settled client workflow execution has no trusted log; leaving it to the client', {
      toolCallId,
      executionId,
      workflowId,
    })
    return
  }

  const status = getWorkflowToolConfirmationStatus(execution.status)
  const message = getWorkflowToolCompletionMessage(status)
  const data = createStructuralWorkflowToolCompletionData(status, workflowId, executionId)
  const completed = await completeClientWorkflowToolCall(
    {
      toolCallId,
      status: execution.status,
      result: data,
      error: execution.status === 'completed' ? null : message,
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
