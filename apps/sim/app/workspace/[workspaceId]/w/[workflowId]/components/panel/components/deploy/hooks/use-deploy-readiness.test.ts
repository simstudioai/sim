/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/operation-queue/store', () => ({
  useOperationQueueStore: Object.assign(
    () => ({ hasPendingOperations: false, hasOperationError: false }),
    {
      getState: () => ({
        hasOperationError: false,
        hasPendingOperations: () => false,
        waitForWorkflowOperations: () => Promise.resolve(true),
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
  it('allows deploy when no local persistence or reconciliation is pending', () => {
    expect(getDeployReadinessState(baseInput).status).toBe('ready')
  })

  it('blocks deploy while active workflow operations are pending', () => {
    const readiness = getDeployReadinessState({
      ...baseInput,
      hasPendingOperations: true,
    })

    expect(readiness.status).toBe('saving')
    expect(readiness.label).toBe('Saving...')
  })

  it('ignores queued operations before they are scoped to the active workflow', () => {
    expect(
      getDeployReadinessState({
        ...baseInput,
        hasPendingOperations: false,
      }).status
    ).toBe('ready')
  })

  it('uses a neutral syncing state while external updates reconcile', () => {
    const readiness = getDeployReadinessState({
      ...baseInput,
      hasPendingExternalUpdate: true,
    })

    expect(readiness.status).toBe('syncing')
    expect(readiness.label).toBe('Syncing...')
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
