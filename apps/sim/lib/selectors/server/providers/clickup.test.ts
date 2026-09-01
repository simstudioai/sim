/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchProviderJson, mockResolveSelectorOAuthAccessToken } = vi.hoisted(() => ({
  mockFetchProviderJson: vi.fn(),
  mockResolveSelectorOAuthAccessToken: vi.fn(),
}))

vi.mock('@/lib/selectors/server/providers/provider-http', () => ({
  fetchProviderJson: mockFetchProviderJson,
}))

vi.mock('@/lib/selectors/server/credentials', () => ({
  resolveSelectorOAuthAccessToken: mockResolveSelectorOAuthAccessToken,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { clickupSelectorAttachments } from '@/lib/selectors/server/providers/clickup'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function listArgs(context: Record<string, string>): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'clickup.lists',
    context,
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('ClickUp server selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
    mockFetchProviderJson.mockResolvedValue({ lists: [] })
  })

  it('trims saved dependency IDs and treats a whitespace-only folder as absent', async () => {
    await clickupSelectorAttachments['clickup.lists'].execute(
      listArgs({ folderId: '   ', spaceId: ' space-1 ' })
    )

    expect(String(mockFetchProviderJson.mock.calls[0]?.[0])).toContain('/space/space-1/list')

    await clickupSelectorAttachments['clickup.lists'].execute(
      listArgs({ folderId: ' folder-1 ', spaceId: 'space-1' })
    )

    expect(String(mockFetchProviderJson.mock.calls[1]?.[0])).toContain('/folder/folder-1/list')

    const folderArgs = listArgs({ spaceId: '   ', listSpaceId: ' list-space-1 ' })
    folderArgs.selectorKey = 'clickup.folders'
    await clickupSelectorAttachments['clickup.folders'].execute(folderArgs)

    expect(String(mockFetchProviderJson.mock.calls[2]?.[0])).toContain('/space/list-space-1/folder')

    await clickupSelectorAttachments['clickup.lists'].execute(
      listArgs({ folderId: '   ', spaceId: '   ', listSpaceId: ' list-space-1 ' })
    )

    expect(String(mockFetchProviderJson.mock.calls[3]?.[0])).toContain('/space/list-space-1/list')
  })
})
