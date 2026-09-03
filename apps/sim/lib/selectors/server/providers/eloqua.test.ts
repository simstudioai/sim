/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockGetCredential, mockResolveSelectorCredentialBundle } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockGetCredential: vi.fn(),
  mockResolveSelectorCredentialBundle: vi.fn(),
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  getCredential: mockGetCredential,
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
    credential: {
      suppliedId: 'credential-1',
      providerId: 'eloqua',
      access: {
        ok: true,
        credentialOwnerUserId: 'owner-1',
        workspaceId: 'workspace-1',
        resolvedCredentialId: 'account-1',
        credentialType: 'oauth',
      },
      signal,
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    signal,
  }
}

describe('Oracle Eloqua server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockGetCredential.mockResolvedValue({
      providerId: 'eloqua',
      scope: '__eloqua_instance__:https://secure.p03.eloqua.com,full',
    })
    mockResolveSelectorCredentialBundle.mockResolvedValue({
      accessToken: 'server-only-token',
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
    expect(mockGetCredential).toHaveBeenCalledTimes(2)
    expect(mockGetCredential).toHaveBeenCalledWith('selector-execution', 'account-1', 'owner-1')
    expect(mockResolveSelectorCredentialBundle).toHaveBeenCalledTimes(2)
    expect(mockResolveSelectorCredentialBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: expect.objectContaining({ providerId: 'eloqua', suppliedId: 'account-1' }),
      })
    )
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

  it('rejects a detail response whose ID differs from the requested asset', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ id: '999', name: 'Different asset', type: 'Asset' })
    )

    await expect(
      eloquaSelectorAttachments['eloqua.forms'].execute(
        args({ kind: 'detail', id: '123' }, 'eloqua.forms')
      )
    ).rejects.toThrow('Options unavailable')
  })

  it('rejects a credential with an unsafe destination before fetching', async () => {
    mockGetCredential.mockResolvedValue({
      providerId: 'eloqua',
      scope: '__eloqua_instance__:https://evil.example,full',
    })

    await expect(
      eloquaSelectorAttachments['eloqua.forms'].execute(args({ kind: 'list' }, 'eloqua.forms'))
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mockResolveSelectorCredentialBundle).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fails closed when the stored credential scope does not contain a pod', async () => {
    mockGetCredential.mockResolvedValue({
      providerId: 'eloqua',
      scope: 'full',
    })

    await expect(
      eloquaSelectorAttachments['eloqua.forms'].execute(args({ kind: 'list' }, 'eloqua.forms'))
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mockResolveSelectorCredentialBundle).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fails closed when the stored credential provider does not match Eloqua', async () => {
    mockGetCredential.mockResolvedValue({
      providerId: 'salesforce',
      scope: '__eloqua_instance__:https://secure.p03.eloqua.com,full',
    })

    await expect(
      eloquaSelectorAttachments['eloqua.forms'].execute(args({ kind: 'list' }, 'eloqua.forms'))
    ).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    expect(mockResolveSelectorCredentialBundle).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not begin token resolution when credential loading is cancelled', async () => {
    const controller = new AbortController()
    mockGetCredential.mockReturnValue(new Promise(() => undefined))

    const pending = eloquaSelectorAttachments['eloqua.forms'].execute(
      args({ kind: 'list' }, 'eloqua.forms', controller.signal)
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockResolveSelectorCredentialBundle).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fails closed on malformed provider responses', async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ elements: 'not-an-array' }))

    await expect(
      eloquaSelectorAttachments['eloqua.emails'].execute(args({ kind: 'list' }, 'eloqua.emails'))
    ).rejects.toThrow('Options unavailable')
  })

  it('forwards caller cancellation to the provider request', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    let markFetchStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve
    })
    mockFetch.mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
      markFetchStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    })

    const pending = eloquaSelectorAttachments['eloqua.emails'].execute(
      args({ kind: 'list' }, 'eloqua.emails', controller.signal)
    )
    await fetchStarted
    controller.abort(abortError)

    await expect(pending).rejects.toBe(abortError)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
