import type { DiffAnalysis, WorkflowDiff } from '@/lib/workflows/diff'
import type { WorkflowState } from '../workflows/workflow/types'

/**
 * The lifecycle stage of the workflow diff overlay.
 *
 * @remarks
 * This is the single source of truth for the diff overlay. The legacy
 * `hasActiveDiff` / `isShowingDiff` / `isDiffReady` booleans are derived from
 * it via {@link deriveDiffFlags}, which makes contradictory combinations —
 * such as "showing a diff that has no active diff" — unrepresentable.
 *
 * - `none` — no diff staged; the canvas shows the live workflow.
 * - `staged` — a diff is staged and ready, but the canvas is showing the
 *   baseline (proposed changes hidden).
 * - `showing` — a diff is staged and ready, and the canvas is showing the
 *   proposed changes with diff markers.
 */
export type WorkflowDiffStatus = 'none' | 'staged' | 'showing'

export interface WorkflowDiffState {
  /** Lifecycle stage of the diff overlay; the source of truth for diff flags */
  status: WorkflowDiffStatus
  /** Derived from {@link status}: a diff is staged (`staged` or `showing`) */
  hasActiveDiff: boolean
  /** Derived from {@link status}: the canvas is rendering the proposed changes */
  isShowingDiff: boolean
  /** Derived from {@link status}: a staged diff is ready to view/toggle */
  isDiffReady: boolean
  baselineWorkflow: WorkflowState | null
  baselineWorkflowId: string | null
  diffAnalysis: DiffAnalysis | null
  diffMetadata: WorkflowDiff['metadata'] | null
  diffError?: string | null
  pendingExternalUpdates: Record<string, number>
  remoteUpdateVersions: Record<string, number>
  reconcilingWorkflows: Record<string, boolean>
  reconciliationErrors: Record<string, string>
  _triggerMessageId?: string | null
}

interface DiffActionOptions {
  /** Skip recording this operation for undo/redo. Used during undo/redo replay. */
  skipRecording?: boolean
  /** Skip persisting to DB. Use when the server tool already saved (e.g. edit_workflow). */
  skipPersist?: boolean
  /**
   * Explicit baseline snapshot to diff against.
   * Use this when the proposed state is fetched asynchronously and the live
   * workflow store may have already been updated to that same state.
   */
  baselineWorkflow?: WorkflowState
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
  markRemoteUpdateSeen: (workflowId: string) => void
  markExternalUpdatePending: (workflowId: string) => void
  clearExternalUpdatePending: (workflowId: string) => void
  setWorkflowReconciliationInProgress: (workflowId: string, isReconciling: boolean) => void
  setWorkflowReconciliationError: (workflowId: string, error: string | null) => void
  _batchedStateUpdate: (updates: Partial<WorkflowDiffState>) => void
}

/**
 * The {@link WorkflowDiffStatus} fields shared by `status` and its derived
 * booleans. Spread this into a state patch so the source of truth and the
 * legacy flags never drift apart.
 */
export type DiffStatusFlags = Pick<
  WorkflowDiffState,
  'status' | 'hasActiveDiff' | 'isShowingDiff' | 'isDiffReady'
>

/**
 * Computes the legacy `hasActiveDiff` / `isShowingDiff` / `isDiffReady`
 * booleans (plus the `status` itself) from a {@link WorkflowDiffStatus}.
 *
 * @remarks
 * Keeping the derived booleans on the stored state lets existing consumers
 * keep reading `state.hasActiveDiff` etc. unchanged while
 * {@link WorkflowDiffStatus} remains the single source of truth.
 */
export function deriveDiffFlags(status: WorkflowDiffStatus): DiffStatusFlags {
  return {
    status,
    hasActiveDiff: status !== 'none',
    isShowingDiff: status === 'showing',
    isDiffReady: status !== 'none',
  }
}
