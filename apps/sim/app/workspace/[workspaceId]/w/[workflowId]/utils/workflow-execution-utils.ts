import { createLogger } from '@sim/logger'
import { v4 as uuidv4 } from 'uuid'
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

const logger = createLogger('workflow-execution-utils')

import { useExecutionStore } from '@/stores/execution'
import type { ConsoleEntry, ConsoleUpdate } from '@/stores/terminal'
import { useTerminalConsoleStore } from '@/stores/terminal'
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
  addConsole: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => ConsoleEntry
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

export interface WorkflowExecutionOptions {
  workflowId?: string
  workflowInput?: any
  onStream?: (se: StreamingExecution) => Promise<void>
  executionId?: string
  onBlockComplete?: (blockId: string, output: any) => Promise<void>
  overrideTriggerType?: 'chat' | 'manual' | 'api' | 'copilot'
  stopAfterBlockId?: string
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

  const executionId = options.executionId || uuidv4()
  const { addConsole, updateConsole } = useTerminalConsoleStore.getState()
  const { setActiveBlocks, setBlockRunStatus, setEdgeRunStatus, setCurrentExecutionId } =
    useExecutionStore.getState()
  const wfId = targetWorkflowId
  const workflowEdges = useWorkflowStore.getState().edges

  const activeBlocksSet = new Set<string>()
  const activeBlockRefCounts = new Map<string, number>()
  const executionIdRef = { current: executionId }

  const blockHandlers = createBlockEventHandlers(
    {
      workflowId: wfId,
      executionIdRef,
      workflowEdges,
      activeBlocksSet,
      activeBlockRefCounts,
      accumulatedBlockLogs: [],
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
    useDraftState: true,
    isClientSession: true,
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
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Workflow execution failed')
  }

  if (!response.body) {
    throw new Error('No response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let executionResult: ExecutionResult = {
    success: false,
    output: {},
    logs: [],
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue

        const data = line.substring(6).trim()
        if (data === '[DONE]') continue

        let event: any
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }

        switch (event.type) {
          case 'execution:started': {
            setCurrentExecutionId(wfId, event.executionId)
            executionIdRef.current = event.executionId || executionId
            break
          }

          case 'block:started':
            blockHandlers.onBlockStarted(event.data)
            break

          case 'block:completed':
            blockHandlers.onBlockCompleted(event.data)
            break

          case 'block:error':
            blockHandlers.onBlockError(event.data)
            break

          case 'block:childWorkflowStarted':
            blockHandlers.onBlockChildWorkflowStarted(event.data)
            break

          case 'execution:completed':
            setCurrentExecutionId(wfId, null)
            executionResult = {
              success: event.data.success,
              output: event.data.output,
              logs: [],
              metadata: {
                duration: event.data.duration,
                startTime: event.data.startTime,
                endTime: event.data.endTime,
              },
            }
            break

          case 'execution:cancelled':
            setCurrentExecutionId(wfId, null)
            executionResult = {
              success: false,
              output: {},
              error: 'Execution was cancelled',
              logs: [],
            }
            break

          case 'execution:error':
            setCurrentExecutionId(wfId, null)
            executionResult = {
              success: false,
              output: {},
              error: event.data.error || 'Execution failed',
              logs: [],
            }
            break
        }
      }
    }
  } finally {
    setCurrentExecutionId(wfId, null)
    reader.releaseLock()
    setActiveBlocks(wfId, new Set())
  }

  return executionResult
}
