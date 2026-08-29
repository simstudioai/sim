import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { LogTraceSpan } from '@/lib/api/contracts/logs'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

type WorkflowRunSnapshotMode = 'live' | 'snapshot' | 'diagnostics'

interface WorkflowRunSnapshot {
  executionId: string
  traceSpans?: LogTraceSpan[]
  workflowState?: WorkflowState
  selectedBlockId?: string | null
  /** The exact step row, which a nested one needs: many share a block. */
  selectedStepId?: string | null
  mode?: WorkflowRunSnapshotMode
}

interface WorkflowRunSnapshotState {
  snapshot: WorkflowRunSnapshot | null
  openSnapshot: (snapshot: WorkflowRunSnapshot) => void
  selectBlock: (blockId: string | null, stepId?: string | null) => void
  showSnapshot: () => void
  showLive: () => void
  openDiagnostics: (blockId: string, stepId?: string | null) => void
  closeSnapshot: () => void
}

export const useWorkflowRunSnapshotStore = create<WorkflowRunSnapshotState>()(
  devtools(
    (set) => ({
      snapshot: null,
      openSnapshot: (snapshot) =>
        set({ snapshot: { mode: 'snapshot', ...snapshot } }, false, 'openSnapshot'),
      /**
       * Selection does not change the mode. The inspector is opened and closed
       * deliberately and then follows whatever is selected — forcing it shut on
       * every selection made it impossible to click through steps with it open.
       */
      selectBlock: (blockId, stepId = null) =>
        set(
          (state) => ({
            snapshot: state.snapshot
              ? { ...state.snapshot, selectedBlockId: blockId, selectedStepId: stepId }
              : null,
          }),
          false,
          'selectBlock'
        ),
      /**
       * Leaves the run behind without tearing the canvas down: the workflow stays
       * on screen as the current one, which is what "Back to current" means.
       */
      showLive: () =>
        set(
          (state) => ({
            snapshot: state.snapshot
              ? {
                  ...state.snapshot,
                  executionId: '',
                  selectedBlockId: null,
                  selectedStepId: null,
                  mode: 'live',
                }
              : null,
          }),
          false,
          'showLive'
        ),
      showSnapshot: () =>
        set(
          (state) => ({
            snapshot: state.snapshot ? { ...state.snapshot, mode: 'snapshot' } : null,
          }),
          false,
          'showSnapshot'
        ),
      openDiagnostics: (blockId, stepId) =>
        set(
          (state) => ({
            snapshot: state.snapshot
              ? {
                  ...state.snapshot,
                  selectedBlockId: blockId,
                  selectedStepId: stepId ?? state.snapshot.selectedStepId ?? null,
                  mode: 'diagnostics',
                }
              : null,
          }),
          false,
          'openDiagnostics'
        ),
      closeSnapshot: () => set({ snapshot: null }, false, 'closeSnapshot'),
    }),
    { name: 'workflow-run-snapshot' }
  )
)
