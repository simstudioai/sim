import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  type AsyncConfirmationStatus,
} from '@/lib/mothership/async-runs/lifecycle'
import {
  COPILOT_CONFIRM_API_PATH,
  COPILOT_WORKFLOW_EXECUTION_CONFLICT_CODE,
} from '@/lib/mothership/constants'
import { MothershipStreamV1ToolOutcome } from '@/lib/mothership/generated/mothership-stream-v1'
import {
  RunBlock,
  RunFromBlock,
  RunWorkflow,
  RunWorkflowUntilBlock,
} from '@/lib/mothership/generated/tool-catalog-v1'
import {
  CompletionReportError,
  reportClientToolCompletion as reportCompletion,
} from '@/lib/mothership/tools/client/completion'
import {
  type AsyncWorkflowDeploymentError,
  getAsyncWorkflowDeploymentError,
  getWorkflowToolCompletionMessage,
} from '@/lib/mothership/tools/workflow-tools'
import { executeWorkflowWithFullLogging } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils'
import {
  isExecutionStreamHttpError,
  SSEEventHandlerError,
  SSEStreamInterruptedError,
} from '@/hooks/use-execution-stream'
import { useExecutionStore } from '@/stores/execution/store'
import {
  clearExecutionPointer,
  consolePersistence,
  loadExecutionPointer,
  saveExecutionPointer,
} from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('CopilotRunToolExecution')
const activeRunToolByWorkflowId = new Map<string, string>()
const activeRunAbortByWorkflowId = new Map<string, AbortController>()
const manuallyStoppedToolCallIds = new Set<string>()
const PENDING_COMPLETION_STORAGE_PREFIX = 'sim:copilot:run-tool-completion:'

interface PendingCompletionReport {
  status: AsyncConfirmationStatus
  executionId?: string
  clearExecutionPointerAfterReport?: boolean
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

/** The execute endpoint's "this tool call is already bound to another run" body. */
function isWorkflowExecutionConflict(responseBody: unknown): boolean {
  return (
    isPlainRecord(responseBody) && responseBody.code === COPILOT_WORKFLOW_EXECUTION_CONFLICT_CODE
  )
}

async function enqueueAsyncWorkflowRun(
  toolCallId: string,
  workflowId: string,
  params: Record<string, unknown>,
  workflowInput: unknown,
  triggerBlockId: string | undefined
): Promise<void> {
  const requestedExecutionId = generateId()
  const inputFromExecutionId =
    typeof params.inputFromExecutionId === 'string' && params.inputFromExecutionId.length > 0
      ? params.inputFromExecutionId
      : undefined

  logger.info('[RunTool] Queueing asynchronous workflow execution', {
    toolCallId,
    workflowId,
    executionId: requestedExecutionId,
    hasInput: workflowInput !== undefined,
    triggerBlockId,
  })

  let responseExecutionId = requestedExecutionId
  let acceptanceIsAmbiguous = false
  let deploymentError: AsyncWorkflowDeploymentError | undefined
  try {
    // boundary-raw-fetch: this execution endpoint switches to a JSON 202 response via X-Execution-Mode
    const response = await fetch(`/api/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Execution-Mode': 'async',
      },
      body: JSON.stringify({
        input: workflowInput,
        executionId: requestedExecutionId,
        triggerType: 'copilot',
        isClientSession: true,
        copilotToolCallId: toolCallId,
        ...(triggerBlockId ? { triggerBlockId } : {}),
        ...(workflowInput === undefined && inputFromExecutionId ? { inputFromExecutionId } : {}),
      }),
    })
    const responseBody: unknown = await response.json().catch(() => undefined)
    deploymentError = getAsyncWorkflowDeploymentError(responseBody)
    responseExecutionId =
      isPlainRecord(responseBody) && typeof responseBody.executionId === 'string'
        ? responseBody.executionId
        : requestedExecutionId
    acceptanceIsAmbiguous =
      isPlainRecord(responseBody) && responseBody.code === 'ASYNC_ENQUEUE_AMBIGUOUS'

    // Someone else — another tab, or the server's own fallback — already owns
    // this tool call. Stay silent so the winner reports the result; reporting
    // an error here would overwrite a run that is happily in flight. Mirrors
    // the streamed path's handling of the same conflict.
    if (response.status === 409 && isWorkflowExecutionConflict(responseBody)) {
      logger.info('[RunTool] Ignoring duplicate async workflow launch', {
        toolCallId,
        workflowId,
      })
      return
    }

    if (!response.ok && !acceptanceIsAmbiguous) {
      const responseError =
        deploymentError?.message ??
        (isPlainRecord(responseBody) && typeof responseBody.error === 'string'
          ? responseBody.error
          : `Async workflow queue request failed with status ${response.status}`)
      throw new Error(responseError)
    }
  } catch (error) {
    const message = toError(error).message
    logger.error('[RunTool] Failed to queue asynchronous workflow execution', {
      toolCallId,
      workflowId,
      error: message,
    })
    await reportCompletion(toolCallId, MothershipStreamV1ToolOutcome.error, message, {
      success: false,
      workflowId,
      ...(deploymentError ? { code: deploymentError.code } : {}),
    })
    return
  }

  const pendingCompletion: PendingCompletionReport = {
    status: ASYNC_TOOL_CONFIRMATION_STATUS.background,
    executionId: responseExecutionId,
    clearExecutionPointerAfterReport: true,
  }
  await saveExecutionPointer({
    workflowId,
    executionId: responseExecutionId,
    lastEventId: 0,
  })
  savePendingCompletionReport(toolCallId, pendingCompletion)

  try {
    await reportCompletion(
      toolCallId,
      pendingCompletion.status,
      getWorkflowToolCompletionMessage(pendingCompletion.status),
      undefined,
      pendingCompletion.executionId
    )
    clearPendingCompletionReport(toolCallId)
    await clearExecutionPointer(workflowId)
  } catch (error) {
    logger.error(
      '[RunTool] Async workflow was queued but background status could not be reported',
      {
        toolCallId,
        workflowId,
        executionId: responseExecutionId,
        error: toError(error).message,
      }
    )
    return
  }

  logger.info('[RunTool] Asynchronous workflow execution queued', {
    toolCallId,
    workflowId,
    executionId: responseExecutionId,
    acceptanceIsAmbiguous,
  })
}

function pendingCompletionStorageKey(toolCallId: string): string {
  return `${PENDING_COMPLETION_STORAGE_PREFIX}${toolCallId}`
}

function savePendingCompletionReport(toolCallId: string, report: PendingCompletionReport): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(pendingCompletionStorageKey(toolCallId), JSON.stringify(report))
  } catch (error) {
    logger.warn('[RunTool] Failed to persist pending completion report', {
      toolCallId,
      error: toError(error).message,
    })
  }
}

function loadPendingCompletionReport(toolCallId: string): PendingCompletionReport | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(pendingCompletionStorageKey(toolCallId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingCompletionReport
    return parsed?.status ? parsed : null
  } catch (error) {
    logger.warn('[RunTool] Failed to load pending completion report', {
      toolCallId,
      error: toError(error).message,
    })
    return null
  }
}

function clearPendingCompletionReport(toolCallId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(pendingCompletionStorageKey(toolCallId))
  } catch (error) {
    logger.warn('[RunTool] Failed to clear pending completion report', {
      toolCallId,
      error: toError(error).message,
    })
  }
}

export async function bindRunToolToExecution(
  toolCallId: string,
  workflowId: string
): Promise<boolean> {
  const existingToolCallId = activeRunToolByWorkflowId.get(workflowId)
  if (existingToolCallId === toolCallId) {
    logger.info('[RunTool] Recovery skipped: run tool is already active in this tab', {
      workflowId,
      toolCallId,
    })
    return true
  }
  if (existingToolCallId && existingToolCallId !== toolCallId) {
    logger.warn('[RunTool] Recovery skipped: another run tool is already active', {
      workflowId,
      toolCallId,
      existingToolCallId,
    })
    return false
  }

  const pointer = await loadExecutionPointer(workflowId).catch(() => null)
  if (!pointer?.executionId) {
    logger.info('[RunTool] Recovery skipped: no tab-local execution pointer', {
      workflowId,
      toolCallId,
    })
    return false
  }

  logger.info('[RunTool] Recovery moved to background for existing execution pointer', {
    workflowId,
    toolCallId,
    executionId: pointer.executionId,
  })
  const pendingCompletion = loadPendingCompletionReport(toolCallId)
  if (pendingCompletion) {
    try {
      await reportCompletion(
        toolCallId,
        pendingCompletion.status,
        getWorkflowToolCompletionMessage(pendingCompletion.status),
        pendingCompletion.status === MothershipStreamV1ToolOutcome.cancelled
          ? { reason: 'user_cancelled', cancelledByUser: true }
          : undefined,
        pendingCompletion.executionId ?? pointer.executionId
      )
      clearPendingCompletionReport(toolCallId)
      if (pendingCompletion.clearExecutionPointerAfterReport) {
        await clearExecutionPointer(workflowId)
      }
    } catch (error) {
      logger.warn('[RunTool] Failed to report recovered terminal completion', {
        workflowId,
        toolCallId,
        executionId: pointer.executionId,
        error: toError(error).message,
      })
    }
    return true
  }

  try {
    await reportCompletion(
      toolCallId,
      ASYNC_TOOL_CONFIRMATION_STATUS.background,
      getWorkflowToolCompletionMessage(ASYNC_TOOL_CONFIRMATION_STATUS.background),
      undefined,
      pointer.executionId
    )
  } catch (error) {
    logger.warn('[RunTool] Failed to report recovered execution as background', {
      workflowId,
      toolCallId,
      executionId: pointer.executionId,
      error: toError(error).message,
    })
  }

  return true
}

/**
 * Execute a run tool on the client side using the streaming execute endpoint.
 * This gives full interactive feedback: block pulsing, console logs, stop button.
 *
 * Mirrors staging's RunWorkflowClientTool.handleAccept():
 * 1. Execute via executeWorkflowWithFullLogging
 * 2. Update client tool state directly (success/error)
 * 3. Report a structural completion notification; the server restores the
 *    bound execution result from its log before resuming Copilot
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

  const executionId =
    useExecutionStore.getState().getCurrentExecutionId(workflowId) ??
    (await loadExecutionPointer(workflowId).catch(() => null))?.executionId

  await reportCompletion(
    toolCallId,
    MothershipStreamV1ToolOutcome.cancelled,
    getWorkflowToolCompletionMessage(MothershipStreamV1ToolOutcome.cancelled),
    {
      reason: 'user_cancelled',
      cancelledByUser: true,
    },
    executionId
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

  if (toolName === RunWorkflow.id && params.async === true) {
    try {
      await enqueueAsyncWorkflowRun(
        toolCallId,
        targetWorkflowId,
        params,
        workflowInput,
        triggerBlockId
      )
    } finally {
      if (activeRunToolByWorkflowId.get(targetWorkflowId) === toolCallId) {
        activeRunToolByWorkflowId.delete(targetWorkflowId)
      }
    }
    return
  }

  const stopAfterBlockId = (() => {
    if (toolName === RunWorkflowUntilBlock.id) return params.stopAfterBlockId as string | undefined
    if (toolName === RunBlock.id) return params.blockId as string | undefined
    return undefined
  })()

  const runFromBlock = (() => {
    // Mocked upstream outputs ride through to the server, which overlays them on
    // the latest snapshot — or runs purely from them when no execution exists.
    const variableInputs = isPlainRecord(params.variableInputs)
      ? (params.variableInputs as Record<string, unknown>)
      : undefined
    if (toolName === RunFromBlock.id && params.startBlockId) {
      return {
        startBlockId: params.startBlockId as string,
        executionId: (params.executionId as string | undefined) || 'latest',
        ...(variableInputs ? { variableInputs } : {}),
      }
    }
    if (toolName === RunBlock.id && params.blockId) {
      return {
        startBlockId: params.blockId as string,
        executionId: (params.executionId as string | undefined) || 'latest',
        ...(variableInputs ? { variableInputs } : {}),
      }
    }
    return undefined
  })()

  const { setCurrentExecutionId } = useExecutionStore.getState()
  const abortController = new AbortController()
  activeRunAbortByWorkflowId.set(targetWorkflowId, abortController)

  const persistenceExecution = consolePersistence.executionStarted()
  setIsExecuting(targetWorkflowId, true)
  const executionId = generateId()
  setCurrentExecutionId(targetWorkflowId, executionId)
  saveExecutionPointer({ workflowId: targetWorkflowId, executionId, lastEventId: 0 })
  const releaseVisibleExecutionForBackground = () => {
    const { setCurrentExecutionId: clearExecId, setActiveBlocks } = useExecutionStore.getState()
    if (activeRunToolByWorkflowId.get(targetWorkflowId) === toolCallId) {
      clearExecId(targetWorkflowId, null)
      consolePersistence.executionEnded(persistenceExecution)
      setIsExecuting(targetWorkflowId, false)
      setActiveBlocks(targetWorkflowId, new Set())
    }
  }

  const onPageHide = () => {
    if (manuallyStoppedToolCallIds.has(toolCallId)) return
    const activeExecutionId =
      useExecutionStore.getState().getCurrentExecutionId(targetWorkflowId) ?? executionId
    navigator.sendBeacon(
      COPILOT_CONFIRM_API_PATH,
      new Blob(
        [
          JSON.stringify({
            toolCallId,
            executionId: activeExecutionId,
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

  let leaveExecutionRecoverable = false

  try {
    const result = await executeWorkflowWithFullLogging({
      workflowId: targetWorkflowId,
      workflowInput,
      executionId,
      copilotToolCallId: toolCallId,
      overrideTriggerType: 'copilot',
      triggerBlockId,
      useDraftState,
      stopAfterBlockId,
      runFromBlock,
      abortSignal: abortController.signal,
      preserveExecutionOnTerminal: true,
    })

    const completedExecutionId =
      useExecutionStore.getState().getCurrentExecutionId(targetWorkflowId) ?? executionId

    // Determine success (same logic as staging's RunWorkflowClientTool)
    const succeeded =
      isPlainRecord(result) && Object.hasOwn(result, 'success')
        ? Boolean(result.success)
        : isPlainRecord(result) && isPlainRecord(result.execution)
          ? Boolean(result.execution.success)
          : true

    if (manuallyStoppedToolCallIds.has(toolCallId)) {
      logger.info('[RunTool] Skipping generic completion — already manually stopped', {
        toolCallId,
        toolName,
      })
    } else if (succeeded) {
      logger.info('[RunTool] Workflow execution succeeded', { toolCallId, toolName })
      const pendingCompletion = {
        status: MothershipStreamV1ToolOutcome.success,
        executionId: completedExecutionId,
      }
      savePendingCompletionReport(toolCallId, pendingCompletion)
      await reportCompletion(
        toolCallId,
        pendingCompletion.status,
        getWorkflowToolCompletionMessage(pendingCompletion.status),
        undefined,
        pendingCompletion.executionId
      )
      clearPendingCompletionReport(toolCallId)
    } else {
      logger.error('[RunTool] Workflow execution failed', { toolCallId, toolName })
      const pendingCompletion = {
        status: MothershipStreamV1ToolOutcome.error,
        executionId: completedExecutionId,
      }
      savePendingCompletionReport(toolCallId, pendingCompletion)
      await reportCompletion(
        toolCallId,
        pendingCompletion.status,
        getWorkflowToolCompletionMessage(pendingCompletion.status),
        undefined,
        pendingCompletion.executionId
      )
      clearPendingCompletionReport(toolCallId)
    }
  } catch (err) {
    if (manuallyStoppedToolCallIds.has(toolCallId)) {
      logger.info('[RunTool] Skipping error completion — already manually stopped', {
        toolCallId,
        toolName,
      })
    } else if (
      isExecutionStreamHttpError(err) &&
      err.httpStatus === 409 &&
      err.code === COPILOT_WORKFLOW_EXECUTION_CONFLICT_CODE
    ) {
      logger.info('[RunTool] Ignoring duplicate client workflow execution', {
        toolCallId,
        toolName,
        workflowId: targetWorkflowId,
      })
    } else {
      const msg = toError(err).message
      if (err instanceof SSEEventHandlerError || err instanceof SSEStreamInterruptedError) {
        leaveExecutionRecoverable = true
        logger.warn(
          '[RunTool] Execution stream interrupted; leaving workflow execution in background',
          {
            toolCallId,
            toolName,
            executionId: err.executionId,
            error: msg,
          }
        )
        releaseVisibleExecutionForBackground()
        await reportCompletion(
          toolCallId,
          ASYNC_TOOL_CONFIRMATION_STATUS.background,
          getWorkflowToolCompletionMessage(ASYNC_TOOL_CONFIRMATION_STATUS.background),
          undefined,
          err.executionId ?? executionId
        )
        return
      }
      if (err instanceof CompletionReportError) {
        leaveExecutionRecoverable = true
        logger.warn('[RunTool] Completion report failed; leaving workflow execution recoverable', {
          toolCallId,
          toolName,
          error: msg,
        })
        releaseVisibleExecutionForBackground()
        return
      }
      logger.error('[RunTool] Workflow execution threw', { toolCallId, toolName, error: msg })
      const failedExecutionId =
        useExecutionStore.getState().getCurrentExecutionId(targetWorkflowId) ?? executionId
      // Carry the real failure through instead of the generic "Workflow execution
      // failed." — the agent can only correct a bad request (a rejected binding,
      // an undeployed workflow) if it is told what was wrong.
      const failureCode = isExecutionStreamHttpError(err) ? err.code : undefined
      await reportCompletion(
        toolCallId,
        MothershipStreamV1ToolOutcome.error,
        msg,
        {
          success: false,
          workflowId: targetWorkflowId,
          error: msg,
          ...(failureCode ? { code: failureCode } : {}),
        },
        failedExecutionId
      )
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
    const { setCurrentExecutionId: clearExecId, setActiveBlocks } = useExecutionStore.getState()
    if (!leaveExecutionRecoverable && activeToolCallId === toolCallId) {
      clearExecId(targetWorkflowId, null)
      clearExecutionPointer(targetWorkflowId)
      consolePersistence.executionEnded(persistenceExecution)
      setIsExecuting(targetWorkflowId, false)
      setActiveBlocks(targetWorkflowId, new Set())
    }
  }
}
