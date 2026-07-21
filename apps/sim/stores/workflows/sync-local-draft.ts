import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { fetchWorkflowEnvelope } from '@/hooks/queries/utils/fetch-workflow-envelope'
import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { applyWorkflowStateToStores } from '@/stores/workflow-diff/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('SyncLocalDraft')

/**
 * A remote collaborator's edit applied mid-fetch means the fetched snapshot may
 * predate that edit's persist (the realtime server debounces writes), so the
 * sync refetches. Bounded: a persistently busy session keeps converging through
 * op broadcasts anyway, so after the last attempt the latest snapshot is
 * applied rather than leaving a reconnecting client on stale state.
 */
const MAX_SYNC_FETCH_ATTEMPTS = 3
const SYNC_RETRY_DELAY_MS = 50

function canApplyServerSnapshot(
  workflowId: string,
  remoteVersionAtStart: number,
  localOperationVersionAtStart: number
): boolean {
  if (useWorkflowRegistry.getState().activeWorkflowId !== workflowId) return false
  const operationQueueState = useOperationQueueStore.getState()
  if (operationQueueState.hasPendingOperations(workflowId)) return false
  if (
    (operationQueueState.workflowOperationVersions[workflowId] ?? 0) !==
    localOperationVersionAtStart
  ) {
    return false
  }

  const diffState = useWorkflowDiffStore.getState()
  return (
    !diffState.hasActiveDiff &&
    !diffState.pendingExternalUpdates[workflowId] &&
    !diffState.reconcilingWorkflows[workflowId] &&
    !diffState.reconciliationErrors[workflowId] &&
    (diffState.remoteUpdateVersions[workflowId] ?? 0) === remoteVersionAtStart
  )
}

/**
 * Reconciles the local Zustand stores with the server's current draft by
 * fetching migrated state over HTTP and applying it — used after deploys and
 * on socket join, where the realtime server can only supply raw (unmigrated)
 * state.
 *
 * Fetches through the shared `workflowKeys.state(id)` React Query entry
 * (always-fresh, in-flight deduped), so a sync racing the registry hydration
 * coalesces into a single request and the cache stays warm.
 *
 * Refuses to apply (returns false) when the session is busy — pending or
 * newly-queued local operations, an active copilot diff, in-progress
 * reconciliation, a newer remote update during the fetch, or navigation away —
 * so it never clobbers in-flight work. A remote collaborator's op applied
 * during the fetch triggers a bounded refetch instead (the snapshot may
 * predate that op's persist). Throws when the fetch itself fails.
 */
export async function syncLocalDraftFromServer(workflowId: string): Promise<boolean> {
  if (useWorkflowRegistry.getState().activeWorkflowId !== workflowId) return false
  if (useOperationQueueStore.getState().hasPendingOperations(workflowId)) return false
  const localOperationVersionAtStart =
    useOperationQueueStore.getState().workflowOperationVersions[workflowId] ?? 0
  const remoteVersionAtStart = useWorkflowDiffStore.getState().remoteUpdateVersions[workflowId] ?? 0

  let envelope: Awaited<ReturnType<typeof fetchWorkflowEnvelope>> | undefined
  for (let attempt = 1; ; attempt++) {
    const remoteApplyVersionAtStart =
      useOperationQueueStore.getState().remoteApplyVersions[workflowId] ?? 0

    envelope = await getQueryClient().fetchQuery({
      queryKey: workflowKeys.state(workflowId),
      queryFn: ({ signal }) => fetchWorkflowEnvelope(workflowId, signal),
      staleTime: 0,
    })

    if (!canApplyServerSnapshot(workflowId, remoteVersionAtStart, localOperationVersionAtStart)) {
      return false
    }

    const remoteOpAppliedDuringFetch =
      (useOperationQueueStore.getState().remoteApplyVersions[workflowId] ?? 0) !==
      remoteApplyVersionAtStart
    if (!remoteOpAppliedDuringFetch) break

    if (attempt >= MAX_SYNC_FETCH_ATTEMPTS) {
      logger.info('Applying latest draft snapshot despite concurrent remote ops', {
        workflowId,
        attempts: attempt,
      })
      break
    }
    await sleep(SYNC_RETRY_DELAY_MS)
  }

  const wireState = envelope?.state
  if (!envelope || !wireState) {
    throw new Error('No workflow state was returned while syncing the local draft')
  }

  // Copy before annotating: the envelope is the shared React Query cache entry
  // and must not be mutated.
  const draftState = Object.hasOwn(envelope, 'variables')
    ? { ...wireState, variables: envelope.variables || {} }
    : { ...wireState }
  // double-cast-allowed: workflowStateSchema is a wire supertype; normalized workflow state is persisted in store-compatible shape
  const workflowState = draftState as unknown as WorkflowState
  applyWorkflowStateToStores(workflowId, workflowState, { updateLastSaved: true })
  return true
}
