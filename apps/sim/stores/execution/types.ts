import type { Executor } from '@/executor'
import type { SerializableExecutionState } from '@/executor/execution/types'
import type { ExecutionContext } from '@/executor/types'

/**
 * Represents the execution result of a block in the last run
 */
export type BlockRunStatus = 'success' | 'error'

/**
 * Represents the execution result of an edge in the last run
 */
export type EdgeRunStatus = 'success' | 'error'

/**
 * Execution state scoped to a single workflow.
 *
 * Each workflow has its own independent instance so concurrent executions
 * do not interfere with one another.
 */
export interface WorkflowExecutionState {
  /** Whether this workflow is currently executing */
  isExecuting: boolean
  /** Whether this workflow is in step-by-step debug mode */
  isDebugging: boolean
  /** Block IDs that are currently running (pulsing in the UI) */
  activeBlockIds: Set<string>
  /** Block IDs queued to execute next (used during debug stepping) */
  pendingBlocks: string[]
  /** The executor instance when running client-side */
  executor: Executor | null
  /** Debug execution context preserved across steps */
  debugContext: ExecutionContext | null
  /** Maps block IDs to their run result from the last execution */
  lastRunPath: Map<string, BlockRunStatus>
  /** Maps edge IDs to their run result from the last execution */
  lastRunEdges: Map<string, EdgeRunStatus>
  /** The execution ID of the currently running execution */
  currentExecutionId: string | null
}

/**
 * Default values for a workflow that has never been executed.
 *
 * @remarks
 * This constant is used as the fallback in selectors when no per-workflow
 * entry exists. Its reference identity is stable, which prevents unnecessary
 * re-renders in Zustand selectors that use `Object.is` equality.
 */
export const defaultWorkflowExecutionState: WorkflowExecutionState = {
  isExecuting: false,
  isDebugging: false,
  activeBlockIds: new Set(),
  pendingBlocks: [],
  executor: null,
  debugContext: null,
  lastRunPath: new Map(),
  lastRunEdges: new Map(),
  currentExecutionId: null,
}

/**
 * Root state shape for the execution store.
 *
 * All execution state is keyed by workflow ID so multiple workflows
 * can be executed concurrently with independent visual feedback.
 */
export interface ExecutionState {
  /** Per-workflow execution state keyed by workflow ID */
  workflowExecutions: Map<string, WorkflowExecutionState>
  /** Serializable snapshots of the last successful execution per workflow */
  lastExecutionSnapshots: Map<string, SerializableExecutionState>
}

/**
 * Actions available on the execution store.
 *
 * Every setter takes a `workflowId` as its first argument so mutations
 * are scoped to a single workflow.
 */
export interface ExecutionActions {
  /** Returns the execution state for a workflow, falling back to defaults */
  getWorkflowExecution: (workflowId: string) => WorkflowExecutionState
  /** Replaces the set of currently-executing block IDs for a workflow */
  setActiveBlocks: (workflowId: string, blockIds: Set<string>) => void
  /** Marks a workflow as executing or idle. Starting clears the run path */
  setIsExecuting: (workflowId: string, isExecuting: boolean) => void
  /** Toggles debug mode for a workflow */
  setIsDebugging: (workflowId: string, isDebugging: boolean) => void
  /** Sets the list of blocks pending execution during debug stepping */
  setPendingBlocks: (workflowId: string, blockIds: string[]) => void
  /** Stores the executor instance for a workflow */
  setExecutor: (workflowId: string, executor: Executor | null) => void
  /** Stores the debug execution context for a workflow */
  setDebugContext: (workflowId: string, context: ExecutionContext | null) => void
  /** Records a block's run result (success/error) in the run path */
  setBlockRunStatus: (workflowId: string, blockId: string, status: BlockRunStatus) => void
  /** Records an edge's run result (success/error) in the run edges */
  setEdgeRunStatus: (workflowId: string, edgeId: string, status: EdgeRunStatus) => void
  /** Clears the run path and run edges for a workflow */
  clearRunPath: (workflowId: string) => void
  /** Stores the current execution ID for a workflow */
  setCurrentExecutionId: (workflowId: string, executionId: string | null) => void
  /** Returns the current execution ID for a workflow */
  getCurrentExecutionId: (workflowId: string) => string | null
  /** Resets the entire store to its initial empty state */
  reset: () => void
  /** Stores a serializable execution snapshot for a workflow */
  setLastExecutionSnapshot: (workflowId: string, snapshot: SerializableExecutionState) => void
  /** Returns the stored execution snapshot for a workflow, if any */
  getLastExecutionSnapshot: (workflowId: string) => SerializableExecutionState | undefined
  /** Removes the stored execution snapshot for a workflow */
  clearLastExecutionSnapshot: (workflowId: string) => void
}

/** Empty initial state used by the store and by {@link ExecutionActions.reset} */
export const initialState: ExecutionState = {
  workflowExecutions: new Map(),
  lastExecutionSnapshots: new Map(),
}
