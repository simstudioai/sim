/**
 * @vitest-environment node
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockConsolePersist,
  mockConsoleReset,
  mockClearAllExecutionPointers,
  mockGetQueryClient,
  mockMothershipQueueReset,
  mockOperationQueueReset,
  mockResetRegisteredUserData,
  mockRegistrySetState,
  mockSubBlockSetState,
  mockWaitForConsoleHydration,
  mockWorkflowSetState,
} = vi.hoisted(() => ({
  mockClearAllExecutionPointers: vi.fn(),
  mockConsolePersist: vi.fn(),
  mockConsoleReset: vi.fn(),
  mockGetQueryClient: vi.fn(),
  mockMothershipQueueReset: vi.fn(),
  mockOperationQueueReset: vi.fn(),
  mockResetRegisteredUserData: vi.fn(),
  mockRegistrySetState: vi.fn(),
  mockSubBlockSetState: vi.fn(),
  mockWaitForConsoleHydration: vi.fn(),
  mockWorkflowSetState: vi.fn(),
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: mockGetQueryClient,
}))
vi.mock('@/stores/user-data-reset-registry', () => ({
  resetRegisteredUserData: mockResetRegisteredUserData,
}))
vi.mock('@/stores/execution', () => ({
  useExecutionStore: { getState: () => ({ reset: vi.fn() }) },
}))
vi.mock('@/stores/mothership-drafts/store', () => ({
  useMothershipDraftsStore: { setState: vi.fn() },
}))
vi.mock('@/stores/mothership-queue/store', () => ({
  useMothershipQueueStore: { getState: () => ({ reset: mockMothershipQueueReset }) },
}))
vi.mock('@/stores/operation-queue/store', () => ({
  useOperationQueueStore: { getState: () => ({ reset: mockOperationQueueReset }) },
}))
vi.mock('@/stores/terminal', () => ({
  clearAllExecutionPointers: mockClearAllExecutionPointers,
  consolePersistence: { persist: mockConsolePersist, reset: mockConsoleReset },
  useTerminalConsoleStore: { setState: vi.fn() },
  waitForConsoleHydration: mockWaitForConsoleHydration,
}))
vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: { setState: mockRegistrySetState },
}))
vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: { setState: mockSubBlockSetState },
}))
vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: { setState: mockWorkflowSetState },
}))

import { resetAllStores } from '@/stores/reset-all-stores'

describe('resetAllStores', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient()
    mockGetQueryClient.mockReturnValue(queryClient)
    mockConsolePersist.mockResolvedValue(undefined)
    mockWaitForConsoleHydration.mockResolvedValue(undefined)
  })

  it('clears every cached server-state entry at the identity boundary', async () => {
    queryClient.setQueryData(['generalSettings', 'settings'], { theme: 'dark' })
    queryClient.setQueryData(['apiKeys', 'personal'], [{ id: 'key-a' }])
    queryClient.setQueryData(['workflowMcpServers', 'detail', 'workspace-a', 'server-a'], {
      id: 'server-a',
    })

    await resetAllStores()

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('removes transient workflow state and replaces persisted console data', async () => {
    await resetAllStores()

    expect(mockRegistrySetState).toHaveBeenCalledWith(
      expect.objectContaining({ clipboard: null, pendingSelection: null })
    )
    expect(mockWorkflowSetState).toHaveBeenCalledWith(
      expect.objectContaining({ currentWorkflowId: null, blocks: {}, edges: [] })
    )
    expect(mockSubBlockSetState).toHaveBeenCalledWith({ workflowValues: {} })
    expect(mockOperationQueueReset).toHaveBeenCalledOnce()
    expect(mockResetRegisteredUserData).toHaveBeenCalledOnce()
    expect(mockConsoleReset).toHaveBeenCalledOnce()
    expect(mockClearAllExecutionPointers).toHaveBeenCalledOnce()
    expect(mockMothershipQueueReset).toHaveBeenCalledOnce()
    expect(mockConsolePersist).toHaveBeenCalledWith({ merge: false })
  })

  it('waits for an in-flight console hydration before clearing identity state', async () => {
    let finishHydration: (() => void) | undefined
    mockWaitForConsoleHydration.mockReturnValue(
      new Promise<void>((resolve) => {
        finishHydration = resolve
      })
    )

    const resetPromise = resetAllStores()
    expect(mockOperationQueueReset).toHaveBeenCalledOnce()
    expect(mockResetRegisteredUserData).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(mockRegistrySetState).not.toHaveBeenCalled()

    finishHydration?.()
    await resetPromise
    expect(mockRegistrySetState).toHaveBeenCalledOnce()
  })
})
