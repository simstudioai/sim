import { createLogger } from '@sim/logger'
import { v4 as uuidv4 } from 'uuid'
import { COPILOT_CONFIRM_API_PATH } from '@/lib/copilot/constants'
import { resolveToolDisplay } from '@/lib/copilot/store-utils'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-display-registry'
import { executeWorkflowWithFullLogging } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils'
import { useExecutionStore } from '@/stores/execution/store'
import { useCopilotStore } from '@/stores/panel/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('CopilotRunToolExecution')

/**
 * Run tools that execute client-side for real-time feedback
 * (block pulsing, logs, stop button, etc.).
 */
export const CLIENT_EXECUTABLE_RUN_TOOLS = new Set([
  'run_workflow',
  'run_workflow_until_block',
  'run_from_block',
  'run_block',
])

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

async function doExecuteRunTool(
  toolCallId: string,
  toolName: string,
  params: Record<string, unknown>
): Promise<void> {
  const { activeWorkflowId } = useWorkflowRegistry.getState()

  if (!activeWorkflowId) {
    logger.warn('[RunTool] Execution prevented: no active workflow', { toolCallId, toolName })
    setToolState(toolCallId, ClientToolCallState.error)
    await reportCompletion(toolCallId, false, 'No active workflow found')
    return
  }

  const { getWorkflowExecution, setIsExecuting } = useExecutionStore.getState()
  const { isExecuting } = getWorkflowExecution(activeWorkflowId)

  if (isExecuting) {
    logger.warn('[RunTool] Execution prevented: already executing', { toolCallId, toolName })
    setToolState(toolCallId, ClientToolCallState.error)
    await reportCompletion(toolCallId, false, 'Workflow is already executing. Try again later')
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

  setIsExecuting(activeWorkflowId, true)
  const executionId = uuidv4()
  const executionStartTime = new Date().toISOString()

  logger.info('[RunTool] Starting client-side workflow execution', {
    toolCallId,
    toolName,
    executionId,
    activeWorkflowId,
    hasInput: !!workflowInput,
    stopAfterBlockId,
    runFromBlock: runFromBlock ? { startBlockId: runFromBlock.startBlockId } : undefined,
  })

  try {
    const result = await executeWorkflowWithFullLogging({
      workflowInput,
      executionId,
      overrideTriggerType: 'copilot',
      stopAfterBlockId,
      runFromBlock,
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

    if (succeeded) {
      logger.info('[RunTool] Workflow execution succeeded', { toolCallId, toolName })
      setToolState(toolCallId, ClientToolCallState.success)
      await reportCompletion(
        toolCallId,
        true,
        `Workflow execution completed. Started at: ${executionStartTime}`
      )
    } else {
      const msg = errorMessage || 'Workflow execution failed'
      logger.error('[RunTool] Workflow execution failed', { toolCallId, toolName, error: msg })
      setToolState(toolCallId, ClientToolCallState.error)
      await reportCompletion(toolCallId, false, msg)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('[RunTool] Workflow execution threw', { toolCallId, toolName, error: msg })
    setToolState(toolCallId, ClientToolCallState.error)
    await reportCompletion(toolCallId, false, msg)
  } finally {
    setIsExecuting(activeWorkflowId, false)
  }
}

/** Update the tool call state directly in the copilot store (like staging's setState). */
function setToolState(toolCallId: string, state: ClientToolCallState): void {
  try {
    const store = useCopilotStore.getState()
    const current = store.toolCallsById[toolCallId]
    if (!current) return
    const updated = {
      ...store.toolCallsById,
      [toolCallId]: {
        ...current,
        state,
        display: resolveToolDisplay(current.name, state, toolCallId, current.params),
      },
    }
    useCopilotStore.setState({ toolCallsById: updated })
  } catch (err) {
    logger.warn('[RunTool] Failed to update tool state', {
      toolCallId,
      state,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Report tool completion to the server via the existing /api/copilot/confirm endpoint.
 * This writes {status: 'success'|'error', message} to Redis. The server-side handler
 * is polling Redis via waitForToolCompletion() and will pick this up, then fire-and-forget
 * markToolComplete to the Go backend.
 */
async function reportCompletion(
  toolCallId: string,
  success: boolean,
  message?: string
): Promise<void> {
  try {
    const res = await fetch(COPILOT_CONFIRM_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolCallId,
        status: success ? 'success' : 'error',
        message: message || (success ? 'Tool completed' : 'Tool failed'),
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
