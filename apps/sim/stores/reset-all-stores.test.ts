import { terminalConsoleMockFns } from '@sim/testing'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetQueryClient,
  mockMothershipDraftsReset,
  mockOperationQueueReset,
  mockResetRegisteredUserData,
} = vi.hoisted(() => ({
  mockGetQueryClient: vi.fn(),
  mockMothershipDraftsReset: vi.fn(),
  mockOperationQueueReset: vi.fn(),
  mockResetRegisteredUserData: vi.fn(),
}))

vi.mock('@/hooks/queries/utils/get-query-client', () => ({
  getQueryClient: mockGetQueryClient,
}))
vi.mock('@/stores/user-data-reset-registry', () => ({
  resetRegisteredUserData: mockResetRegisteredUserData,
}))
vi.mock('@/stores/execution', () => ({
  useExecutionStore: { getState: () => ({ reset: vi.fn() }) },
}))
vi.mock('@/stores/mothership-drafts/store', () => ({
  useMothershipDraftsStore: { getState: () => ({ reset: mockMothershipDraftsReset }) },
}))
vi.mock('@/stores/operation-queue/store', () => ({
  useOperationQueueStore: { getState: () => ({ reset: mockOperationQueueReset }) },
}))

import { useMothershipOutgoingStore } from '@/stores/mothership-outgoing/store'
import { resetAllStores } from '@/stores/reset-all-stores'

const {
  mockWaitForConsoleHydration,
  mockConsolePersistence: { persist: mockConsolePersist, reset: mockConsoleReset },
} = terminalConsoleMockFns

describe('resetAllStores', () => {
  let queryClient: QueryClient

  beforeEach(() => {
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

  it('clears what the outgoing journal holds even if no chat loaded it this session', async () => {
    useMothershipOutgoingStore
      .getState()
      .record('chat-a', [
        { id: 'message-a', payload: { content: 'Hi' }, status: 'pending', writtenAt: 1 },
      ])

    await resetAllStores()

    expect(useMothershipOutgoingStore.getState().chats).toEqual({})
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
    expect(mockConsoleReset).not.toHaveBeenCalled()

    finishHydration?.()
    await resetPromise
    expect(mockConsoleReset).toHaveBeenCalledOnce()
  })
})
