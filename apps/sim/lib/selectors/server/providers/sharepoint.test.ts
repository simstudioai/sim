/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveSelectorOAuthAccessToken } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolveSelectorOAuthAccessToken: vi.fn(),
}))

vi.mock('@/lib/selectors/server/credentials', () => ({
  resolveSelectorOAuthAccessToken: mockResolveSelectorOAuthAccessToken,
}))

import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { sharepointSelectorAttachments } from '@/lib/selectors/server/providers/sharepoint'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function detailArgs(
  selectorKey: 'sharepoint.lists' | 'sharepoint.sites',
  id: string
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: {
      oauthCredential: 'credential-1',
      ...(selectorKey === 'sharepoint.lists' ? { siteId: 'contoso.sharepoint.com,site,web' } : {}),
    },
    request: { kind: 'detail', id },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('SharePoint server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('hydrates a selected list directly within its site', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'list-1', displayName: 'Planning' }), { status: 200 })
    )

    await expect(
      sharepointSelectorAttachments['sharepoint.lists'].execute(
        detailArgs('sharepoint.lists', 'list-1')
      )
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: 'list-1', label: 'Planning' },
    })
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      '/sites/contoso.sharepoint.com%2Csite%2Cweb/lists/list-1'
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('hydrates a selected site directly by its compound ID', async () => {
    const siteId = 'contoso.sharepoint.com,site,web'
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: siteId, displayName: 'Engineering' }), { status: 200 })
    )

    await expect(
      sharepointSelectorAttachments['sharepoint.sites'].execute(
        detailArgs('sharepoint.sites', siteId)
      )
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: siteId, label: 'Engineering' },
    })
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      '/sites/contoso.sharepoint.com%2Csite%2Cweb'
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
