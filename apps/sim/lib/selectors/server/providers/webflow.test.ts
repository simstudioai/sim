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
import { webflowSelectorAttachments } from '@/lib/selectors/server/providers/webflow'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

const collectionId = '680000000000000000000001'

function args(request: ExecuteServerSelectorArgs['request']): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'webflow.items',
    context: { oauthCredential: 'credential-1', collectionId },
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

describe('Webflow server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('fetches one searched item page beyond the old 50-page boundary', async () => {
    const itemId = '680000000000000000001389'
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [{ id: itemId, fieldData: { name: 'Needle beyond fifty' } }],
          pagination: { limit: 100, offset: 5000, total: 5002 },
        }),
        { status: 200 }
      )
    )

    await expect(
      webflowSelectorAttachments['webflow.items'].execute(
        args({ kind: 'list', search: '  Needle  ', cursor: '5000' })
      )
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: itemId, label: 'Needle beyond fifty' }],
      nextCursor: '5001',
    })

    const url = new URL(String(mockFetch.mock.calls[0]?.[0]))
    expect(url.pathname).toBe(`/v2/collections/${collectionId}/items`)
    expect(url.searchParams.get('limit')).toBe('100')
    expect(url.searchParams.get('offset')).toBe('5000')
    expect(url.searchParams.get('filter[name][contains]')).toBe('Needle')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('hydrates saved items directly and treats a missing item as absent', async () => {
    const itemId = '680000000000000000001389'
    const missingItemId = '680000000000000000001390'
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: itemId, fieldData: { title: 'Saved item title' } }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))

    await expect(
      webflowSelectorAttachments['webflow.items'].execute(args({ kind: 'detail', id: itemId }))
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: itemId, label: 'Saved item title' },
    })
    await expect(
      webflowSelectorAttachments['webflow.items'].execute(
        args({ kind: 'detail', id: missingItemId })
      )
    ).resolves.toEqual({ kind: 'detail', item: null })

    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      `https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`
    )
    expect(String(mockFetch.mock.calls[1]?.[0])).toBe(
      `https://api.webflow.com/v2/collections/${collectionId}/items/${missingItemId}`
    )
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
