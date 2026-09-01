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
import { hubspotSelectorAttachments } from '@/lib/selectors/server/providers/hubspot'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function args(
  request: ExecuteServerSelectorArgs['request'],
  selectorKey: ExecuteServerSelectorArgs['selectorKey'] = 'hubspot.lists'
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: { oauthCredential: 'credential-1' },
    request,
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('HubSpot server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('preserves list search and follows the response offset on demand', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hasMore: true,
            lists: [{ listId: 'list-1', name: 'Revenue prospects' }],
            offset: 500,
            total: 501,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hasMore: false,
            lists: [{ listId: 'list-2', name: 'Revenue customers' }],
            offset: 501,
            total: 501,
          }),
          { status: 200 }
        )
      )

    const first = await hubspotSelectorAttachments['hubspot.lists'].execute(
      args({ kind: 'list', search: '  Revenue  ' })
    )
    const second = await hubspotSelectorAttachments['hubspot.lists'].execute(
      args({ kind: 'list', search: '  Revenue  ', cursor: '500' })
    )

    expect(first).toEqual({
      kind: 'list',
      items: [{ id: 'list-1', label: 'Revenue prospects' }],
      nextCursor: '500',
    })
    expect(second).toEqual({
      kind: 'list',
      items: [{ id: 'list-2', label: 'Revenue customers' }],
    })
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe('https://api.hubapi.com/crm/v3/lists/search')
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toEqual({
      count: 500,
      offset: 0,
      query: 'Revenue',
      processingTypes: ['MANUAL', 'DYNAMIC', 'SNAPSHOT'],
    })
    expect(JSON.parse(String(mockFetch.mock.calls[1]?.[1]?.body))).toEqual({
      count: 500,
      offset: 500,
      query: 'Revenue',
      processingTypes: ['MANUAL', 'DYNAMIC', 'SNAPSHOT'],
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('hydrates a selected list directly by id', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ list: { listId: '123', name: 'Revenue prospects' } }), {
        status: 200,
      })
    )

    await expect(
      hubspotSelectorAttachments['hubspot.lists'].execute(args({ kind: 'detail', id: '123' }))
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: '123', label: 'Revenue prospects' },
    })
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe('https://api.hubapi.com/crm/v3/lists/123')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('paginates active owners through the HubSpot continuation cursor on demand', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              { id: '100', firstName: 'Former', lastName: 'Owner', archived: true },
              { id: '101', firstName: 'Ada', lastName: 'Lovelace', archived: false },
            ],
            paging: { next: { after: 'owner-page-2' } },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ id: '102', email: 'grace@example.com' }] }), {
          status: 200,
        })
      )

    const first = await hubspotSelectorAttachments['hubspot.owners'].execute(
      args({ kind: 'list' }, 'hubspot.owners')
    )
    const second = await hubspotSelectorAttachments['hubspot.owners'].execute(
      args({ kind: 'list', cursor: 'owner-page-2' }, 'hubspot.owners')
    )

    expect(first).toEqual({
      kind: 'list',
      items: [{ id: '101', label: 'Ada Lovelace' }],
      nextCursor: 'owner-page-2',
    })
    expect(second).toEqual({
      kind: 'list',
      items: [{ id: '102', label: 'grace@example.com' }],
    })
    const firstUrl = new URL(String(mockFetch.mock.calls[0]?.[0]))
    const secondUrl = new URL(String(mockFetch.mock.calls[1]?.[0]))
    expect(firstUrl.searchParams.get('limit')).toBe('100')
    expect(firstUrl.searchParams.has('after')).toBe(false)
    expect(secondUrl.searchParams.get('after')).toBe('owner-page-2')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('hydrates a selected owner directly by id', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: '777', firstName: 'Katherine', lastName: 'Johnson' }), {
        status: 200,
      })
    )

    await expect(
      hubspotSelectorAttachments['hubspot.owners'].execute(
        args({ kind: 'detail', id: '000777' }, 'hubspot.owners')
      )
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: '000777', label: 'Katherine Johnson' },
    })
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe('https://api.hubapi.com/crm/v3/owners/000777')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
