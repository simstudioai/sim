import type { DiffAnalysis, WorkflowDiff } from '@/lib/workflows/diff'
import type { WorkflowState } from '../workflows/workflow/types'

export interface WorkflowDiffState {
  hasActiveDiff: boolean
  isShowingDiff: boolean
  isDiffReady: boolean
  baselineWorkflow: WorkflowState | null
  baselineWorkflowId: string | null
  diffAnalysis: DiffAnalysis | null
  diffMetadata: WorkflowDiff['metadata'] | null
  diffError?: string | null
  _triggerMessageId?: string | null
}

export interface DiffActionOptions {
  /** Skip recording this operation for undo/redo. Used during undo/redo replay. */
  skipRecording?: boolean
}

export interface WorkflowDiffActions {
  setProposedChanges: (
    workflowState: WorkflowState,
    diffAnalysis?: DiffAnalysis,
    options?: DiffActionOptions
  ) => Promise<void>
  clearDiff: (options?: { restoreBaseline?: boolean }) => void
  toggleDiffView: () => void
  acceptChanges: (options?: DiffActionOptions) => Promise<void>
  rejectChanges: (options?: DiffActionOptions) => Promise<void>
  reapplyDiffMarkers: () => void
  _batchedStateUpdate: (updates: Partial<WorkflowDiffState>) => void
}
