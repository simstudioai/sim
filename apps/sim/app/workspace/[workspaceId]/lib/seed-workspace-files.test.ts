import { describe, expect, it, vi } from 'vitest'

const { mockListWorkspaceFilesWithShares } = vi.hoisted(() => ({
  mockListWorkspaceFilesWithShares: vi.fn(),
}))

vi.mock('@/lib/workspace-files/queries', () => ({
  listWorkspaceFilesWithShares: mockListWorkspaceFilesWithShares,
}))

/** The key factory lives in a `'use client'` module that pulls emcn's CSS at import. */
vi.mock('@sim/emcn', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { seedWorkspaceFiles } from '@/app/workspace/[workspaceId]/lib/seed-workspace-files'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

const WORKSPACE_ID = 'ws-123'

function makeClient() {
  const store = new Map<string, unknown>()
  return {
    setQueryData: (key: readonly unknown[], value: unknown) =>
      store.set(JSON.stringify(key), value),
    getQueryData: (key: readonly unknown[]) => store.get(JSON.stringify(key)),
  } as never as import('@tanstack/react-query').QueryClient & {
    getQueryData: (key: readonly unknown[]) => unknown
  }
}

describe('seedWorkspaceFiles', () => {
  /**
   * A workspace over the budget seeds NOTHING rather than the prefix that was read: the
   * Files browser renders this list as the workspace's files, so a truncated seed would
   * silently hide some. The client fetch reaches the route for the complete list instead.
   */
  it('seeds nothing when the workspace exceeds the budget', async () => {
    mockListWorkspaceFilesWithShares.mockResolvedValue(null)
    const client = makeClient()

    await seedWorkspaceFiles(client, WORKSPACE_ID)

    expect(client.getQueryData(workspaceFilesKeys.list(WORKSPACE_ID, 'active'))).toBeUndefined()
  })
})
