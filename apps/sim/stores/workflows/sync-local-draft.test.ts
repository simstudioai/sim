/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFetchQuery,
  mockApplyWorkflowStateToStores,
  mockGetRegistryState,
  mockHasPendingOperations,
  mockGetOperationQueueState,
  mockGetWorkflowDiffState,
} = vi.hoisted(() => ({
  mockFetchQuery: vi.fn(),
  mockApplyWorkflowStateToStores: vi.fn(),
  mockGetRegistryState: vi.fn(() => ({ activeWorkflowId: 'workflow-a' })),
  mockHasPendingOperations: vi.fn(() => false),
  mockGetOperationQueueState: vi.fn(() => ({
    hasPendingOperations: mockHasPendingOperations,
    workflowOperationVersions: {},
    remoteApplyVersions: {},
  })),
  mockGetWorkflowDiffState: vi.fn(() => ({
    hasActiveDiff: false,
    pendingExternalUpdates: {},
    reconcilingWorkflows: {},
    reconciliationErrors: {},
    remoteUpdateVersions: {},
  })),
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: () => ({ fetchQuery: mockFetchQuery }),
}))

vi.mock('@/hooks/queries/utils/fetch-workflow-envelope', () => ({
  fetchWorkflowEnvelope: vi.fn(),
}))

vi.mock('@/hooks/queries/utils/workflow-keys', () => ({
  workflowKeys: {
    state: (id: string) => ['workflow', 'state', id],
  },
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

import { syncLocalDraftFromServer } from '@/stores/workflows/sync-local-draft'

function buildEnvelopeState() {
  return {
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: 1,
  }
}

describe('syncLocalDraftFromServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRegistryState.mockReturnValue({ activeWorkflowId: 'workflow-a' })
    mockHasPendingOperations.mockReturnValue(false)
    mockGetOperationQueueState.mockImplementation(() => ({
      hasPendingOperations: mockHasPendingOperations,
      workflowOperationVersions: {},
      remoteApplyVersions: {},
    }))
    mockGetWorkflowDiffState.mockReturnValue({
      hasActiveDiff: false,
      pendingExternalUpdates: {},
      reconcilingWorkflows: {},
      reconciliationErrors: {},
      remoteUpdateVersions: {},
    })
  })

  it('fetches through the shared workflow-state query key with a fresh fetch', async () => {
    mockFetchQuery.mockResolvedValue({ state: buildEnvelopeState(), variables: {} })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(true)

    expect(mockFetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['workflow', 'state', 'workflow-a'],
        staleTime: 0,
      })
    )
  })

  it('hydrates sibling workflow variables into the applied workflow state', async () => {
    mockFetchQuery.mockResolvedValue({
      state: buildEnvelopeState(),
      variables: {
        'variable-a': {
          id: 'variable-a',
          name: 'API_KEY',
          type: 'plain',
          value: 'secret',
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

  it('does not mutate the shared query-cache envelope when stamping variables', async () => {
    const envelope = {
      state: buildEnvelopeState(),
      variables: { 'variable-a': { id: 'variable-a', name: 'X', type: 'plain', value: '1' } },
    }
    mockFetchQuery.mockResolvedValue(envelope)

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(true)

    expect(Object.hasOwn(envelope.state, 'variables')).toBe(false)
    const appliedState = mockApplyWorkflowStateToStores.mock.calls[0][1]
    expect(appliedState).not.toBe(envelope.state)
  })

  it('does not apply a fetched draft after navigation changes the active workflow', async () => {
    mockGetRegistryState
      .mockReturnValueOnce({ activeWorkflowId: 'workflow-a' })
      .mockReturnValueOnce({ activeWorkflowId: 'workflow-b' })
    mockFetchQuery.mockResolvedValue({ state: buildEnvelopeState(), variables: {} })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(false)

    expect(mockApplyWorkflowStateToStores).not.toHaveBeenCalled()
  })

  it('does not synthesize an empty variables object when the server omits variables', async () => {
    mockFetchQuery.mockResolvedValue({ state: buildEnvelopeState() })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(true)

    const appliedState = mockApplyWorkflowStateToStores.mock.calls[0][1]
    expect(Object.hasOwn(appliedState, 'variables')).toBe(false)
  })

  it('does not apply a fetched draft over newly queued local operations', async () => {
    mockHasPendingOperations.mockReturnValueOnce(false).mockReturnValueOnce(true)
    mockFetchQuery.mockResolvedValue({ state: buildEnvelopeState(), variables: {} })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(false)

    expect(mockApplyWorkflowStateToStores).not.toHaveBeenCalled()
  })

  it('does not apply a fetched draft when an active diff is showing', async () => {
    mockGetWorkflowDiffState.mockReturnValue({
      hasActiveDiff: true,
      pendingExternalUpdates: {},
      reconcilingWorkflows: {},
      reconciliationErrors: {},
      remoteUpdateVersions: {},
    })
    mockFetchQuery.mockResolvedValue({ state: buildEnvelopeState(), variables: {} })

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
    mockFetchQuery.mockResolvedValue({ state: buildEnvelopeState(), variables: {} })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(false)

    expect(mockApplyWorkflowStateToStores).not.toHaveBeenCalled()
  })

  it('does not apply a fetched draft when local operations queue and drain during fetch', async () => {
    mockGetOperationQueueState
      .mockReturnValueOnce({
        hasPendingOperations: mockHasPendingOperations,
        workflowOperationVersions: {},
        remoteApplyVersions: {},
      })
      .mockReturnValueOnce({
        hasPendingOperations: mockHasPendingOperations,
        workflowOperationVersions: {},
        remoteApplyVersions: {},
      })
      .mockReturnValueOnce({
        hasPendingOperations: mockHasPendingOperations,
        workflowOperationVersions: {},
        remoteApplyVersions: {},
      })
      .mockReturnValueOnce({
        hasPendingOperations: mockHasPendingOperations,
        workflowOperationVersions: { 'workflow-a': 1 },
        remoteApplyVersions: {},
      })
    mockFetchQuery.mockResolvedValue({ state: buildEnvelopeState(), variables: {} })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(false)

    expect(mockApplyWorkflowStateToStores).not.toHaveBeenCalled()
  })

  it('refetches when a remote op is applied during the fetch, then applies the fresh snapshot', async () => {
    const queueState = {
      hasPendingOperations: mockHasPendingOperations,
      workflowOperationVersions: {} as Record<string, number>,
      remoteApplyVersions: {} as Record<string, number>,
    }
    mockGetOperationQueueState.mockImplementation(() => queueState)

    const staleEnvelope = { state: buildEnvelopeState(), variables: {} }
    const freshEnvelope = { state: { ...buildEnvelopeState(), lastSaved: 2 }, variables: {} }
    mockFetchQuery
      .mockImplementationOnce(async () => {
        queueState.remoteApplyVersions = { 'workflow-a': 1 }
        return staleEnvelope
      })
      .mockResolvedValueOnce(freshEnvelope)

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(true)

    expect(mockFetchQuery).toHaveBeenCalledTimes(2)
    expect(mockApplyWorkflowStateToStores).toHaveBeenCalledWith(
      'workflow-a',
      expect.objectContaining({ lastSaved: 2 }),
      { updateLastSaved: true }
    )
  })

  it('applies the latest snapshot after exhausting retries during a busy remote session', async () => {
    const queueState = {
      hasPendingOperations: mockHasPendingOperations,
      workflowOperationVersions: {} as Record<string, number>,
      remoteApplyVersions: {} as Record<string, number>,
    }
    mockGetOperationQueueState.mockImplementation(() => queueState)

    let remoteVersion = 0
    mockFetchQuery.mockImplementation(async () => {
      remoteVersion += 1
      queueState.remoteApplyVersions = { 'workflow-a': remoteVersion }
      return { state: { ...buildEnvelopeState(), lastSaved: remoteVersion }, variables: {} }
    })

    await expect(syncLocalDraftFromServer('workflow-a')).resolves.toBe(true)

    expect(mockFetchQuery).toHaveBeenCalledTimes(3)
    expect(mockApplyWorkflowStateToStores).toHaveBeenCalledWith(
      'workflow-a',
      expect.objectContaining({ lastSaved: 3 }),
      { updateLastSaved: true }
    )
  })

  it('propagates fetch failures to the caller', async () => {
    mockFetchQuery.mockRejectedValue(new Error('network down'))

    await expect(syncLocalDraftFromServer('workflow-a')).rejects.toThrow('network down')

    expect(mockApplyWorkflowStateToStores).not.toHaveBeenCalled()
  })
})
