import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { TraceSpan } from '@/lib/logs/types'
import type {
  BlockChildWorkflowStartedData,
  BlockCompletedData,
  BlockErrorData,
  BlockStartedData,
} from '@/lib/workflows/executor/execution-events'
import type { BlockLog, BlockState, ExecutionResult, StreamingExecution } from '@/executor/types'
import { stripCloneSuffixes } from '@/executor/utils/subflow-utils'
import {
  processSSEStream,
  SSEEventHandlerError,
  SSEStreamInterruptedError,
} from '@/hooks/use-execution-stream'

const logger = createLogger('workflow-execution-utils')

import { useExecutionStore } from '@/stores/execution'
import type { ConsoleEntry, ConsoleUpdate } from '@/stores/terminal'
import {
  clearExecutionPointer,
  consolePersistence,
  saveExecutionPointer,
  useTerminalConsoleStore,
} from '@/stores/terminal'
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

type BlockChildWorkflowStartedUpdate = BlockChildWorkflowStartedData

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
    includeStartConsoleEntry,
    onBlockCompleteCallback,
  } = config

  const { addConsole, updateConsole, setActiveBlocks, setBlockRunStatus, setEdgeRunStatus } = deps
  const pendingChildWorkflowStarts = new Map<string, BlockChildWorkflowStartedUpdate>()

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

  const parentIterationsMatch = (
    left: ConsoleEntry['parentIterations'],
    right: BlockStartedData['parentIterations']
  ) => {
    if (!left?.length && !right?.length) return true
    if (!left || !right || left.length !== right.length) return false
    return left.every((entry, index) => {
      const other = right[index]
      return (
        entry.iterationCurrent === other.iterationCurrent &&
        entry.iterationTotal === other.iterationTotal &&
        entry.iterationType === other.iterationType &&
        entry.iterationContainerId === other.iterationContainerId
      )
    })
  }

  type StartedIdentity = {
    blockId: string
    executionOrder?: number
    iterationCurrent?: BlockStartedData['iterationCurrent']
    iterationTotal?: BlockStartedData['iterationTotal']
    iterationType?: BlockStartedData['iterationType']
    iterationContainerId?: BlockStartedData['iterationContainerId']
    childWorkflowBlockId?: BlockStartedData['childWorkflowBlockId']
    childWorkflowName?: BlockStartedData['childWorkflowName']
    parentIterations?: BlockStartedData['parentIterations']
  }

  const startedEntryKey = (data: StartedIdentity) =>
    JSON.stringify({
      blockId: data.blockId,
      executionOrder: data.executionOrder,
      iterationCurrent: data.iterationCurrent,
      iterationTotal: data.iterationTotal,
      iterationType: data.iterationType,
      iterationContainerId: data.iterationContainerId,
      childWorkflowBlockId: data.childWorkflowBlockId,
      childWorkflowName: data.childWorkflowName,
      parentIterations: data.parentIterations ?? [],
    })

  const matchesStartedIdentity = (entry: ConsoleEntry, data: StartedIdentity) =>
    entry.executionId === executionIdRef.current &&
    entry.blockId === data.blockId &&
    (data.executionOrder === undefined || entry.executionOrder === data.executionOrder) &&
    entry.iterationCurrent === data.iterationCurrent &&
    entry.iterationTotal === data.iterationTotal &&
    entry.iterationType === data.iterationType &&
    entry.iterationContainerId === data.iterationContainerId &&
    entry.childWorkflowBlockId === data.childWorkflowBlockId &&
    entry.childWorkflowName === data.childWorkflowName &&
    parentIterationsMatch(entry.parentIterations, data.parentIterations)

  const hasExistingStartedEntry = (data: StartedIdentity) => {
    if (!workflowId) return false
    return useTerminalConsoleStore
      .getState()
      .getWorkflowEntries(workflowId)
      .some((entry) => matchesStartedIdentity(entry, data))
  }

  const applyChildWorkflowStart = (data: BlockChildWorkflowStartedUpdate) => {
    updateConsole(
      data.blockId,
      {
        childWorkflowInstanceId: data.childWorkflowInstanceId,
        ...(data.iterationCurrent !== undefined && { iterationCurrent: data.iterationCurrent }),
        ...(data.iterationTotal !== undefined && { iterationTotal: data.iterationTotal }),
        ...(data.iterationType !== undefined && { iterationType: data.iterationType }),
        ...(data.iterationContainerId !== undefined && {
          iterationContainerId: data.iterationContainerId,
        }),
        ...(data.parentIterations !== undefined && {
          parentIterations: data.parentIterations,
        }),
        ...(data.childWorkflowBlockId !== undefined && {
          childWorkflowBlockId: data.childWorkflowBlockId,
        }),
        ...(data.childWorkflowName !== undefined && {
          childWorkflowName: data.childWorkflowName,
        }),
        ...(data.executionOrder !== undefined && { executionOrder: data.executionOrder }),
      },
      executionIdRef.current
    )
  }

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
    if (hasExistingStartedEntry(data)) return

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

    const pendingKey = startedEntryKey(data)
    const pending = pendingChildWorkflowStarts.get(pendingKey)
    if (pending) {
      applyChildWorkflowStart(pending)
      pendingChildWorkflowStarts.delete(pendingKey)
    }
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

    updateConsoleEntry(data)

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

    updateConsoleErrorEntry(data)
  }

  const onBlockChildWorkflowStarted = (data: BlockChildWorkflowStartedUpdate) => {
    if (isStaleExecution()) return
    applyChildWorkflowStart(data)
    if (!hasExistingStartedEntry(data)) {
      pendingChildWorkflowStarts.set(startedEntryKey(data), data)
    }
  }

  return { onBlockStarted, onBlockCompleted, onBlockError, onBlockChildWorkflowStarted }
}

type AddConsoleFn = (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => ConsoleEntry | undefined
type CancelRunningEntriesFn = (workflowId: string, executionId?: string) => void
type UpdateConsoleFn = (
  blockId: string,
  update: string | ConsoleUpdate,
  executionId?: string
) => void

/**
 * Bundle of console-store actions used by the execution-level handlers.
 * Mirrors the deps-object pattern established by `createBlockEventHandlers`.
 */
export interface ExecutionConsoleDeps {
  addConsole: AddConsoleFn
  updateConsole: UpdateConsoleFn
  cancelRunningEntries: CancelRunningEntriesFn
}

/**
 * Reconciles still-running console entries with the server's authoritative
 * `finalBlockLogs` so that any block whose terminal `block:completed`/`block:error`
 * SSE event was lost gets the correct success/error state instead of being
 * swept to "canceled".
 */
export function reconcileFinalBlockLogs(
  updateConsole: UpdateConsoleFn,
  workflowId: string,
  executionId: string | undefined,
  finalBlockLogs: BlockLog[] | undefined
): void {
  if (!finalBlockLogs?.length || !executionId) return
  for (const log of finalBlockLogs) {
    const entries = useTerminalConsoleStore.getState().getWorkflowEntries(workflowId)
    const matchesFinalLog = (entry: ConsoleEntry) =>
      entry.blockId === log.blockId &&
      entry.executionId === executionId &&
      entry.executionOrder === log.executionOrder
    const matchingEntry = entries.find(matchesFinalLog)
    const runningEntry = entries.find((entry) => matchesFinalLog(entry) && entry.isRunning)
    if (runningEntry) {
      updateConsole(
        log.blockId,
        {
          executionOrder: log.executionOrder,
          replaceOutput: (log.output ?? {}) as Record<string, unknown>,
          ...(log.input ? { input: log.input } : {}),
          success: log.success,
          ...(log.error ? { error: log.error } : {}),
          durationMs: log.durationMs,
          startedAt: log.startedAt,
          endedAt: log.endedAt,
          isRunning: false,
          isCanceled: false,
        },
        executionId
      )
    }

    const childWorkflowInstanceId = matchingEntry?.childWorkflowInstanceId
    if (childWorkflowInstanceId && log.childTraceSpans?.length) {
      reconcileChildTraceSpans(
        updateConsole,
        workflowId,
        log.blockId,
        childWorkflowInstanceId,
        executionId,
        log.childTraceSpans
      )
    }
  }
}

function reconcileChildTraceSpans(
  updateConsole: UpdateConsoleFn,
  workflowId: string,
  childWorkflowBlockId: string,
  childWorkflowInstanceId: string,
  executionId: string,
  spans: TraceSpan[]
): void {
  for (const span of spans) {
    const matchingEntry = span.blockId
      ? findConsoleEntryForSpan(workflowId, executionId, childWorkflowBlockId, span)
      : undefined
    if (span.blockId) {
      const errorMessage = normalizeSpanError(span.output?.error)
      updateConsole(
        span.blockId,
        {
          ...spanConsoleIdentity(span, childWorkflowBlockId),
          replaceOutput: (span.output ?? {}) as Record<string, unknown>,
          success: span.status !== 'error',
          ...(errorMessage !== undefined ? { error: errorMessage } : {}),
          durationMs: span.duration,
          startedAt: span.startTime,
          endedAt: span.endTime,
          isRunning: false,
          isCanceled: false,
        },
        executionId
      )
    }
    if (span.children?.length) {
      reconcileChildTraceSpans(
        updateConsole,
        workflowId,
        matchingEntry?.blockId ?? childWorkflowBlockId,
        matchingEntry?.childWorkflowInstanceId ?? childWorkflowInstanceId,
        executionId,
        span.children
      )
    }
  }
}

function spanConsoleIdentity(span: TraceSpan, childWorkflowBlockId: string): ConsoleUpdate {
  const iterationContainerId = span.loopId ?? span.parallelId
  const iterationType = span.loopId ? 'loop' : span.parallelId ? 'parallel' : undefined
  return {
    ...(span.executionOrder !== undefined && { executionOrder: span.executionOrder }),
    ...(span.iterationIndex !== undefined && { iterationCurrent: span.iterationIndex }),
    ...(iterationType !== undefined && { iterationType }),
    ...(iterationContainerId !== undefined && { iterationContainerId }),
    ...(span.parentIterations !== undefined && { parentIterations: span.parentIterations }),
    childWorkflowBlockId,
  }
}

function findConsoleEntryForSpan(
  workflowId: string,
  executionId: string,
  childWorkflowBlockId: string,
  span: TraceSpan
): ConsoleEntry | undefined {
  if (!span.blockId) return undefined
  const identity = spanConsoleIdentity(span, childWorkflowBlockId)
  return useTerminalConsoleStore
    .getState()
    .getWorkflowEntries(workflowId)
    .find(
      (entry) =>
        entry.blockId === span.blockId &&
        entry.executionId === executionId &&
        matchesConsoleIdentity(entry, identity)
    )
}

function matchesConsoleIdentity(entry: ConsoleEntry, identity: ConsoleUpdate): boolean {
  if (identity.executionOrder !== undefined && entry.executionOrder !== identity.executionOrder) {
    return false
  }
  if (
    identity.iterationCurrent !== undefined &&
    entry.iterationCurrent !== identity.iterationCurrent
  ) {
    return false
  }
  if (
    identity.iterationContainerId !== undefined &&
    entry.iterationContainerId !== identity.iterationContainerId
  ) {
    return false
  }
  if (
    identity.childWorkflowBlockId !== undefined &&
    entry.childWorkflowBlockId !== identity.childWorkflowBlockId
  ) {
    return false
  }
  if (
    identity.childWorkflowInstanceId !== undefined &&
    entry.childWorkflowInstanceId !== undefined &&
    entry.childWorkflowInstanceId !== identity.childWorkflowInstanceId
  ) {
    return false
  }
  return true
}

function normalizeSpanError(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  return typeof error === 'string' ? error : toError(error).message
}

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
  /** Server's authoritative per-block terminal states, used to reconcile lost SSE events. */
  finalBlockLogs?: BlockLog[]
}

/**
 * Adds an execution-level error entry to the console when no block-level error already covers it.
 * Shared between direct user execution and mothership-initiated execution.
 */
export function addExecutionErrorConsoleEntry(
  addConsole: AddConsoleFn,
  params: ExecutionErrorConsoleParams
): void {
  const hasBlockErrorInLogs = params.blockLogs.some((log) => log.error)
  const hasBlockErrorInConsole = useTerminalConsoleStore
    .getState()
    .getWorkflowEntries(params.workflowId)
    .some(
      (entry) =>
        entry.executionId === params.executionId &&
        entry.error != null &&
        entry.error !== '' &&
        entry.blockType !== 'error' &&
        entry.blockType !== 'validation'
    )
  const hasBlockError = hasBlockErrorInLogs || hasBlockErrorInConsole
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
 * Reconciles `finalBlockLogs` against still-running entries, sweeps any
 * remaining running entries to canceled, and adds an execution-level error
 * console entry when no block-level error already covers it.
 */
export function handleExecutionErrorConsole(
  deps: ExecutionConsoleDeps,
  params: ExecutionErrorConsoleParams
): void {
  reconcileFinalBlockLogs(
    deps.updateConsole,
    params.workflowId,
    params.executionId,
    params.finalBlockLogs
  )
  deps.cancelRunningEntries(params.workflowId, params.executionId)
  addExecutionErrorConsoleEntry(deps.addConsole, params)
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
  /** Server's authoritative per-block terminal states, used to reconcile lost SSE events. */
  finalBlockLogs?: BlockLog[]
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
 * Reconciles `finalBlockLogs` against still-running entries, sweeps any
 * remaining running entries to canceled, and adds the execution-level
 * cancellation console entry.
 */
export function handleExecutionCancelledConsole(
  deps: ExecutionConsoleDeps,
  params: CancelledConsoleParams
): void {
  reconcileFinalBlockLogs(
    deps.updateConsole,
    params.workflowId,
    params.executionId,
    params.finalBlockLogs
  )
  deps.cancelRunningEntries(params.workflowId, params.executionId)
  addCancelledConsoleEntry(deps.addConsole, params)
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
  preserveExecutionOnTerminal?: boolean
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
  const { addConsole, updateConsole, cancelRunningEntries, finishRunningEntries } =
    useTerminalConsoleStore.getState()
  const clearOnTerminal = options.preserveExecutionOnTerminal !== true
  const { setActiveBlocks, setBlockRunStatus, setEdgeRunStatus, setCurrentExecutionId } =
    useExecutionStore.getState()
  const wfId = targetWorkflowId
  const workflowEdges = useWorkflowStore.getState().edges

  const activeBlocksSet = new Set<string>()
  const activeBlockRefCounts = new Map<string, number>()
  const executionIdRef = { current: executionId }
  const accumulatedBlockLogs: BlockLog[] = []
  const isCurrentExecution = () => {
    return useExecutionStore.getState().getCurrentExecutionId(wfId) === executionIdRef.current
  }
  const clearExecutionState = () => {
    if (!isCurrentExecution()) return
    setCurrentExecutionId(wfId, null)
    clearExecutionPointer(wfId)
    consolePersistence.executionEnded()
    useExecutionStore.getState().setIsExecuting(wfId, false)
    setActiveBlocks(wfId, new Set())
  }

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

  // boundary-raw-fetch: workflow execute returns an SSE stream consumed via response.body.getReader() in processSSEStream
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
  let executionFinished = false
  let preserveExecutionForRecovery = false

  try {
    await processSSEStream(
      response.body.getReader(),
      {
        onEventId: (eventId) => {
          if (executionFinished) return
          if (wfId && executionIdRef.current && eventId % 5 === 0) {
            const executionId = executionIdRef.current
            return consolePersistence.persist().then(() =>
              saveExecutionPointer({
                workflowId: wfId,
                executionId,
                lastEventId: eventId,
              })
            )
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
          if (!isCurrentExecution()) return
          executionFinished = true
          reconcileFinalBlockLogs(updateConsole, wfId, executionIdRef.current, data.finalBlockLogs)
          finishRunningEntries(wfId, executionIdRef.current)
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
          if (clearOnTerminal) {
            clearExecutionState()
          }
        },

        onExecutionPaused: (data) => {
          if (!isCurrentExecution()) return
          executionFinished = true
          reconcileFinalBlockLogs(updateConsole, wfId, executionIdRef.current, data.finalBlockLogs)
          finishRunningEntries(wfId, executionIdRef.current)
          executionResult = {
            success: true,
            output: data.output,
            logs: accumulatedBlockLogs,
            metadata: {
              duration: data.duration,
              startTime: data.startTime,
              endTime: data.endTime,
            },
          }
          if (clearOnTerminal) {
            clearExecutionState()
          }
        },

        onExecutionCancelled: (data) => {
          if (!isCurrentExecution()) return
          executionFinished = true
          executionResult = {
            success: false,
            output: {},
            error: 'Run was cancelled',
            logs: accumulatedBlockLogs,
          }

          handleExecutionCancelledConsole(
            { addConsole, updateConsole, cancelRunningEntries },
            {
              workflowId: wfId,
              executionId: executionIdRef.current,
              durationMs: data?.duration,
              finalBlockLogs: data?.finalBlockLogs,
            }
          )
          if (clearOnTerminal) {
            clearExecutionState()
          }
        },

        onExecutionError: (data) => {
          if (!isCurrentExecution()) return
          executionFinished = true
          const errorMessage = data.error || 'Run failed'
          executionResult = {
            success: false,
            output: {},
            error: errorMessage,
            logs: accumulatedBlockLogs,
            metadata: { duration: data.duration },
          }

          handleExecutionErrorConsole(
            { addConsole, updateConsole, cancelRunningEntries },
            {
              workflowId: wfId,
              executionId: executionIdRef.current,
              error: errorMessage,
              durationMs: data.duration || 0,
              blockLogs: accumulatedBlockLogs,
              isPreExecutionError: accumulatedBlockLogs.length === 0,
              finalBlockLogs: data.finalBlockLogs,
            }
          )
          if (clearOnTerminal) {
            clearExecutionState()
          }
        },
      },
      'CopilotExecution'
    )
  } catch (error) {
    if (error instanceof SSEEventHandlerError || error instanceof SSEStreamInterruptedError) {
      preserveExecutionForRecovery = true
    }
    throw error
  } finally {
    if (!preserveExecutionForRecovery && clearOnTerminal) {
      clearExecutionState()
    }
  }

  return executionResult
}
