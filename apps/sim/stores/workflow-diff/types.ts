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

export interface WorkflowDiffActions {
  setProposedChanges: (workflowState: WorkflowState, diffAnalysis?: DiffAnalysis) => Promise<void>
  clearDiff: (options?: { restoreBaseline?: boolean }) => void
  toggleDiffView: () => void
  acceptChanges: () => Promise<void>
  rejectChanges: () => Promise<void>
  reapplyDiffMarkers: () => void
  _batchedStateUpdate: (updates: Partial<WorkflowDiffState>) => void
}
