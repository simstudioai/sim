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
import { zoomSelectorAttachments } from '@/lib/selectors/server/providers/zoom'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function args(
  request: ExecuteServerSelectorArgs['request'] = { kind: 'list' }
): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'zoom.meetings',
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

describe('Zoom server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorOAuthAccessToken.mockResolvedValue('server-only-token')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('returns one meeting page and forwards its continuation token on demand', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ meetings: [{ id: 123, topic: 'Planning' }], next_page_token: 'page-2' }),
        { status: 200 }
      )
    )

    await expect(
      zoomSelectorAttachments['zoom.meetings'].execute(args({ kind: 'list', cursor: 'page-1' }))
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: '123', label: 'Planning' }],
      nextCursor: 'page-2',
    })
    const url = new URL(String(mockFetch.mock.calls[0]?.[0]))
    expect(url.searchParams.get('next_page_token')).toBe('page-1')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('hydrates a selected meeting without draining the list', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 123, topic: 'Planning' }), { status: 200 })
    )

    await expect(
      zoomSelectorAttachments['zoom.meetings'].execute(args({ kind: 'detail', id: '123' }))
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: '123', label: 'Planning' },
    })
    expect(String(mockFetch.mock.calls[0]?.[0]).endsWith('/v2/meetings/123')).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
