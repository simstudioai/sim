/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveSelectorCredentialBundle } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolveSelectorCredentialBundle: vi.fn(),
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mockResolveSelectorCredentialBundle,
}))

import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { eloquaSelectorAttachments } from '@/lib/selectors/server/providers/eloqua'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function args(
  request: ExecuteServerSelectorArgs['request'],
  selectorKey: ExecuteServerSelectorArgs['selectorKey'] = 'eloqua.campaigns',
  signal?: AbortSignal
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
    signal,
  }
}

describe('Oracle Eloqua server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveSelectorCredentialBundle.mockResolvedValue({
      accessToken: 'server-only-token',
      instanceUrl: 'https://secure.p03.eloqua.com',
    })
  })

  afterAll(() => vi.unstubAllGlobals())

  it('binds the credential pod, escapes prefix search, and paginates on demand', async () => {
    mockFetch
      .mockResolvedValueOnce(
        Response.json({
          elements: [
            { id: '101', name: "O'Brien Welcome", type: 'Campaign', currentStatus: 'Draft' },
          ],
          page: 1,
          pageSize: 1,
          total: 2,
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          elements: [{ id: '102', name: 'Other Welcome', type: 'Campaign' }],
          page: 2,
          pageSize: 1,
          total: 2,
        })
      )

    const first = await eloquaSelectorAttachments['eloqua.campaigns'].execute(
      args({ kind: 'list', search: "O'Brien" })
    )
    const second = await eloquaSelectorAttachments['eloqua.campaigns'].execute(
      args({ kind: 'list', search: "O'Brien", cursor: '2' })
    )

    expect(first).toEqual({
      kind: 'list',
      items: [
        {
          id: '101',
          label: "O'Brien Welcome",
          meta: { type: 'Campaign', currentStatus: 'Draft' },
        },
      ],
      nextCursor: '2',
    })
    expect(second).toEqual({
      kind: 'list',
      items: [{ id: '102', label: 'Other Welcome', meta: { type: 'Campaign' } }],
    })
    const firstUrl = new URL(String(mockFetch.mock.calls[0]?.[0]))
    const secondUrl = new URL(String(mockFetch.mock.calls[1]?.[0]))
    expect(firstUrl.origin).toBe('https://secure.p03.eloqua.com')
    expect(firstUrl.searchParams.get('search')).toBe("name='O''Brien*'")
    expect(firstUrl.searchParams.get('count')).toBe('100')
    expect(firstUrl.searchParams.get('page')).toBe('1')
    expect(secondUrl.searchParams.get('page')).toBe('2')
    expect(mockResolveSelectorCredentialBundle).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['eloqua.campaigns', '/api/rest/2.0/assets/campaign/123'],
    ['eloqua.contactLists', '/api/rest/1.0/assets/contact/list/123'],
    ['eloqua.segments', '/api/rest/2.0/assets/contact/segment/123'],
    ['eloqua.emails', '/api/rest/2.0/assets/email/123'],
    ['eloqua.forms', '/api/rest/2.0/assets/form/123'],
  ] as const)('hydrates %s by ID', async (selectorKey, path) => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ id: '123', name: 'Selected asset', type: 'Asset' })
    )

    await expect(
      eloquaSelectorAttachments[selectorKey].execute(
        args({ kind: 'detail', id: '123' }, selectorKey)
      )
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: '123', label: 'Selected asset', meta: { type: 'Asset' } },
    })
    expect(new URL(String(mockFetch.mock.calls[0]?.[0])).pathname).toBe(path)
  })

  it('rejects a credential with an unsafe destination before fetching', async () => {
    mockResolveSelectorCredentialBundle.mockResolvedValue({
      accessToken: 'server-only-token',
      instanceUrl: 'https://evil.example',
    })

    await expect(
      eloquaSelectorAttachments['eloqua.forms'].execute(args({ kind: 'list' }, 'eloqua.forms'))
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fails closed on malformed provider responses and forwards cancellation', async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValueOnce(Response.json({ elements: 'not-an-array' }))

    await expect(
      eloquaSelectorAttachments['eloqua.emails'].execute(
        args({ kind: 'list' }, 'eloqua.emails', controller.signal)
      )
    ).rejects.toThrow()
    expect(mockFetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
