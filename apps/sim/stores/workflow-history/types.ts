import type { Edge } from 'reactflow'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * A point-in-time snapshot of the workflow graph state.
 * Stored in the browser via localStorage.
 */
export interface WorkflowSnapshot {
  /** Unique identifier for this snapshot */
  id: string
  /** ISO timestamp when this snapshot was captured */
  timestamp: string
  /** Human-readable label describing what changed */
  label: string
  /** Block states including merged sub-block values */
  blocks: Record<string, BlockState>
  /** Edge connections */
  edges: Edge[]
  /** Sub-block values keyed by blockId → subBlockId → value */
  subBlockValues: Record<string, Record<string, unknown>>
}

/** Maximum number of snapshots stored per workflow */
export const MAX_SNAPSHOTS_PER_WORKFLOW = 50

/** Maximum number of workflows to track history for (LRU) */
export const MAX_TRACKED_WORKFLOWS = 5

export interface WorkflowHistoryState {
  /**
   * Snapshots keyed by workflowId.
   * Each value is an array sorted newest-first (index 0 = most recent).
   */
  snapshots: Record<string, WorkflowSnapshot[]>

  /**
   * Captures a snapshot of the current workflow state.
   * @param workflowId - The workflow to snapshot
   * @param label - What changed (e.g. "Added blocks", "Moved blocks")
   */
  captureSnapshot: (workflowId: string, label: string) => void

  /**
   * Restores a workflow to a specific snapshot.
   * @param workflowId - The workflow to restore
   * @param snapshotId - The snapshot to restore to
   * @returns true if restored successfully
   */
  restoreSnapshot: (workflowId: string, snapshotId: string) => boolean

  /**
   * Returns snapshots for a workflow (newest first).
   */
  getSnapshots: (workflowId: string) => WorkflowSnapshot[]

  /**
   * Clears all history for a workflow.
   */
  clearHistory: (workflowId: string) => void

  /**
   * Clears all history for all workflows.
   */
  clearAllHistory: () => void
}
