import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { backoffWithJitter } from '@sim/utils/retry'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  cancelWorkflowExecutionContract,
  getWorkflowExecutionContract,
} from '@/lib/api/contracts/workflows'
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
  getWorkflowToolCompletionMessage,
  getWorkflowToolLaunchError,
  WORKFLOW_EXECUTION_BUSY,
  type WorkflowToolLaunchError,
} from '@/lib/mothership/tools/workflow-tools'
import { executeWorkflowWithFullLogging } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils'
import {
  isExecutionStreamHttpError,
  isReconnectStreamOpen,
  SSEEventHandlerError,
  SSEStreamInterruptedError,
} from '@/hooks/use-execution-stream'
import { useExecutionStore } from '@/stores/execution/store'
import {
  clearExecutionPointer,
  consolePersistence,
  loadExecutionPointer,
  saveExecutionPointer,
  useTerminalConsoleStore,
} from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('CopilotRunToolExecution')
interface ActiveRunTool {
  toolCallId: string
  execution?: { id: string; controller: AbortController }
}

/** A run tool queued behind the workflow's owner; admitted with null when stopped first. */
interface WaitingRunTool {
  toolCallId: string
  admit: (run: ActiveRunTool | null) => void
}

/**
 * Who holds a workflow's single visible run in this tab: a run tool, or an execution
 * whose run tool lost its stream while the server kept running it.
 */
type RunSlotOwner =
  | { kind: 'runTool'; run: ActiveRunTool }
  | { kind: 'interrupted'; executionId: string }

interface WorkflowRunSlot {
  owner: RunSlotOwner | null
  waiters: WaitingRunTool[]
  watchingInterrupted: boolean
}

const runSlotsByWorkflowId = new Map<string, WorkflowRunSlot>()
const INTERRUPTED_RUN_POLL_MAX_MS = 15_000
const INTERRUPTED_RUN_MAX_STATUS_FAILURES = 8
const manuallyStoppedToolCallIds = new Set<string>()
type RunToolReleaseListener = (workflowId: string) => void
const runToolReleaseListeners = new Set<RunToolReleaseListener>()
const PENDING_COMPLETION_STORAGE_PREFIX = 'sim:copilot:run-tool-completion:'

/**
 * Tab-local record of a completion this tab still owes Sim for a tool call,
 * written just before the report is sent and cleared once it lands, so a reload
 * mid-report can re-send it instead of re-running the tool.
 */
interface PendingCompletionReport {
  status: AsyncConfirmationStatus
  executionId?: string
  /**
   * Written by earlier clients for async launches, which also wrote a terminal
   * execution pointer for a run that has no reconnectable stream. Honoured so
   * that pointer is cleaned up once the pending report is delivered.
   */
  clearExecutionPointerAfterReport?: boolean
}

function slotFor(workflowId: string): WorkflowRunSlot {
  let slot = runSlotsByWorkflowId.get(workflowId)
  if (!slot) {
    slot = { owner: null, waiters: [], watchingInterrupted: false }
    runSlotsByWorkflowId.set(workflowId, slot)
  }
  return slot
}

function pruneSlot(workflowId: string, slot: WorkflowRunSlot): void {
  if (!slot.owner && slot.waiters.length === 0) runSlotsByWorkflowId.delete(workflowId)
}

/** Whether a new run tool for this workflow has to queue. */
function isSlotHeld(workflowId: string): boolean {
  return runSlotsByWorkflowId.has(workflowId)
}

function runToolOwner(workflowId: string): ActiveRunTool | undefined {
  const owner = runSlotsByWorkflowId.get(workflowId)?.owner
  return owner?.kind === 'runTool' ? owner.run : undefined
}

function* runToolOwners(): Generator<[string, ActiveRunTool]> {
  for (const [workflowId, slot] of runSlotsByWorkflowId) {
    if (slot.owner?.kind === 'runTool') yield [workflowId, slot.owner.run]
  }
}

/**
 * Takes the workflow's run slot, or waits in arrival order behind its owner.
 * Resolves null when the call is stopped while waiting.
 */
function acquireRunToolSlot(workflowId: string, toolCallId: string): Promise<ActiveRunTool | null> {
  if (!isSlotHeld(workflowId)) {
    const run: ActiveRunTool = { toolCallId }
    slotFor(workflowId).owner = { kind: 'runTool', run }
    return Promise.resolve(run)
  }
  const slot = slotFor(workflowId)
  logger.info("[RunTool] Waiting for this workflow's current run", {
    toolCallId,
    workflowId,
    owner: slot.owner?.kind === 'runTool' ? slot.owner.run.toolCallId : slot.owner?.kind,
  })
  return new Promise((admit) => {
    slot.waiters.push({ toolCallId, admit })
    if (slot.owner?.kind === 'interrupted') watchInterruptedExecution(workflowId, slot)
  })
}

/** Runs synchronously with the release that freed the slot, so a later call cannot jump ahead. */
function admitNextRunTool(workflowId: string, slot: WorkflowRunSlot): void {
  if (!slot.owner) {
    const next = slot.waiters.shift()
    if (next) {
      const run: ActiveRunTool = { toolCallId: next.toolCallId }
      slot.owner = { kind: 'runTool', run }
      next.admit(run)
    }
  }
  pruneSlot(workflowId, slot)
}

/**
 * Gives up a run tool's slot. A run whose stream dropped while the server kept
 * executing it hands the slot to that execution instead, until it settles.
 */
function releaseRunToolSlot(
  workflowId: string,
  run: ActiveRunTool,
  interruptedExecutionId?: string
): void {
  const slot = runSlotsByWorkflowId.get(workflowId)
  if (!slot || runToolOwner(workflowId) !== run) return
  slot.owner = interruptedExecutionId
    ? { kind: 'interrupted', executionId: interruptedExecutionId }
    : null
  admitNextRunTool(workflowId, slot)
  if (interruptedExecutionId && slot.waiters.length > 0) {
    watchInterruptedExecution(workflowId, slot)
  }
}

async function releaseInterruptedHold(
  workflowId: string,
  slot: WorkflowRunSlot,
  executionId: string
): Promise<void> {
  if (slot.owner?.kind !== 'interrupted' || slot.owner.executionId !== executionId) return
  // A reconnect cancelled by navigating away leaves the settled run marked current and its
  // pointer saved; both go before the next run can write its own.
  clearVisibleExecution(workflowId, executionId)
  const pointer = await loadExecutionPointer(workflowId).catch(() => null)
  if (pointer?.executionId === executionId) await clearExecutionPointer(workflowId)
  slot.owner = null
  admitNextRunTool(workflowId, slot)
}

/**
 * Polls an interrupted execution while calls wait behind it, releasing the hold once
 * the server has settled it and no reconnect stream is still draining it.
 */
function watchInterruptedExecution(workflowId: string, slot: WorkflowRunSlot): void {
  if (slot.watchingInterrupted || slot.owner?.kind !== 'interrupted') return
  slot.watchingInterrupted = true
  const { executionId } = slot.owner
  const isHeldByThisExecution = () =>
    slot.owner?.kind === 'interrupted' && slot.owner.executionId === executionId
  void (async () => {
    let serverSettled = false
    let statusFailures = 0
    for (let attempt = 1; ; attempt++) {
      await sleep(backoffWithJitter(attempt, null, { maxMs: INTERRUPTED_RUN_POLL_MAX_MS }))
      if (!isHeldByThisExecution() || slot.waiters.length === 0) break
      if (isDocumentHidden() || isReconnectStreamOpen(workflowId, executionId)) continue
      if (!serverSettled) {
        const status = await readExecutionStatus(workflowId, executionId)
        if (status === 'running') continue
        if (status === 'unknown' && ++statusFailures < INTERRUPTED_RUN_MAX_STATUS_FAILURES) continue
        serverSettled = true
        if (isReconnectStreamOpen(workflowId, executionId)) continue
      }
      await releaseInterruptedHold(workflowId, slot, executionId)
      break
    }
    slot.watchingInterrupted = false
  })()
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

/** 'settled' also covers an execution that is gone or not ours (403/404). */
async function readExecutionStatus(
  workflowId: string,
  executionId: string
): Promise<'running' | 'settled' | 'unknown'> {
  try {
    const { status } = await requestJson(getWorkflowExecutionContract, {
      params: { id: workflowId, executionId },
      query: {},
    })
    return status === 'queued' || status === 'pending' || status === 'running'
      ? 'running'
      : 'settled'
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 403 || error.status === 404)) {
      return 'settled'
    }
    logger.warn("[RunTool] Could not read an interrupted execution's status", {
      workflowId,
      executionId,
      error: toError(error).message,
    })
    return 'unknown'
  }
}

function isRunToolWaiting(workflowId: string, toolCallId: string): boolean {
  return (
    runSlotsByWorkflowId.get(workflowId)?.waiters.some((w) => w.toolCallId === toolCallId) ?? false
  )
}

function dropWaitingRunTools(toolCallIds: ReadonlySet<string>): void {
  for (const [workflowId, slot] of runSlotsByWorkflowId) {
    const kept: WaitingRunTool[] = []
    for (const waiter of slot.waiters) {
      if (toolCallIds.has(waiter.toolCallId)) waiter.admit(null)
      else kept.push(waiter)
    }
    slot.waiters = kept
    pruneSlot(workflowId, slot)
  }
}

/** Clears the editor's visible run when it still shows `executionId`; returns whether it did. */
function clearVisibleExecution(workflowId: string, executionId: string): boolean {
  const state = useExecutionStore.getState()
  if (state.getCurrentExecutionId(workflowId) !== executionId) return false
  state.setCurrentExecutionId(workflowId, null)
  state.setIsExecuting(workflowId, false)
  state.setActiveBlocks(workflowId, new Set())
  return true
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
  let launchError: WorkflowToolLaunchError | undefined
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
    launchError = getWorkflowToolLaunchError(responseBody)
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
        launchError?.message ??
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
      ...(launchError ? { code: launchError.code } : {}),
    })
    return
  }

  const pendingCompletion: PendingCompletionReport = {
    status: ASYNC_TOOL_CONFIRMATION_STATUS.background,
    executionId: responseExecutionId,
  }
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

/**
 * Re-binds a tool call that the server still shows as executing to whatever
 * this tab already knows about it, instead of running the tool again.
 *
 * Two tab-local records can answer: a pending completion report (a report this
 * tab owed Sim and never delivered) is re-sent as is, and otherwise a terminal
 * execution pointer (a live run this tab was observing) is reported as
 * continuing in the background. With neither, the caller runs the tool.
 */
export async function bindRunToolToExecution(
  toolCallId: string,
  workflowId: string
): Promise<boolean> {
  const owner = runSlotsByWorkflowId.get(workflowId)?.owner
  const ownerToolCallId = owner?.kind === 'runTool' ? owner.run.toolCallId : undefined
  if (ownerToolCallId === toolCallId || isRunToolWaiting(workflowId, toolCallId)) {
    logger.info('[RunTool] Recovery skipped: run tool is already active in this tab', {
      workflowId,
      toolCallId,
    })
    return true
  }
  // Another run's pointer says nothing about this call.
  const otherRunOwnsWorkflow = owner != null
  const pointer = otherRunOwnsWorkflow
    ? null
    : await loadExecutionPointer(workflowId).catch(() => null)
  const pendingCompletion = loadPendingCompletionReport(toolCallId)
  if (pendingCompletion) {
    const executionId = pendingCompletion.executionId ?? pointer?.executionId
    logger.info('[RunTool] Recovery re-sending pending completion report', {
      workflowId,
      toolCallId,
      executionId,
      status: pendingCompletion.status,
    })
    try {
      await reportCompletion(
        toolCallId,
        pendingCompletion.status,
        getWorkflowToolCompletionMessage(pendingCompletion.status),
        pendingCompletion.status === MothershipStreamV1ToolOutcome.cancelled
          ? { reason: 'user_cancelled', cancelledByUser: true }
          : undefined,
        executionId
      )
      clearPendingCompletionReport(toolCallId)
      if (pendingCompletion.clearExecutionPointerAfterReport && !otherRunOwnsWorkflow) {
        await clearExecutionPointer(workflowId)
      }
    } catch (error) {
      logger.warn('[RunTool] Failed to report recovered terminal completion', {
        workflowId,
        toolCallId,
        executionId,
        error: toError(error).message,
      })
    }
    return true
  }

  if (otherRunOwnsWorkflow) {
    logger.warn('[RunTool] Recovery skipped: another run owns this workflow', {
      workflowId,
      toolCallId,
      owner: ownerToolCallId ?? owner.kind,
    })
    return false
  }

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

export function isRunToolActiveForId(toolCallId: string): boolean {
  for (const [, run] of runToolOwners()) {
    if (run.toolCallId === toolCallId) return true
  }
  return false
}

/**
 * Whether a client run tool in this tab currently owns the workflow's run.
 *
 * While it does, its live execute stream is the source of truth for the run and
 * for the completion it reports to Sim, so the terminal's reconnect flow must
 * not claim the execution pointer the tool writes before the server has
 * acknowledged the run.
 */
export function isRunToolActiveForWorkflow(workflowId: string): boolean {
  return runToolOwner(workflowId) !== undefined
}

/**
 * Subscribes to a client run tool releasing a workflow run whose stream dropped
 * before the run finished. The run keeps executing server-side and its
 * execution pointer is retained, so a subscriber that can re-attach to the
 * execution stream should do so once this fires. It does not fire for runs the
 * tool observed to completion, even when reporting that completion failed.
 */
export function subscribeToRunToolRelease(listener: RunToolReleaseListener): () => void {
  runToolReleaseListeners.add(listener)
  return () => {
    runToolReleaseListeners.delete(listener)
  }
}

function notifyRunToolReleased(workflowId: string): void {
  for (const listener of runToolReleaseListeners) {
    listener(workflowId)
  }
}

/** The resource's Stop button refers to its displayed execution, which may be a manual run. */
export function stopRunToolForExecution(workflowId: string, executionId: string | null): boolean {
  const active = runToolOwner(workflowId)
  if (!executionId || active?.execution?.id !== executionId) return false
  stopRunToolExecutions(new Set([active.toolCallId]))
  return true
}

/** Cancels exact tool-owned executions; a workflow's current UI pointer is not ownership. */
export function stopRunToolExecutions(toolCallIds: ReadonlySet<string>): void {
  dropWaitingRunTools(toolCallIds)
  for (const [workflowId, active] of runToolOwners()) {
    const { toolCallId, execution } = active
    if (!toolCallIds.has(toolCallId) || !execution || manuallyStoppedToolCallIds.has(toolCallId)) {
      continue
    }
    manuallyStoppedToolCallIds.add(toolCallId)
    execution.controller.abort('user_stop:stopRunToolExecutions')
    requestJson(cancelWorkflowExecutionContract, {
      params: { id: workflowId, executionId: execution.id },
    }).catch((error) => logger.warn('Workflow cancellation request failed', { toolCallId, error }))
    reportCompletion(
      toolCallId,
      MothershipStreamV1ToolOutcome.cancelled,
      getWorkflowToolCompletionMessage(MothershipStreamV1ToolOutcome.cancelled),
      { reason: 'user_cancelled', cancelledByUser: true },
      execution.id
    ).catch((error) => logger.warn('Workflow stop report failed', { toolCallId, error }))

    const consoleStore = useTerminalConsoleStore.getState()
    consoleStore.cancelRunningEntries(workflowId, execution.id)
    const now = new Date().toISOString()
    consoleStore.addConsole({
      input: {},
      output: {},
      success: false,
      error: 'Run was cancelled',
      durationMs: 0,
      startedAt: now,
      executionOrder: Number.MAX_SAFE_INTEGER,
      endedAt: now,
      workflowId,
      blockId: 'cancelled',
      executionId: execution.id,
      blockName: 'Run Cancelled',
      blockType: 'cancelled',
    })
    if (clearVisibleExecution(workflowId, execution.id)) clearExecutionPointer(workflowId)
  }
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

  const activeRun = await acquireRunToolSlot(targetWorkflowId, toolCallId)
  if (!activeRun) {
    logger.info('[RunTool] Stopped before its turn to run', { toolCallId, toolName })
    await reportCompletion(
      toolCallId,
      MothershipStreamV1ToolOutcome.cancelled,
      getWorkflowToolCompletionMessage(MothershipStreamV1ToolOutcome.cancelled),
      { reason: 'user_cancelled', cancelledByUser: true }
    )
    return
  }

  setActiveWorkflow(targetWorkflowId)

  const { getWorkflowExecution, setIsExecuting } = useExecutionStore.getState()
  const { isExecuting } = getWorkflowExecution(targetWorkflowId)

  // The previous run tool has already released the workflow, so a run here is
  // one no run tool drives: the user's, or a dropped stream being re-attached.
  if (isExecuting) {
    logger.warn('[RunTool] Execution prevented: already executing', { toolCallId, toolName })
    releaseRunToolSlot(targetWorkflowId, activeRun)
    await reportCompletion(
      toolCallId,
      MothershipStreamV1ToolOutcome.error,
      WORKFLOW_EXECUTION_BUSY.message,
      { code: WORKFLOW_EXECUTION_BUSY.code }
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
      releaseRunToolSlot(targetWorkflowId, activeRun)
    }
    return
  }

  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined

  const stopAfterBlockId = (() => {
    if (toolName === RunWorkflowUntilBlock.id) return asString(params.stopAfterBlockId)
    if (toolName === RunBlock.id) return asString(params.blockId)
    return undefined
  })()

  const runFromBlock = (() => {
    // Mocked upstream outputs ride through to the server, which overlays them on
    // the latest snapshot — or runs purely from them when no execution exists.
    const variableInputs = isPlainRecord(params.variableInputs)
      ? (params.variableInputs as Record<string, unknown>)
      : undefined
    const startBlockId = asString(params.startBlockId)
    const blockId = asString(params.blockId)
    if (toolName === RunFromBlock.id && startBlockId) {
      return {
        startBlockId,
        executionId: asString(params.executionId) ?? 'latest',
        ...(variableInputs ? { variableInputs } : {}),
      }
    }
    if (toolName === RunBlock.id && blockId) {
      return {
        startBlockId: blockId,
        executionId: asString(params.executionId) ?? 'latest',
        ...(variableInputs ? { variableInputs } : {}),
      }
    }
    return undefined
  })()

  const { setCurrentExecutionId } = useExecutionStore.getState()
  const abortController = new AbortController()

  const persistenceExecution = consolePersistence.executionStarted()
  setIsExecuting(targetWorkflowId, true)
  const executionId = generateId()
  activeRun.execution = { id: executionId, controller: abortController }
  setCurrentExecutionId(targetWorkflowId, executionId)
  saveExecutionPointer({ workflowId: targetWorkflowId, executionId, lastEventId: 0 })
  const releaseVisibleExecutionForBackground = () => {
    if (
      runToolOwner(targetWorkflowId) === activeRun &&
      clearVisibleExecution(targetWorkflowId, executionId)
    ) {
      consolePersistence.executionEnded(persistenceExecution)
    }
  }

  const onPageHide = () => {
    if (manuallyStoppedToolCallIds.has(toolCallId)) return
    navigator.sendBeacon(
      COPILOT_CONFIRM_API_PATH,
      new Blob(
        [
          JSON.stringify({
            toolCallId,
            executionId,
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
  let interruptedExecutionId: string | undefined

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
        executionId,
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
        executionId,
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
        interruptedExecutionId = err.executionId ?? executionId
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
        executionId
      )
    }
  } finally {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide)
    }
    manuallyStoppedToolCallIds.delete(toolCallId)
    const ownsRegistration = runToolOwner(targetWorkflowId) === activeRun
    consolePersistence.executionEnded(persistenceExecution)
    if (
      ownsRegistration &&
      !leaveExecutionRecoverable &&
      clearVisibleExecution(targetWorkflowId, executionId)
    ) {
      clearExecutionPointer(targetWorkflowId)
    }
    releaseRunToolSlot(targetWorkflowId, activeRun, interruptedExecutionId)
    if (ownsRegistration && interruptedExecutionId) notifyRunToolReleased(targetWorkflowId)
  }
}
