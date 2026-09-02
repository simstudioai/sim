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

function listArgs(
  selectorKey: 'sharepoint.lists' | 'sharepoint.sites',
  cursor?: string,
  search?: string
): ExecuteServerSelectorArgs {
  return {
    ...detailArgs(selectorKey, ''),
    request: {
      kind: 'list',
      ...(cursor ? { cursor } : {}),
      ...(search ? { search } : {}),
    },
  }
}

describe('SharePoint server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it.each([
    {
      selectorKey: 'sharepoint.sites' as const,
      search: '  Engineering  ',
      firstValue: { id: 'site-1', name: 'Engineering' },
      firstItem: { id: 'site-1', label: 'Engineering' },
      secondValue: { id: 'site-2', name: 'Operations' },
      secondItem: { id: 'site-2', label: 'Operations' },
      nextCursor: 'https://graph.microsoft.com/v1.0/sites?search=Engineering&$skiptoken=next',
    },
    {
      selectorKey: 'sharepoint.lists' as const,
      search: undefined,
      firstValue: { id: 'list-1', displayName: 'Planning', list: { hidden: false } },
      firstItem: { id: 'list-1', label: 'Planning' },
      secondValue: { id: 'list-2', displayName: 'Operations', list: { hidden: false } },
      secondItem: { id: 'list-2', label: 'Operations' },
      nextCursor:
        'https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com%2Csite%2Cweb/lists?$skiptoken=next',
    },
  ])('paginates $selectorKey only when its cursor is requested', async (testCase) => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ value: [testCase.firstValue], '@odata.nextLink': testCase.nextCursor }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [testCase.secondValue] }), { status: 200 })
      )

    const first = await sharepointSelectorAttachments[testCase.selectorKey].execute(
      listArgs(testCase.selectorKey, undefined, testCase.search)
    )

    expect(first).toEqual({
      kind: 'list',
      items: [testCase.firstItem],
      nextCursor: testCase.nextCursor,
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    if (testCase.search) {
      expect(new URL(String(mockFetch.mock.calls[0]?.[0])).searchParams.get('search')).toBe(
        'Engineering'
      )
    }

    const second = await sharepointSelectorAttachments[testCase.selectorKey].execute(
      listArgs(testCase.selectorKey, testCase.nextCursor, testCase.search)
    )

    expect(second).toEqual({ kind: 'list', items: [testCase.secondItem] })
    expect(String(mockFetch.mock.calls[1]?.[0])).toBe(testCase.nextCursor)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('rejects a Graph cursor for another SharePoint resource', async () => {
    await expect(
      sharepointSelectorAttachments['sharepoint.lists'].execute(
        listArgs(
          'sharepoint.lists',
          'https://graph.microsoft.com/v1.0/sites/another-site/lists?$skiptoken=next'
        )
      )
    ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
    expect(mockResolveSelectorOAuthAccessToken).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

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
