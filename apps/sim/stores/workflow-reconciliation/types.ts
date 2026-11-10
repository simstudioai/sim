/**
 * Per-workflow bookkeeping for reconciling the local editor with server-side changes
 * (realtime `workflow-updated`, tool results, reverts), keyed by workflow id.
 */
export interface WorkflowReconciliationState {
  /** Generation counter of external updates that arrived while they could not be applied */
  pendingExternalUpdates: Record<string, number>
  /** Bumped on every observed remote update; local draft sync compares against it */
  remoteUpdateVersions: Record<string, number>
  reconcilingWorkflows: Record<string, boolean>
  reconciliationErrors: Record<string, string>
}

export interface WorkflowReconciliationActions {
  markRemoteUpdateSeen: (workflowId: string) => void
  markExternalUpdatePending: (workflowId: string) => void
  clearExternalUpdatePending: (workflowId: string) => void
  setWorkflowReconciliationInProgress: (workflowId: string, isReconciling: boolean) => void
  setWorkflowReconciliationError: (workflowId: string, error: string | null) => void
}
