import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type {
  BlockCompletedData,
  BlockErrorData,
  BlockStartedData,
} from '@/lib/workflows/executor/execution-events'
import type {
  BlockLog,
  BlockState,
  ExecutionResult,
  NormalizedBlockOutput,
  StreamingExecution,
} from '@/executor/types'
import { stripCloneSuffixes } from '@/executor/utils/subflow-utils'
import { processSSEStream } from '@/hooks/use-execution-stream'

const logger = createLogger('workflow-execution-utils')

import { useExecutionStore } from '@/stores/execution'
import type { ConsoleEntry, ConsoleUpdate } from '@/stores/terminal'
import { saveExecutionPointer, useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Updates the active blocks set and ref counts for a single block.
 * Ref counting ensures a block stays active until all parallel branches for it complete.
 */
export function updateActiveBlockRefCount(
  refCounts: Map<string, number>,
  activeSet: Set<string>,
  blockId: string,
  isActive: boolean
): void {
  if (isActive) {
    refCounts.set(blockId, (refCounts.get(blockId) ?? 0) + 1)
    activeSet.add(blockId)
  } else {
    const next = (refCounts.get(blockId) ?? 1) - 1
    if (next <= 0) {
      refCounts.delete(blockId)
      activeSet.delete(blockId)
    } else {
      refCounts.set(blockId, next)
    }
  }
}

/**
 * Determines if a workflow edge should be marked as active based on its handle and the block output.
 * Mirrors the executor's EdgeManager.shouldActivateEdge logic on the client side.
 * Exclude sentinel handles here
 */
function shouldActivateEdgeClient(
  handle: string | null | undefined,
  output: Record<string, any> | undefined
): boolean {
  if (!handle) return true

  if (handle.startsWith('condition-')) {
    return output?.selectedOption === handle.substring('condition-'.length)
  }

  if (handle.startsWith('router-')) {
    return output?.selectedRoute === handle.substring('router-'.length)
  }

  switch (handle) {
    case 'error':
      return !!output?.error
    case 'source':
      return !output?.error
    case 'loop-start-source':
    case 'loop-end-source':
    case 'parallel-start-source':
    case 'parallel-end-source':
      return true
    default:
      return true
  }
}

export function markOutgoingEdgesFromOutput(
  blockId: string,
  output: Record<string, any> | undefined,
  workflowEdges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string | null
  }>,
  workflowId: string,
  setEdgeRunStatus: (wfId: string, edgeId: string, status: 'success' | 'error') => void
): void {
  const outgoing = workflowEdges.filter((edge) => edge.source === blockId)
  for (const edge of outgoing) {
    const handle = edge.sourceHandle
    if (shouldActivateEdgeClient(handle, output)) {
      const status = handle === 'error' ? 'error' : output?.error ? 'error' : 'success'
      setEdgeRunStatus(workflowId, edge.id, status)
    }
  }
}

export interface BlockEventHandlerConfig {
  workflowId?: string
  executionIdRef: { current: string }
  workflowEdges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null }>
  activeBlocksSet: Set<string>
  activeBlockRefCounts: Map<string, number>
  accumulatedBlockLogs: BlockLog[]
  accumulatedBlockStates: Map<string, BlockState>
  executedBlockIds: Set<string>
  consoleMode: 'update' | 'add'
  includeStartConsoleEntry: boolean
  onBlockCompleteCallback?: (blockId: string, output: unknown) => Promise<void>
}

export interface BlockEventHandlerDeps {
  addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => ConsoleEntry | undefined
  updateConsole: (blockId: string, update: string | ConsoleUpdate, executionId?: string) => void
  setActiveBlocks: (workflowId: string, blocks: Set<string>) => void
  setBlockRunStatus: (workflowId: string, blockId: string, status: 'success' | 'error') => void
  setEdgeRunStatus: (workflowId: string, edgeId: string, status: 'success' | 'error') => void
}

/**
 * Creates block event handlers for SSE execution events.
 * Shared by the workflow execution hook and standalone execution utilities.
 */
export function createBlockEventHandlers(
  config: BlockEventHandlerConfig,
  deps: BlockEventHandlerDeps
) {
  const {
    workflowId,
    executionIdRef,
    workflowEdges,
    activeBlocksSet,
    activeBlockRefCounts,
    accumulatedBlockLogs,
    accumulatedBlockStates,
    executedBlockIds,
    consoleMode,
    includeStartConsoleEntry,
    onBlockCompleteCallback,
  } = config

  const { addConsole, updateConsole, setActiveBlocks, setBlockRunStatus, setEdgeRunStatus } = deps

  const isStaleExecution = () =>
    !!(
      workflowId &&
      executionIdRef.current &&
      useExecutionStore.getState().getCurrentExecutionId(workflowId) !== executionIdRef.current
    )

  const updateActiveBlocks = (blockId: string, isActive: boolean) => {
    if (!workflowId) return
    updateActiveBlockRefCount(activeBlockRefCounts, activeBlocksSet, blockId, isActive)
    setActiveBlocks(workflowId, new Set(activeBlocksSet))
  }

  const markOutgoingEdges = (blockId: string, output: Record<string, any> | undefined) => {
    if (!workflowId) return
    markOutgoingEdgesFromOutput(blockId, output, workflowEdges, workflowId, setEdgeRunStatus)
  }

  const isContainerBlockType = (blockType?: string) => {
    return blockType === 'loop' || blockType === 'parallel'
  }

  const extractIterationFields = (
    data: BlockStartedData | BlockCompletedData | BlockErrorData
  ) => ({
    iterationCurrent: data.iterationCurrent,
    iterationTotal: data.iterationTotal,
    iterationType: data.iterationType,
    iterationContainerId: data.iterationContainerId,
    parentIterations: data.parentIterations,
    childWorkflowBlockId: data.childWorkflowBlockId,
    childWorkflowName: data.childWorkflowName,
    ...('childWorkflowInstanceId' in data && {
      childWorkflowInstanceId: data.childWorkflowInstanceId,
    }),
  })

  const createBlockLogEntry = (
    data: BlockCompletedData | BlockErrorData,
    options: { success: boolean; output?: unknown; error?: string }
  ): BlockLog => ({
    blockId: data.blockId,
    blockName: data.blockName || 'Unknown Block',
    blockType: data.blockType || 'unknown',
    input: data.input || {},
    output: options.output ?? {},
    success: options.success,
    error: options.error,
    durationMs: data.durationMs,
    startedAt: data.startedAt,
    executionOrder: data.executionOrder,
    endedAt: data.endedAt,
  })

  const addConsoleEntry = (data: BlockCompletedData, output: NormalizedBlockOutput) => {
    if (!workflowId) return
    addConsole({
      input: data.input || {},
      output,
      success: true,
      durationMs: data.durationMs,
      startedAt: data.startedAt,
      executionOrder: data.executionOrder,
      endedAt: data.endedAt,
      workflowId,
      blockId: data.blockId,
      executionId: executionIdRef.current,
      blockName: data.blockName || 'Unknown Block',
      blockType: data.blockType || 'unknown',
      ...extractIterationFields(data),
    })
  }

  const addConsoleErrorEntry = (data: BlockErrorData) => {
    if (!workflowId) return
    addConsole({
      input: data.input || {},
      output: {},
      success: false,
      error: data.error,
      durationMs: data.durationMs,
      startedAt: data.startedAt,
      executionOrder: data.executionOrder,
      endedAt: data.endedAt,
      workflowId,
      blockId: data.blockId,
      executionId: executionIdRef.current,
      blockName: data.blockName || 'Unknown Block',
      blockType: data.blockType || 'unknown',
      ...extractIterationFields(data),
    })
  }

  const updateConsoleEntry = (data: BlockCompletedData) => {
    updateConsole(
      data.blockId,
      {
        executionOrder: data.executionOrder,
        input: data.input || {},
        replaceOutput: data.output,
        success: true,
        durationMs: data.durationMs,
        startedAt: data.startedAt,
        endedAt: data.endedAt,
        isRunning: false,
        ...extractIterationFields(data),
      },
      executionIdRef.current
    )
  }

  const updateConsoleErrorEntry = (data: BlockErrorData) => {
    updateConsole(
      data.blockId,
      {
        executionOrder: data.executionOrder,
        input: data.input || {},
        replaceOutput: {},
        success: false,
        error: data.error,
        durationMs: data.durationMs,
        startedAt: data.startedAt,
        endedAt: data.endedAt,
        isRunning: false,
        ...extractIterationFields(data),
      },
      executionIdRef.current
    )
  }

  const onBlockStarted = (data: BlockStartedData) => {
    if (isStaleExecution()) return
    updateActiveBlocks(data.blockId, true)

    if (!includeStartConsoleEntry || !workflowId) return

    const startedAt = new Date().toISOString()
    addConsole({
      input: {},
      output: undefined,
      success: undefined,
      durationMs: undefined,
      startedAt,
      executionOrder: data.executionOrder,
      endedAt: undefined,
      workflowId,
      blockId: data.blockId,
      executionId: executionIdRef.current,
      blockName: data.blockName || 'Unknown Block',
      blockType: data.blockType || 'unknown',
      isRunning: true,
      ...extractIterationFields(data),
    })
  }

  const onBlockCompleted = (data: BlockCompletedData) => {
    if (isStaleExecution()) return
    updateActiveBlocks(data.blockId, false)
    if (workflowId) setBlockRunStatus(workflowId, data.blockId, 'success')
    markOutgoingEdges(data.blockId, data.output as Record<string, any> | undefined)
    executedBlockIds.add(data.blockId)
    accumulatedBlockStates.set(data.blockId, {
      output: data.output,
      executed: true,
      executionTime: data.durationMs,
    })

    if (isContainerBlockType(data.blockType)) {
      const originalId = stripCloneSuffixes(data.blockId)
      if (originalId !== data.blockId) {
        executedBlockIds.add(originalId)
        if (workflowId) setBlockRunStatus(workflowId, originalId, 'success')
      }
    }

    if (isContainerBlockType(data.blockType) && !data.iterationContainerId) {
      const output = data.output as Record<string, any> | undefined
      const isEmptySubflow = Array.isArray(output?.results) && output.results.length === 0
      if (!isEmptySubflow) {
        if (includeStartConsoleEntry) {
          updateConsoleEntry(data)
        }
        return
      }
    }

    accumulatedBlockLogs.push(createBlockLogEntry(data, { success: true, output: data.output }))

    if (consoleMode === 'update') {
      updateConsoleEntry(data)
    } else {
      addConsoleEntry(data, data.output as NormalizedBlockOutput)
    }

    if (onBlockCompleteCallback) {
      onBlockCompleteCallback(data.blockId, data.output).catch((error) => {
        logger.error('Error in onBlockComplete callback:', { blockId: data.blockId, error })
      })
    }
  }

  const onBlockError = (data: BlockErrorData) => {
    if (isStaleExecution()) return
    updateActiveBlocks(data.blockId, false)
    if (workflowId) setBlockRunStatus(workflowId, data.blockId, 'error')
    markOutgoingEdges(data.blockId, { error: data.error })

    executedBlockIds.add(data.blockId)
    accumulatedBlockStates.set(data.blockId, {
      output: { error: data.error },
      executed: true,
      executionTime: data.durationMs || 0,
    })

    if (isContainerBlockType(data.blockType)) {
      const originalId = stripCloneSuffixes(data.blockId)
      if (originalId !== data.blockId) {
        executedBlockIds.add(originalId)
        if (workflowId) setBlockRunStatus(workflowId, originalId, 'error')
      }
    }

    accumulatedBlockLogs.push(
      createBlockLogEntry(data, { success: false, output: {}, error: data.error })
    )

    if (consoleMode === 'update') {
      updateConsoleErrorEntry(data)
    } else {
      addConsoleErrorEntry(data)
    }
  }

  const onBlockChildWorkflowStarted = (data: {
    blockId: string
    childWorkflowInstanceId: string
    iterationCurrent?: number
    iterationContainerId?: string
    executionOrder?: number
  }) => {
    if (isStaleExecution()) return
    updateConsole(
      data.blockId,
      {
        childWorkflowInstanceId: data.childWorkflowInstanceId,
        ...(data.iterationCurrent !== undefined && { iterationCurrent: data.iterationCurrent }),
        ...(data.iterationContainerId !== undefined && {
          iterationContainerId: data.iterationContainerId,
        }),
        ...(data.executionOrder !== undefined && { executionOrder: data.executionOrder }),
      },
      executionIdRef.current
    )
  }

  return { onBlockStarted, onBlockCompleted, onBlockError, onBlockChildWorkflowStarted }
}

type AddConsoleFn = (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => ConsoleEntry | undefined
type CancelRunningEntriesFn = (workflowId: string) => void

export interface ExecutionTimingFields {
  durationMs: number
  startedAt: string
  endedAt: string
}

/**
 * Builds timing fields for an execution-level console entry.
 */
export function buildExecutionTiming(durationMs?: number): ExecutionTimingFields {
  const normalizedDuration = durationMs || 0
  return {
    durationMs: normalizedDuration,
    startedAt: new Date(Date.now() - normalizedDuration).toISOString(),
    endedAt: new Date().toISOString(),
  }
}

export interface ExecutionErrorConsoleParams {
  workflowId: string
  executionId?: string
  error?: string
  durationMs?: number
  blockLogs: BlockLog[]
  isPreExecutionError?: boolean
}

/**
 * Adds an execution-level error entry to the console when no block-level error already covers it.
 * Shared between direct user execution and mothership-initiated execution.
 */
export function addExecutionErrorConsoleEntry(
  addConsole: AddConsoleFn,
  params: ExecutionErrorConsoleParams
): void {
  const hasBlockError = params.blockLogs.some((log) => log.error)
  const isPreExecutionError = params.isPreExecutionError ?? false
  if (!isPreExecutionError && hasBlockError) return

  const errorMessage = params.error || 'Run failed'
  const isTimeout = errorMessage.toLowerCase().includes('timed out')
  const timing = buildExecutionTiming(params.durationMs)

  addConsole({
    input: {},
    output: {},
    success: false,
    error: errorMessage,
    durationMs: timing.durationMs,
    startedAt: timing.startedAt,
    executionOrder: isPreExecutionError ? 0 : Number.MAX_SAFE_INTEGER,
    endedAt: timing.endedAt,
    workflowId: params.workflowId,
    blockId: isPreExecutionError ? 'validation' : isTimeout ? 'timeout-error' : 'execution-error',
    executionId: params.executionId,
    blockName: isPreExecutionError
      ? 'Workflow Validation'
      : isTimeout
        ? 'Timeout Error'
        : 'Run Error',
    blockType: isPreExecutionError ? 'validation' : 'error',
  })
}

/**
 * Cancels running entries and adds an execution-level error console entry.
 */
export function handleExecutionErrorConsole(
  addConsole: AddConsoleFn,
  cancelRunningEntries: CancelRunningEntriesFn,
  params: ExecutionErrorConsoleParams
): void {
  cancelRunningEntries(params.workflowId)
  addExecutionErrorConsoleEntry(addConsole, params)
}

export interface HttpErrorConsoleParams {
  workflowId: string
  executionId?: string
  error: string
  httpStatus: number
}

/**
 * Adds a console entry for HTTP-level execution errors (non-OK response before SSE streaming).
 */
export function addHttpErrorConsoleEntry(
  addConsole: AddConsoleFn,
  params: HttpErrorConsoleParams
): void {
  const isValidationError = params.httpStatus >= 400 && params.httpStatus < 500
  const now = new Date().toISOString()
  addConsole({
    input: {},
    output: {},
    success: false,
    error: params.error,
    durationMs: 0,
    startedAt: now,
    executionOrder: 0,
    endedAt: now,
    workflowId: params.workflowId,
    blockId: isValidationError ? 'validation' : 'execution-error',
    executionId: params.executionId,
    blockName: isValidationError ? 'Workflow Validation' : 'Run Error',
    blockType: isValidationError ? 'validation' : 'error',
  })
}

export interface CancelledConsoleParams {
  workflowId: string
  executionId?: string
  durationMs?: number
}

/**
 * Adds a console entry for execution cancellation.
 */
export function addCancelledConsoleEntry(
  addConsole: AddConsoleFn,
  params: CancelledConsoleParams
): void {
  const timing = buildExecutionTiming(params.durationMs)
  addConsole({
    input: {},
    output: {},
    success: false,
    error: 'Run was cancelled',
    durationMs: timing.durationMs,
    startedAt: timing.startedAt,
    executionOrder: Number.MAX_SAFE_INTEGER,
    endedAt: timing.endedAt,
    workflowId: params.workflowId,
    blockId: 'cancelled',
    executionId: params.executionId,
    blockName: 'Run Cancelled',
    blockType: 'cancelled',
  })
}

/**
 * Cancels running entries and adds a cancelled console entry.
 */
export function handleExecutionCancelledConsole(
  addConsole: AddConsoleFn,
  cancelRunningEntries: CancelRunningEntriesFn,
  params: CancelledConsoleParams
): void {
  cancelRunningEntries(params.workflowId)
  addCancelledConsoleEntry(addConsole, params)
}

export interface WorkflowExecutionOptions {
  workflowId?: string
  workflowInput?: any
  onStream?: (se: StreamingExecution) => Promise<void>
  executionId?: string
  onBlockComplete?: (blockId: string, output: any) => Promise<void>
  overrideTriggerType?: 'chat' | 'manual' | 'api' | 'copilot' | 'webhook' | 'schedule'
  triggerBlockId?: string
  useDraftState?: boolean
  stopAfterBlockId?: string
  abortSignal?: AbortSignal
  /** For run_from_block / run_block: start from a specific block using cached state */
  runFromBlock?: {
    startBlockId: string
    executionId?: string
  }
}

/**
 * Execute workflow with full logging (used by copilot tools)
 * Handles SSE streaming and populates console logs in real-time
 */
export async function executeWorkflowWithFullLogging(
  options: WorkflowExecutionOptions = {}
): Promise<ExecutionResult | StreamingExecution> {
  const { activeWorkflowId } = useWorkflowRegistry.getState()
  const targetWorkflowId = options.workflowId || activeWorkflowId

  if (!targetWorkflowId) {
    throw new Error('No active workflow')
  }

  const executionId = options.executionId || generateId()
  const { addConsole, updateConsole, cancelRunningEntries } = useTerminalConsoleStore.getState()
  const { setActiveBlocks, setBlockRunStatus, setEdgeRunStatus, setCurrentExecutionId } =
    useExecutionStore.getState()
  const wfId = targetWorkflowId
  const workflowEdges = useWorkflowStore.getState().edges

  const activeBlocksSet = new Set<string>()
  const activeBlockRefCounts = new Map<string, number>()
  const executionIdRef = { current: executionId }
  const accumulatedBlockLogs: BlockLog[] = []

  const blockHandlers = createBlockEventHandlers(
    {
      workflowId: wfId,
      executionIdRef,
      workflowEdges,
      activeBlocksSet,
      activeBlockRefCounts,
      accumulatedBlockLogs,
      accumulatedBlockStates: new Map(),
      executedBlockIds: new Set(),
      consoleMode: 'update',
      includeStartConsoleEntry: true,
      onBlockCompleteCallback: options.onBlockComplete,
    },
    { addConsole, updateConsole, setActiveBlocks, setBlockRunStatus, setEdgeRunStatus }
  )

  const payload: any = {
    input: options.workflowInput,
    stream: true,
    triggerType: options.overrideTriggerType || 'manual',
    useDraftState: options.useDraftState ?? true,
    isClientSession: true,
    ...(options.triggerBlockId ? { triggerBlockId: options.triggerBlockId } : {}),
    ...(options.stopAfterBlockId ? { stopAfterBlockId: options.stopAfterBlockId } : {}),
    ...(options.runFromBlock
      ? {
          runFromBlock: {
            startBlockId: options.runFromBlock.startBlockId,
            executionId: options.runFromBlock.executionId || 'latest',
          },
        }
      : {}),
  }

  const response = await fetch(`/api/workflows/${targetWorkflowId}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: options.abortSignal,
  })

  if (!response.ok) {
    const error = await response.json()
    const errorMessage = error.error || 'Workflow run failed'
    addHttpErrorConsoleEntry(addConsole, {
      workflowId: wfId,
      executionId,
      error: errorMessage,
      httpStatus: response.status,
    })
    throw new Error(errorMessage)
  }

  if (!response.body) {
    throw new Error('No response body')
  }

  const serverExecutionId = response.headers.get('X-Execution-Id')
  if (serverExecutionId) {
    executionIdRef.current = serverExecutionId
    setCurrentExecutionId(wfId, serverExecutionId)
    saveExecutionPointer({ workflowId: wfId, executionId: serverExecutionId, lastEventId: 0 })
  }

  let executionResult: ExecutionResult = {
    success: false,
    output: {},
    logs: [],
  }

  try {
    await processSSEStream(
      response.body.getReader(),
      {
        onEventId: (eventId) => {
          if (wfId && executionIdRef.current && eventId % 5 === 0) {
            saveExecutionPointer({
              workflowId: wfId,
              executionId: executionIdRef.current,
              lastEventId: eventId,
            })
          }
        },

        onExecutionStarted: (data) => {
          logger.info('Execution started', { startTime: data.startTime })
        },

        onBlockStarted: blockHandlers.onBlockStarted,
        onBlockCompleted: blockHandlers.onBlockCompleted,
        onBlockError: blockHandlers.onBlockError,
        onBlockChildWorkflowStarted: blockHandlers.onBlockChildWorkflowStarted,

        onExecutionCompleted: (data) => {
          setCurrentExecutionId(wfId, null)
          executionResult = {
            success: data.success,
            output: data.output,
            logs: accumulatedBlockLogs,
            metadata: {
              duration: data.duration,
              startTime: data.startTime,
              endTime: data.endTime,
            },
          }
        },

        onExecutionCancelled: () => {
          setCurrentExecutionId(wfId, null)
          executionResult = {
            success: false,
            output: {},
            error: 'Run was cancelled',
            logs: accumulatedBlockLogs,
          }
        },

        onExecutionError: (data) => {
          setCurrentExecutionId(wfId, null)
          const errorMessage = data.error || 'Run failed'
          executionResult = {
            success: false,
            output: {},
            error: errorMessage,
            logs: accumulatedBlockLogs,
            metadata: { duration: data.duration },
          }

          handleExecutionErrorConsole(addConsole, cancelRunningEntries, {
            workflowId: wfId,
            executionId: executionIdRef.current,
            error: errorMessage,
            durationMs: data.duration || 0,
            blockLogs: accumulatedBlockLogs,
            isPreExecutionError: accumulatedBlockLogs.length === 0,
          })
        },
      },
      'CopilotExecution'
    )
  } finally {
    setCurrentExecutionId(wfId, null)
    setActiveBlocks(wfId, new Set())
  }

  return executionResult
}
