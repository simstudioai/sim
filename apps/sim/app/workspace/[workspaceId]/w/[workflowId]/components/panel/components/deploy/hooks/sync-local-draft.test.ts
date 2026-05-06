/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequestJson,
  mockApplyWorkflowStateToStores,
  mockGetRegistryState,
  mockHasPendingOperations,
  mockGetOperationQueueState,
  mockGetWorkflowDiffState,
} = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
  mockApplyWorkflowStateToStores: vi.fn(),
  mockGetRegistryState: vi.fn(() => ({ activeWorkflowId: 'workflow-a' })),
  mockHasPendingOperations: vi.fn(() => false),
  mockGetOperationQueueState: vi.fn(() => ({
    hasPendingOperations: mockHasPendingOperations,
    workflowOperationVersions: {},
  })),
  mockGetWorkflowDiffState: vi.fn(() => ({
    hasActiveDiff: false,
    pendingExternalUpdates: {},
    reconcilingWorkflows: {},
    reconciliationErrors: {},
    remoteUpdateVersions: {},
  })),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/lib/api/contracts', () => ({
  getWorkflowStateContract: {},
}))

vi.mock('@/stores/workflow-diff/utils', () => ({
  applyWorkflowStateToStores: mockApplyWorkflowStateToStores,
}))

vi.mock('@/stores/workflow-diff/store', () => ({
  useWorkflowDiffStore: {
    getState: mockGetWorkflowDiffState,
  },
}))

vi.mock('@/stores/operation-queue/store', () => ({
  useOperationQueueStore: {
    getState: mockGetOperationQueueState,
  },
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: mockGetRegistryState,
  },
}))

import { syncLocalDraftFromServer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/sync-local-draft'

describe('syncLocalDraftFromServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRegistryState.mockReturnValue({ activeWorkflowId: 'workflow-a' })
    mockHasPendingOperations.mockReturnValue(false)
    mockGetOperationQueueState.mockImplementation(() => ({
      hasPendingOperations: mockHasPendingOperations,
      workflowOperationVersions: {},
    }))
    mockGetWorkflowDiffState.mockReturnValue({
      hasActiveDiff: false,
      pendingExternalUpdates: {},
      reconcilingWorkflows: {},
      reconciliationErrors: {},
      remoteUpdateVersions: {},
    })
  })

  it('hydrates sibling workflow variables into the applied workflow state', async () => {
    mockRequestJson.mockResolvedValue({
      data: {
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          lastSaved: 1,
        },
        variables: {
          'variable-a': {
            id: 'variable-a',
            name: 'API_KEY',
            type: 'plain',
            value: 'secret',
          },
        },
      },
    })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(true)

    expect(mockApplyWorkflowStateToStores).toHaveBeenCalledWith(
      'workflow-a',
      expect.objectContaining({
        variables: {
          'variable-a': {
            id: 'variable-a',
            name: 'API_KEY',
            type: 'plain',
            value: 'secret',
          },
        },
      }),
      { updateLastSaved: true }
    )
  })

  it('does not apply a fetched draft after navigation changes the active workflow', async () => {
    mockGetRegistryState
      .mockReturnValueOnce({ activeWorkflowId: 'workflow-a' })
      .mockReturnValueOnce({ activeWorkflowId: 'workflow-b' })
    mockRequestJson.mockResolvedValue({
      data: {
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          lastSaved: 1,
        },
        variables: {},
      },
    })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(false)

    expect(mockApplyWorkflowStateToStores).not.toHaveBeenCalled()
  })

  it('does not synthesize an empty variables object when the server omits variables', async () => {
    mockRequestJson.mockResolvedValue({
      data: {
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          lastSaved: 1,
        },
      },
    })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(true)

    const appliedState = mockApplyWorkflowStateToStores.mock.calls[0][1]
    expect(Object.hasOwn(appliedState, 'variables')).toBe(false)
  })

  it('does not apply a fetched draft over newly queued local operations', async () => {
    mockHasPendingOperations.mockReturnValueOnce(false).mockReturnValueOnce(true)
    mockRequestJson.mockResolvedValue({
      data: {
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          lastSaved: 1,
        },
        variables: {},
      },
    })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(false)

    expect(mockApplyWorkflowStateToStores).not.toHaveBeenCalled()
  })

  it('does not apply a fetched draft when a newer remote update arrives during fetch', async () => {
    mockGetWorkflowDiffState
      .mockReturnValueOnce({
        hasActiveDiff: false,
        pendingExternalUpdates: {},
        reconcilingWorkflows: {},
        reconciliationErrors: {},
        remoteUpdateVersions: {},
      })
      .mockReturnValueOnce({
        hasActiveDiff: false,
        pendingExternalUpdates: {},
        reconcilingWorkflows: {},
        reconciliationErrors: {},
        remoteUpdateVersions: { 'workflow-a': 1 },
      })
    mockRequestJson.mockResolvedValue({
      data: {
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          lastSaved: 1,
        },
        variables: {},
      },
    })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(false)

    expect(mockApplyWorkflowStateToStores).not.toHaveBeenCalled()
  })

  it('does not apply a fetched draft when local operations queue and drain during fetch', async () => {
    mockGetOperationQueueState
      .mockReturnValueOnce({
        hasPendingOperations: mockHasPendingOperations,
        workflowOperationVersions: {},
      })
      .mockReturnValueOnce({
        hasPendingOperations: mockHasPendingOperations,
        workflowOperationVersions: {},
      })
      .mockReturnValueOnce({
        hasPendingOperations: mockHasPendingOperations,
        workflowOperationVersions: { 'workflow-a': 1 },
      })
    mockRequestJson.mockResolvedValue({
      data: {
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          lastSaved: 1,
        },
        variables: {},
      },
    })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(false)

    expect(mockApplyWorkflowStateToStores).not.toHaveBeenCalled()
  })
})
