import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncConfirmationStatus,
  type AsyncTerminalStatus,
  getTerminalConfirmationStatus,
  isTerminalAsyncStatus,
} from '@/lib/mothership/async-runs/lifecycle'
import {
  completeClientWorkflowToolCall,
  detachAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'
import { publishToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'
import {
  buildPausedWorkflowToolCompletion,
  createStructuralWorkflowToolCompletionData,
  getWorkflowToolCompletionMessage,
} from '@/lib/mothership/tools/workflow-tools'
import {
  getHumanPauseResumeUrl,
  getWorkflowExecutionLogStatus,
} from '@/lib/workflows/executor/execution-state'

interface ReportClientWorkflowToolParams {
  toolCallId: string
  executionId: string
  workflowId: string
}

/**
 * Completes the call the execution claimed and publishes its answer. Only the first transition
 * out of `running` lands; returns whether this one did.
 */
async function completeAndPublish(
  { toolCallId, executionId }: ReportClientWorkflowToolParams,
  rowStatus: AsyncTerminalStatus,
  answer: { status: AsyncConfirmationStatus; message: string; data: Record<string, unknown> }
): Promise<boolean> {
  const completed = await completeClientWorkflowToolCall(
    {
      toolCallId,
      status: rowStatus,
      result: answer.data,
      error: rowStatus === 'completed' ? null : answer.message,
    },
    executionId
  )
  if (!completed) return false

  publishToolConfirmation({
    toolCallId,
    ...answer,
    timestamp: new Date().toISOString(),
    executionId,
  })
  return true
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
export async function reportSettledClientWorkflowTool(
  params: ReportClientWorkflowToolParams
): Promise<void> {
  const { executionId, workflowId } = params
  const logStatus = await getWorkflowExecutionLogStatus(executionId, workflowId)
  if (logStatus !== undefined && !isTerminalAsyncStatus(logStatus)) {
    await reportPausedClientWorkflowTool(params)
    return
  }

  const executionStatus = logStatus ?? 'failed'
  const status = getTerminalConfirmationStatus(executionStatus)
  await completeAndPublish(params, executionStatus, {
    status,
    message: getWorkflowToolCompletionMessage(status),
    data: createStructuralWorkflowToolCompletionData(status, workflowId, executionId),
  })
}

/**
 * Settle a browser-claimed workflow tool whose run is waiting on a person with the link to
 * answer, so Chat tells the user instead of waiting on an answer nobody knows is owed. A run
 * paused only on time resumes itself and keeps the call held. The call's claim on this
 * execution is what binds them, so no other call can be answered here. Returns whether it settled.
 */
export async function reportPausedClientWorkflowTool(
  params: ReportClientWorkflowToolParams
): Promise<boolean> {
  const { executionId, workflowId } = params
  const resumeUrl = await getHumanPauseResumeUrl(executionId, workflowId)
  if (!resumeUrl) return false
  return completeAndPublish(
    params,
    'completed',
    buildPausedWorkflowToolCompletion(workflowId, executionId, resumeUrl)
  )
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
