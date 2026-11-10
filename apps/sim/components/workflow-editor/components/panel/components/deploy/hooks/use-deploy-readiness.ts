import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import { useWorkflowReconciliationStore } from '@/stores/workflow-reconciliation/store'

export type DeployReadinessStatus = 'ready' | 'missing-workflow' | 'saving' | 'syncing' | 'error'

interface DeployReadinessInput {
  workflowId: string | null
  hasPendingOperations: boolean
  hasOperationError: boolean
  hasPendingExternalUpdate: boolean
  isReconciling: boolean
  reconciliationError?: string
}

export interface DeployReadiness {
  status: DeployReadinessStatus
  isReady: boolean
  isBlocked: boolean
  isSyncing: boolean
  label: string
  tooltip: string
  waitUntilReady: () => Promise<boolean>
}

export function getDeployReadinessState(input: DeployReadinessInput) {
  if (!input.workflowId) {
    return {
      status: 'missing-workflow' as const,
      label: 'Deploy',
      tooltip: 'No workflow selected',
    }
  }

  if (input.hasOperationError || input.reconciliationError) {
    return {
      status: 'error' as const,
      label: 'Sync failed',
      tooltip:
        input.reconciliationError ||
        'Some changes failed to save. Reconnect or refresh before deploying.',
    }
  }

  if (input.hasPendingOperations) {
    return {
      status: 'saving' as const,
      label: 'Saving...',
      tooltip: 'Saving workflow changes before deployment',
    }
  }

  if (input.hasPendingExternalUpdate || input.isReconciling) {
    return {
      status: 'syncing' as const,
      label: 'Syncing...',
      tooltip: 'Syncing the latest workflow changes before deployment',
    }
  }

  return {
    status: 'ready' as const,
    label: 'Ready',
    tooltip: 'Ready to deploy',
  }
}

export function useDeployReadiness(workflowId: string | null): DeployReadiness {
  const { hasPendingOperations, hasOperationError } = useOperationQueueStore(
    useShallow((state) => ({
      hasPendingOperations: workflowId
        ? state.operations.some((op) => op.workflowId === workflowId)
        : false,
      hasOperationError: state.hasOperationError,
    }))
  )

  const { hasPendingExternalUpdate, isReconciling, reconciliationError } =
    useWorkflowReconciliationStore(
      useShallow((state) => ({
        hasPendingExternalUpdate: workflowId
          ? Boolean(state.pendingExternalUpdates[workflowId])
          : false,
        isReconciling: workflowId ? Boolean(state.reconcilingWorkflows[workflowId]) : false,
        reconciliationError: workflowId ? state.reconciliationErrors[workflowId] : undefined,
      }))
    )

  const readiness = useMemo(
    () =>
      getDeployReadinessState({
        workflowId,
        hasPendingOperations,
        hasOperationError,
        hasPendingExternalUpdate,
        isReconciling,
        reconciliationError,
      }),
    [
      workflowId,
      hasPendingOperations,
      hasOperationError,
      hasPendingExternalUpdate,
      isReconciling,
      reconciliationError,
    ]
  )

  const waitUntilReady = useCallback(async () => {
    if (!workflowId) return false

    const queue = useOperationQueueStore.getState()
    if (queue.hasOperationError) return false

    const drainResult = await queue.waitForWorkflowOperations(workflowId)
    if (drainResult !== 'drained') return false

    const latestQueue = useOperationQueueStore.getState()
    const reconciliation = useWorkflowReconciliationStore.getState()
    return (
      !latestQueue.hasOperationError &&
      !latestQueue.hasPendingOperations(workflowId) &&
      !reconciliation.pendingExternalUpdates[workflowId] &&
      !reconciliation.reconcilingWorkflows[workflowId] &&
      !reconciliation.reconciliationErrors[workflowId]
    )
  }, [workflowId])

  const isReady = readiness.status === 'ready'
  const isSyncing = readiness.status === 'saving' || readiness.status === 'syncing'

  return {
    ...readiness,
    isReady,
    isBlocked: !isReady,
    isSyncing,
    waitUntilReady,
  }
}
