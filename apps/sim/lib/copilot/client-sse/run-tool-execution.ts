import { createLogger } from '@sim/logger'
import { v4 as uuidv4 } from 'uuid'
import { COPILOT_CONFIRM_API_PATH } from '@/lib/copilot/constants'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-display-registry'
import { executeWorkflowWithFullLogging } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils'
import { useExecutionStore } from '@/stores/execution/store'
import { clearExecutionPointer, consolePersistence, saveExecutionPointer } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('CopilotRunToolExecution')
const activeRunToolByWorkflowId = new Map<string, string>()
const activeRunAbortByWorkflowId = new Map<string, AbortController>()
const manuallyStoppedToolCallIds = new Set<string>()

/**
 * Execute a run tool on the client side using the streaming execute endpoint.
 * This gives full interactive feedback: block pulsing, console logs, stop button.
 *
 * Mirrors staging's RunWorkflowClientTool.handleAccept():
 * 1. Execute via executeWorkflowWithFullLogging
 * 2. Update client tool state directly (success/error)
 * 3. Report completion to server via /api/copilot/confirm (Redis),
 *    where the server-side handler picks it up and tells Go
 */
export function executeRunToolOnClient(
  toolCallId: string,
  toolName: string,
  params: Record<string, unknown>
): void {
  doExecuteRunTool(toolCallId, toolName, params).catch((err) => {
    logger.error('[RunTool] Unhandled error in client-side run tool execution', {
      toolCallId,
      toolName,
      error: err instanceof Error ? err.message : String(err),
    })
  })
}

/**
 * Synchronously mark the active run tool for a workflow as manually stopped.
 * Must be called before issuing the cancellation request so that the
 * concurrent doExecuteRunTool catch/success paths see the marker and skip
 * their own completion report.
 */
export function markRunToolManuallyStopped(workflowId: string): string | null {
  const toolCallId = activeRunToolByWorkflowId.get(workflowId)
  if (!toolCallId) return null
  manuallyStoppedToolCallIds.add(toolCallId)
  setToolState(toolCallId, ClientToolCallState.cancelled)
  return toolCallId
}

export function cancelRunToolExecution(workflowId: string): void {
  const controller = activeRunAbortByWorkflowId.get(workflowId)
  if (!controller) return
  controller.abort()
  activeRunAbortByWorkflowId.delete(workflowId)
}

/**
 * Report a manual user-initiated stop for an active client-executed run tool.
 * This lets Copilot know the run was intentionally cancelled by the user.
 * Call markRunToolManuallyStopped first to prevent race conditions.
 */
export async function reportManualRunToolStop(
  workflowId: string,
  toolCallIdOverride?: string | null
): Promise<void> {
  const toolCallId = toolCallIdOverride || activeRunToolByWorkflowId.get(workflowId)
  if (!toolCallId) return

  if (!manuallyStoppedToolCallIds.has(toolCallId)) {
    manuallyStoppedToolCallIds.add(toolCallId)
    setToolState(toolCallId, ClientToolCallState.cancelled)
  }

  await reportCompletion(
    toolCallId,
    'cancelled',
    'Workflow execution was stopped manually by the user.',
    {
      reason: 'user_cancelled',
      cancelledByUser: true,
      workflowId,
    }
  )
}

async function doExecuteRunTool(
  toolCallId: string,
  toolName: string,
  params: Record<string, unknown>
): Promise<void> {
  const { activeWorkflowId, setActiveWorkflow } = useWorkflowRegistry.getState()
  const targetWorkflowId =
    typeof params.workflowId === 'string' && params.workflowId.length > 0
      ? params.workflowId
      : activeWorkflowId

  if (!targetWorkflowId) {
    logger.warn('[RunTool] Execution prevented: no active workflow', { toolCallId, toolName })
    setToolState(toolCallId, ClientToolCallState.error)
    await reportCompletion(toolCallId, 'error', 'No active workflow found')
    return
  }

  setActiveWorkflow(targetWorkflowId)
  activeRunToolByWorkflowId.set(targetWorkflowId, toolCallId)

  const { getWorkflowExecution, setIsExecuting } = useExecutionStore.getState()
  const { isExecuting } = getWorkflowExecution(targetWorkflowId)

  if (isExecuting) {
    logger.warn('[RunTool] Execution prevented: already executing', { toolCallId, toolName })
    setToolState(toolCallId, ClientToolCallState.error)
    await reportCompletion(toolCallId, 'error', 'Workflow is already executing. Try again later')
    return
  }

  // Extract params for all tool types
  const workflowInput = (params.workflow_input || params.input || undefined) as
    | Record<string, unknown>
    | undefined

  const stopAfterBlockId = (() => {
    if (toolName === 'run_workflow_until_block')
      return params.stopAfterBlockId as string | undefined
    if (toolName === 'run_block') return params.blockId as string | undefined
    return undefined
  })()

  const runFromBlock = (() => {
    if (toolName === 'run_from_block' && params.startBlockId) {
      return {
        startBlockId: params.startBlockId as string,
        executionId: (params.executionId as string | undefined) || 'latest',
      }
    }
    if (toolName === 'run_block' && params.blockId) {
      return {
        startBlockId: params.blockId as string,
        executionId: (params.executionId as string | undefined) || 'latest',
      }
    }
    return undefined
  })()

  const { setCurrentExecutionId } = useExecutionStore.getState()
  const abortController = new AbortController()
  activeRunAbortByWorkflowId.set(targetWorkflowId, abortController)

  consolePersistence.executionStarted()
  setIsExecuting(targetWorkflowId, true)
  const executionId = uuidv4()
  setCurrentExecutionId(targetWorkflowId, executionId)
  saveExecutionPointer({ workflowId: targetWorkflowId, executionId, lastEventId: 0 })
  const executionStartTime = new Date().toISOString()

  const onPageHide = () => {
    if (manuallyStoppedToolCallIds.has(toolCallId)) return
    navigator.sendBeacon(
      COPILOT_CONFIRM_API_PATH,
      new Blob(
        [
          JSON.stringify({
            toolCallId,
            status: 'background',
            message: 'Client disconnected, execution continuing server-side',
          }),
        ],
        { type: 'application/json' }
      )
    )
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide)
  }

  logger.info('[RunTool] Starting client-side workflow execution', {
    toolCallId,
    toolName,
    executionId,
    workflowId: targetWorkflowId,
    hasInput: !!workflowInput,
    stopAfterBlockId,
    runFromBlock: runFromBlock ? { startBlockId: runFromBlock.startBlockId } : undefined,
  })

  try {
    const result = await executeWorkflowWithFullLogging({
      workflowId: targetWorkflowId,
      workflowInput,
      executionId,
      overrideTriggerType: 'copilot',
      stopAfterBlockId,
      runFromBlock,
      abortSignal: abortController.signal,
    })

    // Determine success (same logic as staging's RunWorkflowClientTool)
    let succeeded = true
    let errorMessage: string | undefined
    try {
      if (result && typeof result === 'object' && 'success' in (result as any)) {
        succeeded = Boolean((result as any).success)
        if (!succeeded) {
          errorMessage = (result as any)?.error || (result as any)?.output?.error
        }
      } else if (
        result &&
        typeof result === 'object' &&
        'execution' in (result as any) &&
        (result as any).execution
      ) {
        succeeded = Boolean((result as any).execution.success)
        if (!succeeded) {
          errorMessage =
            (result as any).execution?.error || (result as any).execution?.output?.error
        }
      }
    } catch {}

    if (manuallyStoppedToolCallIds.has(toolCallId)) {
      logger.info('[RunTool] Skipping generic completion — already manually stopped', {
        toolCallId,
        toolName,
      })
    } else if (succeeded) {
      logger.info('[RunTool] Workflow execution succeeded', { toolCallId, toolName })
      setToolState(toolCallId, ClientToolCallState.success)
      await reportCompletion(
        toolCallId,
        'success',
        `Workflow execution completed. Started at: ${executionStartTime}`,
        buildResultData(result)
      )
    } else {
      const msg = errorMessage || 'Workflow execution failed'
      logger.error('[RunTool] Workflow execution failed', { toolCallId, toolName, error: msg })
      setToolState(toolCallId, ClientToolCallState.error)
      await reportCompletion(toolCallId, 'error', msg, buildResultData(result))
    }
  } catch (err) {
    if (manuallyStoppedToolCallIds.has(toolCallId)) {
      logger.info('[RunTool] Skipping error completion — already manually stopped', {
        toolCallId,
        toolName,
      })
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('[RunTool] Workflow execution threw', { toolCallId, toolName, error: msg })
      setToolState(toolCallId, ClientToolCallState.error)
      await reportCompletion(toolCallId, 'error', msg)
    }
  } finally {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide)
    }
    manuallyStoppedToolCallIds.delete(toolCallId)
    const activeToolCallId = activeRunToolByWorkflowId.get(targetWorkflowId)
    if (activeToolCallId === toolCallId) {
      activeRunToolByWorkflowId.delete(targetWorkflowId)
    }
    const activeAbortController = activeRunAbortByWorkflowId.get(targetWorkflowId)
    if (activeAbortController === abortController) {
      activeRunAbortByWorkflowId.delete(targetWorkflowId)
    }
    const { setCurrentExecutionId: clearExecId } = useExecutionStore.getState()
    clearExecId(targetWorkflowId, null)
    clearExecutionPointer(targetWorkflowId)
    consolePersistence.executionEnded()
    setIsExecuting(targetWorkflowId, false)
  }
}

function setToolState(_toolCallId: string, _state: ClientToolCallState): void {
  // no-op: tool state is tracked by the mothership SSE stream
}

/**
 * Extract a structured result payload from the raw execution result
 * for the LLM to see the actual workflow output.
 */
function buildResultData(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object') return undefined

  const r = result as Record<string, unknown>

  if ('success' in r) {
    return {
      success: r.success,
      output: r.output,
      logs: r.logs,
      error: r.error,
    }
  }

  if ('execution' in r && r.execution && typeof r.execution === 'object') {
    const exec = r.execution as Record<string, unknown>
    return {
      success: exec.success,
      output: exec.output,
      logs: exec.logs,
      error: exec.error,
    }
  }

  return undefined
}

/**
 * Report tool completion to the server via the existing /api/copilot/confirm endpoint.
 * This persists the durable async-tool row and wakes the server-side waiter so
 * it can continue the paused Copilot run and notify Go.
 */
async function reportCompletion(
  toolCallId: string,
  status: 'success' | 'error' | 'cancelled',
  message?: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const res = await fetch(COPILOT_CONFIRM_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolCallId,
        status,
        message: message || (status === 'success' ? 'Tool completed' : 'Tool failed'),
        ...(data ? { data } : {}),
      }),
    })
    if (!res.ok) {
      logger.warn('[RunTool] reportCompletion failed', { toolCallId, status: res.status })
    }
  } catch (err) {
    logger.error('[RunTool] reportCompletion error', {
      toolCallId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
