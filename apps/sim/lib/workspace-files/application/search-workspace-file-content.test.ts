/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  permission: vi.fn(),
  search: vi.fn(),
  folders: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({ loadActiveWorkspaceContext: mocks.load }))
vi.mock('@/lib/workspace-files/search/repository', () => ({
  searchWorkspaceFileIndex: mocks.search,
}))
vi.mock('@/lib/workspace-files/resolve-folder-scope', () => ({
  resolveWorkspaceFolderScope: mocks.folders,
}))

import { searchWorkspaceFileContent } from '@/lib/workspace-files/application/search-workspace-file-content'

const principal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' } as const
const input = {
  workspaceId: 'workspace-1',
  query: 'needle',
  mode: 'exact',
  maxResults: 10,
} as const

describe('searchWorkspaceFileContent cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.load.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    mocks.permission.mockResolvedValue('read')
    mocks.search.mockResolvedValue({ results: [] })
  })

  it.each(['request', 'input'] as const)(
    'propagates the %s signal through the authorized application operation',
    async (source) => {
      const controller = new AbortController()
      await searchWorkspaceFileContent.execute({
        principal,
        input: { ...input, ...(source === 'input' ? { signal: controller.signal } : {}) },
        request: {
          headers: new Headers(),
          ...(source === 'request' ? { signal: controller.signal } : {}),
        },
      })
      expect(mocks.search).toHaveBeenCalledWith(
        expect.objectContaining({ signal: controller.signal })
      )
    }
  )

  it('does not resolve folders or enqueue database work for a cancelled HTTP request', async () => {
    const signal = AbortSignal.abort(new Error('cancelled'))
    await expect(
      searchWorkspaceFileContent.execute({
        principal,
        input: { ...input, folderPaths: ['/notes'] },
        request: { headers: new Headers(), signal },
      })
    ).rejects.toBe(signal.reason)
    expect(mocks.folders).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })
})
