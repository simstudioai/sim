import { requireWorkflowState } from '@/platform/lib/data/shims/workflow-state/connection'
import type { DraftSyncVersions } from '@/stores/workflows/sync-local-draft'

/*
 * Stand in for `stores/workflows/sync-local-draft` where the shared socket provider imports it. Its
 * join-state handler runs only in a workflow room, by which time the real module is connected.
 */

export function captureDraftVersions(workflowId: string): DraftSyncVersions {
  return requireWorkflowState().draft.captureDraftVersions(workflowId)
}

export function canApplyDraftSnapshot(workflowId: string, versions: DraftSyncVersions): boolean {
  return requireWorkflowState().draft.canApplyDraftSnapshot(workflowId, versions)
}

export function syncLocalDraftFromServer(workflowId: string): Promise<boolean> {
  return requireWorkflowState().draft.syncLocalDraftFromServer(workflowId)
}
