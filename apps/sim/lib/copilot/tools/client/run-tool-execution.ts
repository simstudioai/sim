import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { AsyncCompletionData } from '@/lib/copilot/async-runs/lifecycle'
import { COPILOT_CONFIRM_API_PATH } from '@/lib/copilot/constants'
import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import {
  RunBlock,
  RunFromBlock,
  RunWorkflowUntilBlock,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { traceparentHeader } from '@/lib/copilot/tools/client/trace-context'
import { executeWorkflowWithFullLogging } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils'
import { useExecutionStore } from '@/stores/execution/store'
import {
  clearExecutionPointer,
  consolePersistence,
  type ExecutionPointer,
  loadExecutionPointer,
  saveExecutionPointer,
  useTerminalConsoleStore,
} from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('CopilotRunToolExecution')
const activeRunToolByWorkflowId = new Map<string, string>()
const activeRunAbortByWorkflowId = new Map<string, AbortController>()
const manuallyStoppedToolCallIds = new Set<string>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resolveWorkflowInput(params: Record<string, unknown>): unknown {
  if (Object.hasOwn(params, 'workflow_input')) {
    return params.workflow_input
  }
  if (Object.hasOwn(params, 'input')) {
    return params.input
  }
  return undefined
}

function resolveTriggerBlockId(params: Record<string, unknown>): string | undefined {
  return typeof params.triggerBlockId === 'string' && params.triggerBlockId.length > 0
    ? params.triggerBlockId
    : undefined
}

function getRunningExecutionPointer(workflowId: string): ExecutionPointer | null {
  const runningEntries = useTerminalConsoleStore
    .getState()
    .getWorkflowEntries(workflowId)
    .filter((entry) => entry.isRunning && entry.executionId)

  if (runningEntries.length === 0) {
    return null
  }

  const latestEntry = [...runningEntries].sort((a, b) => {
    const aStartedAt = a.startedAt ? new Date(a.startedAt).getTime() : 0
    const bStartedAt = b.startedAt ? new Date(b.startedAt).getTime() : 0
    return bStartedAt - aStartedAt
  })[0]

  const executionId = latestEntry?.executionId
  if (!executionId) {
    return null
  }

  return {
    workflowId,
    executionId,
    lastEventId: 0,
  }
}

async function findRecoverableExecutionPointer(
  workflowId: string
): Promise<ExecutionPointer | null> {
  const pointer = await loadExecutionPointer(workflowId)
  if (pointer?.executionId) {
    return pointer
  }

  return getRunningExecutionPointer(workflowId)
}

export async function bindRunToolToExecution(
  toolCallId: string,
  workflowId: string
): Promise<boolean> {
  const executionPointer = await findRecoverableExecutionPointer(workflowId)
  if (!executionPointer) {
    return false
  }

  const existingToolCallId = activeRunToolByWorkflowId.get(workflowId)
  if (existingToolCallId && existingToolCallId !== toolCallId) {
    logger.warn('[RunTool] Recovery skipped: another run tool is already active', {
      workflowId,
      toolCallId,
      existingToolCallId,
    })
    return false
  }

  useWorkflowRegistry.getState().setActiveWorkflow(workflowId)
  activeRunToolByWorkflowId.set(workflowId, toolCallId)

  const { setCurrentExecutionId, setIsExecuting } = useExecutionStore.getState()
  setIsExecuting(workflowId, true)
  setCurrentExecutionId(workflowId, executionPointer.executionId)
  saveExecutionPointer(executionPointer)

  logger.info('[RunTool] Reattached tool call to existing workflow execution', {
    workflowId,
    toolCallId,
    executionId: executionPointer.executionId,
    lastEventId: executionPointer.lastEventId,
  })

  return true
}

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
      error: toError(err).message,
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
  return toolCallId
}

export function isRunToolActiveForId(toolCallId: string): boolean {
  for (const activeId of activeRunToolByWorkflowId.values()) {
    if (activeId === toolCallId) return true
  }
  return false
}

export function cancelRunToolExecution(workflowId: string): void {
  const controller = activeRunAbortByWorkflowId.get(workflowId)
  if (!controller) return
  controller.abort('user_stop:cancelRunToolExecution')
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
  }

  await reportCompletion(
    toolCallId,
    MothershipStreamV1ToolOutcome.cancelled,
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
    await reportCompletion(
      toolCallId,
      MothershipStreamV1ToolOutcome.error,
      'No active workflow found'
    )
    return
  }

  const existingToolCallId = activeRunToolByWorkflowId.get(targetWorkflowId)
  if (existingToolCallId) {
    logger.warn('[RunTool] Execution prevented: another run tool is already active', {
      toolCallId,
      toolName,
      existingToolCallId,
    })
    await reportCompletion(
      toolCallId,
      MothershipStreamV1ToolOutcome.error,
      'Workflow is already being executed by another tool. Wait for it to complete.'
    )
    return
  }

  setActiveWorkflow(targetWorkflowId)
  activeRunToolByWorkflowId.set(targetWorkflowId, toolCallId)

  const { getWorkflowExecution, setIsExecuting } = useExecutionStore.getState()
  const { isExecuting } = getWorkflowExecution(targetWorkflowId)

  if (isExecuting) {
    logger.warn('[RunTool] Execution prevented: already executing', { toolCallId, toolName })
    activeRunToolByWorkflowId.delete(targetWorkflowId)
    await reportCompletion(
      toolCallId,
      MothershipStreamV1ToolOutcome.error,
      'Workflow is already executing. Try again later'
    )
    return
  }

  // Extract params for all tool types
  const workflowInput = resolveWorkflowInput(params)
  const triggerBlockId = resolveTriggerBlockId(params)
  const useDraftState = params.useDeployedState !== true

  const stopAfterBlockId = (() => {
    if (toolName === RunWorkflowUntilBlock.id) return params.stopAfterBlockId as string | undefined
    if (toolName === RunBlock.id) return params.blockId as string | undefined
    return undefined
  })()

  const runFromBlock = (() => {
    if (toolName === RunFromBlock.id && params.startBlockId) {
      return {
        startBlockId: params.startBlockId as string,
        executionId: (params.executionId as string | undefined) || 'latest',
      }
    }
    if (toolName === RunBlock.id && params.blockId) {
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
  const executionId = generateId()
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
    triggerBlockId,
    useDraftState,
    stopAfterBlockId,
    runFromBlock: runFromBlock ? { startBlockId: runFromBlock.startBlockId } : undefined,
  })

  try {
    const result = await executeWorkflowWithFullLogging({
      workflowId: targetWorkflowId,
      workflowInput,
      executionId,
      overrideTriggerType: 'copilot',
      triggerBlockId,
      useDraftState,
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
      await reportCompletion(
        toolCallId,
        MothershipStreamV1ToolOutcome.success,
        `Workflow execution completed. Started at: ${executionStartTime}`,
        buildResultData(result)
      )
    } else {
      const msg = errorMessage || 'Workflow execution failed'
      logger.error('[RunTool] Workflow execution failed', { toolCallId, toolName, error: msg })
      await reportCompletion(
        toolCallId,
        MothershipStreamV1ToolOutcome.error,
        msg,
        buildResultData(result)
      )
    }
  } catch (err) {
    if (manuallyStoppedToolCallIds.has(toolCallId)) {
      logger.info('[RunTool] Skipping error completion — already manually stopped', {
        toolCallId,
        toolName,
      })
    } else {
      const msg = toError(err).message
      logger.error('[RunTool] Workflow execution threw', { toolCallId, toolName, error: msg })
      await reportCompletion(toolCallId, MothershipStreamV1ToolOutcome.error, msg)
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
  status: MothershipStreamV1ToolOutcome,
  message?: string,
  data?: AsyncCompletionData
): Promise<void> {
  try {
    const body = JSON.stringify({
      toolCallId,
      status,
      message: message || (status === 'success' ? 'Tool completed' : 'Tool failed'),
      ...(data !== undefined ? { data } : {}),
    })
    const res = await fetch(COPILOT_CONFIRM_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...traceparentHeader() },
      body,
    })
    const LARGE_PAYLOAD_THRESHOLD = 10 * 1024 * 1024
    const bodySize = new Blob([body]).size
    if (!res.ok && isRecord(data) && bodySize > LARGE_PAYLOAD_THRESHOLD) {
      const { logs: _logs, ...dataWithoutLogs } = data
      logger.warn('[RunTool] reportCompletion failed with large payload, retrying without logs', {
        toolCallId,
        status: res.status,
        bodySize,
      })
      const retryRes = await fetch(COPILOT_CONFIRM_API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...traceparentHeader() },
        body: JSON.stringify({
          toolCallId,
          status,
          message: message || (status === 'success' ? 'Tool completed' : 'Tool failed'),
          data: dataWithoutLogs,
        }),
      })
      if (!retryRes.ok) {
        logger.warn('[RunTool] reportCompletion retry also failed', {
          toolCallId,
          status: retryRes.status,
        })
      }
    } else if (!res.ok) {
      logger.warn('[RunTool] reportCompletion failed', { toolCallId, status: res.status })
    }
  } catch (err) {
    logger.error('[RunTool] reportCompletion error', {
      toolCallId,
      error: toError(err).message,
    })
  }
}
