import { requestJson } from '@/lib/api/client/request'
import { getWorkflowStateContract } from '@/lib/api/contracts'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { applyWorkflowStateToStores } from '@/stores/workflow-diff/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

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

export async function syncLocalDraftFromServer(workflowId: string): Promise<boolean> {
  if (useWorkflowRegistry.getState().activeWorkflowId !== workflowId) return false
  if (useOperationQueueStore.getState().hasPendingOperations(workflowId)) return false
  const localOperationVersionAtStart =
    useOperationQueueStore.getState().workflowOperationVersions[workflowId] ?? 0
  const remoteVersionAtStart = useWorkflowDiffStore.getState().remoteUpdateVersions[workflowId] ?? 0

  const responseData = await requestJson(getWorkflowStateContract, {
    params: { id: workflowId },
  })
  const wireState = responseData.data?.state
  if (!canApplyServerSnapshot(workflowId, remoteVersionAtStart, localOperationVersionAtStart)) {
    return false
  }
  if (!wireState) {
    throw new Error('No workflow state was returned while syncing the local draft')
  }

  // double-cast-allowed: workflowStateSchema is a wire supertype; normalized workflow state is persisted in store-compatible shape
  const workflowState = wireState as unknown as WorkflowState
  if (Object.hasOwn(responseData.data, 'variables')) {
    workflowState.variables = responseData.data.variables || {}
  }
  applyWorkflowStateToStores(workflowId, workflowState, { updateLastSaved: true })
  return true
}
