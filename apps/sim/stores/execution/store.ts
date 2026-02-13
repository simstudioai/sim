import { create } from 'zustand'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import {
  type BlockRunStatus,
  defaultWorkflowExecutionState,
  type EdgeRunStatus,
  type ExecutionActions,
  type ExecutionState,
  initialState,
  type WorkflowExecutionState,
} from './types'

/**
 * Returns the execution state for a workflow, creating a fresh default if absent.
 *
 * @remarks
 * When the workflow has no entry in the map, fresh `Set` and `Map` instances
 * are created so that callers never share mutable collections with
 * {@link defaultWorkflowExecutionState}.
 */
function getOrCreate(
  map: Map<string, WorkflowExecutionState>,
  workflowId: string
): WorkflowExecutionState {
  return (
    map.get(workflowId) ?? {
      ...defaultWorkflowExecutionState,
      activeBlockIds: new Set<string>(),
      lastRunPath: new Map<string, BlockRunStatus>(),
      lastRunEdges: new Map<string, EdgeRunStatus>(),
    }
  )
}

/**
 * Immutably updates a single workflow's execution state within the map.
 *
 * Creates a shallow copy of the outer map, merges the patch into the
 * target workflow's entry, and returns the new map. This ensures Zustand
 * detects the top-level reference change and notifies subscribers.
 */
function updatedMap(
  map: Map<string, WorkflowExecutionState>,
  workflowId: string,
  patch: Partial<WorkflowExecutionState>
): Map<string, WorkflowExecutionState> {
  const next = new Map(map)
  const current = getOrCreate(map, workflowId)
  next.set(workflowId, { ...current, ...patch })
  return next
}

/**
 * Global Zustand store for per-workflow execution state.
 *
 * All execution state (running, debugging, block/edge highlights) is keyed
 * by workflow ID so users can run multiple workflows concurrently, each
 * with independent visual feedback.
 */
export const useExecutionStore = create<ExecutionState & ExecutionActions>()((set, get) => ({
  ...initialState,

  getWorkflowExecution: (workflowId) => {
    return getOrCreate(get().workflowExecutions, workflowId)
  },

  setActiveBlocks: (workflowId, blockIds) => {
    set({
      workflowExecutions: updatedMap(get().workflowExecutions, workflowId, {
        activeBlockIds: new Set(blockIds),
      }),
    })
  },

  setPendingBlocks: (workflowId, pendingBlocks) => {
    set({
      workflowExecutions: updatedMap(get().workflowExecutions, workflowId, { pendingBlocks }),
    })
  },

  setIsExecuting: (workflowId, isExecuting) => {
    const patch: Partial<WorkflowExecutionState> = { isExecuting }
    if (isExecuting) {
      patch.lastRunPath = new Map()
      patch.lastRunEdges = new Map()
    }
    set({
      workflowExecutions: updatedMap(get().workflowExecutions, workflowId, patch),
    })
  },

  setIsDebugging: (workflowId, isDebugging) => {
    set({
      workflowExecutions: updatedMap(get().workflowExecutions, workflowId, { isDebugging }),
    })
  },

  setExecutor: (workflowId, executor) => {
    set({
      workflowExecutions: updatedMap(get().workflowExecutions, workflowId, { executor }),
    })
  },

  setDebugContext: (workflowId, debugContext) => {
    set({
      workflowExecutions: updatedMap(get().workflowExecutions, workflowId, { debugContext }),
    })
  },

  setBlockRunStatus: (workflowId, blockId, status) => {
    const current = getOrCreate(get().workflowExecutions, workflowId)
    const newRunPath = new Map(current.lastRunPath)
    newRunPath.set(blockId, status)
    set({
      workflowExecutions: updatedMap(get().workflowExecutions, workflowId, {
        lastRunPath: newRunPath,
      }),
    })
  },

  setEdgeRunStatus: (workflowId, edgeId, status) => {
    const current = getOrCreate(get().workflowExecutions, workflowId)
    const newRunEdges = new Map(current.lastRunEdges)
    newRunEdges.set(edgeId, status)
    set({
      workflowExecutions: updatedMap(get().workflowExecutions, workflowId, {
        lastRunEdges: newRunEdges,
      }),
    })
  },

  setCurrentExecutionId: (workflowId, executionId) => {
    set({
      workflowExecutions: updatedMap(get().workflowExecutions, workflowId, {
        currentExecutionId: executionId,
      }),
    })
  },

  getCurrentExecutionId: (workflowId) => {
    return getOrCreate(get().workflowExecutions, workflowId).currentExecutionId
  },

  clearRunPath: (workflowId) => {
    set({
      workflowExecutions: updatedMap(get().workflowExecutions, workflowId, {
        lastRunPath: new Map(),
        lastRunEdges: new Map(),
      }),
    })
  },

  reset: () => set(initialState),

  setLastExecutionSnapshot: (workflowId, snapshot) => {
    const newSnapshots = new Map(get().lastExecutionSnapshots)
    newSnapshots.set(workflowId, snapshot)
    set({ lastExecutionSnapshots: newSnapshots })
  },

  getLastExecutionSnapshot: (workflowId) => {
    return get().lastExecutionSnapshots.get(workflowId)
  },

  clearLastExecutionSnapshot: (workflowId) => {
    const newSnapshots = new Map(get().lastExecutionSnapshots)
    newSnapshots.delete(workflowId)
    set({ lastExecutionSnapshots: newSnapshots })
  },
}))

/**
 * Convenience hook that returns the execution state for the currently active workflow.
 */
export function useCurrentWorkflowExecution(): WorkflowExecutionState {
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  return useExecutionStore((state) => {
    if (!activeWorkflowId) return defaultWorkflowExecutionState
    return state.workflowExecutions.get(activeWorkflowId) ?? defaultWorkflowExecutionState
  })
}

/**
 * Returns whether a specific block is currently active (executing) in the current workflow.
 * More granular than useCurrentWorkflowExecution — only re-renders when
 * the boolean result changes for this specific block.
 */
export function useIsBlockActive(blockId: string): boolean {
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  return useExecutionStore((state) => {
    if (!activeWorkflowId) return false
    return state.workflowExecutions.get(activeWorkflowId)?.activeBlockIds.has(blockId) ?? false
  })
}

/**
 * Returns the last run path (block statuses) for the current workflow.
 * More granular than useCurrentWorkflowExecution — only re-renders when
 * the lastRunPath map reference changes.
 */
export function useLastRunPath(): Map<string, BlockRunStatus> {
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  return useExecutionStore((state) => {
    if (!activeWorkflowId) return defaultWorkflowExecutionState.lastRunPath
    return (
      state.workflowExecutions.get(activeWorkflowId)?.lastRunPath ??
      defaultWorkflowExecutionState.lastRunPath
    )
  })
}

/**
 * Returns the last run edges (edge statuses) for the current workflow.
 * More granular than useCurrentWorkflowExecution — only re-renders when
 * the lastRunEdges map reference changes.
 */
export function useLastRunEdges(): Map<string, EdgeRunStatus> {
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  return useExecutionStore((state) => {
    if (!activeWorkflowId) return defaultWorkflowExecutionState.lastRunEdges
    return (
      state.workflowExecutions.get(activeWorkflowId)?.lastRunEdges ??
      defaultWorkflowExecutionState.lastRunEdges
    )
  })
}
