import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  search: vi.fn(),
  folders: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@/lib/workspace-files/search/repository', () => ({
  searchWorkspaceFileIndex: hoisted.search,
}))
vi.mock('@/lib/workspace-files/resolve-folder-scope', () => ({
  resolveWorkspaceFolderScope: hoisted.folders,
}))

import { searchWorkspaceFileContent } from '@/lib/workspace-files/application/search-workspace-file-content'

const mocks = {
  load: workspaceUploadsMockFns.mockLoadActiveWorkspaceContext,
  ...hoisted,
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

const principal = createSessionPrincipal()
const input = {
  workspaceId: 'workspace-1',
  query: 'needle',
  mode: 'exact',
  maxResults: 10,
} as const

describe('searchWorkspaceFileContent cancellation', () => {
  beforeEach(() => {
    mocks.load.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'user-1',
    })
    mocks.permission.mockResolvedValue('read')
    mocks.search.mockResolvedValue({ results: [] })
  })

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
