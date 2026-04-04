import type { Edge } from 'reactflow'
import type { BlockState } from '@/stores/workflows/workflow/types'

export interface WorkflowSnapshot {
  id: string
  timestamp: string
  label: string
  blocks: Record<string, BlockState>
  edges: Edge[]
  subBlockValues: Record<string, Record<string, unknown>>
}

export const MAX_SNAPSHOTS_PER_WORKFLOW = 50

export const MAX_TRACKED_WORKFLOWS = 5

export interface WorkflowHistoryState {
  snapshots: Record<string, WorkflowSnapshot[]>

  captureSnapshot: (workflowId: string, label: string) => void

  restoreSnapshot: (workflowId: string, snapshotId: string) => boolean

  getSnapshots: (workflowId: string) => WorkflowSnapshot[]

  clearHistory: (workflowId: string) => void

  clearAllHistory: () => void
}
