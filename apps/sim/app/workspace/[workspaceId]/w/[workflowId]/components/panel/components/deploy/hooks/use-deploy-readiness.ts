import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useOperationQueueStore } from '@/stores/operation-queue/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'

export type DeployReadinessStatus =
  | 'ready'
  | 'missing-workflow'
  | 'saving'
  | 'reviewing-diff'
  | 'syncing'
  | 'error'

interface DeployReadinessInput {
  workflowId: string | null
  hasPendingOperations: boolean
  hasOperationError: boolean
  hasActiveDiff: boolean
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

  if (input.hasActiveDiff) {
    return {
      status: 'reviewing-diff' as const,
      label: 'Reviewing...',
      tooltip: 'Accept or reject the current copilot changes before deploying',
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

  const { hasActiveDiff, hasPendingExternalUpdate, isReconciling, reconciliationError } =
    useWorkflowDiffStore(
      useShallow((state) => ({
        hasActiveDiff: state.hasActiveDiff,
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
        hasActiveDiff,
        hasPendingExternalUpdate,
        isReconciling,
        reconciliationError,
      }),
    [
      workflowId,
      hasPendingOperations,
      hasOperationError,
      hasActiveDiff,
      hasPendingExternalUpdate,
      isReconciling,
      reconciliationError,
    ]
  )

  const waitUntilReady = useCallback(async () => {
    if (!workflowId) return false

    const queue = useOperationQueueStore.getState()
    if (queue.hasOperationError) return false

    const drained = await queue.waitForWorkflowOperations(workflowId)
    if (!drained) return false

    const latestQueue = useOperationQueueStore.getState()
    const diff = useWorkflowDiffStore.getState()
    return (
      !latestQueue.hasOperationError &&
      !latestQueue.hasPendingOperations(workflowId) &&
      !diff.hasActiveDiff &&
      !diff.pendingExternalUpdates[workflowId] &&
      !diff.reconcilingWorkflows[workflowId] &&
      !diff.reconciliationErrors[workflowId]
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
