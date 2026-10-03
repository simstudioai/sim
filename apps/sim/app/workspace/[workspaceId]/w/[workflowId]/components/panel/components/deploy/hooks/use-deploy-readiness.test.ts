import { describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/operation-queue/store', () => ({
  useOperationQueueStore: Object.assign(
    () => ({ hasPendingOperations: false, hasOperationError: false }),
    {
      getState: () => ({
        hasOperationError: false,
        hasPendingOperations: () => false,
        waitForWorkflowOperations: () => Promise.resolve('drained'),
      }),
    }
  ),
}))

vi.mock('@/stores/workflow-diff/store', () => ({
  useWorkflowDiffStore: Object.assign(
    () => ({
      hasActiveDiff: false,
      hasPendingExternalUpdate: false,
      isReconciling: false,
    }),
    {
      getState: () => ({
        hasActiveDiff: false,
        pendingExternalUpdates: {},
        reconcilingWorkflows: {},
        reconciliationErrors: {},
      }),
    }
  ),
}))

import { getDeployReadinessState } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deploy-readiness'

const baseInput = {
  workflowId: 'workflow-a',
  hasPendingOperations: false,
  hasOperationError: false,
  hasActiveDiff: false,
  hasPendingExternalUpdate: false,
  isReconciling: false,
  reconciliationError: undefined,
}

describe('getDeployReadinessState', () => {
  it('blocks deploy while active workflow operations are pending', () => {
    const readiness = getDeployReadinessState({
      ...baseInput,
      hasPendingOperations: true,
    })

    expect(readiness.status).toBe('saving')
    expect(readiness.label).toBe('Saving...')
  })

  it('blocks deploy while copilot diff changes are under review', () => {
    expect(
      getDeployReadinessState({
        ...baseInput,
        hasActiveDiff: true,
      }).status
    ).toBe('reviewing-diff')
  })

  it('surfaces reconciliation failures as deploy-blocking sync errors', () => {
    const readiness = getDeployReadinessState({
      ...baseInput,
      reconciliationError: 'Latest workflow changes failed to sync',
    })

    expect(readiness.status).toBe('error')
    expect(readiness.tooltip).toBe('Latest workflow changes failed to sync')
  })
})
