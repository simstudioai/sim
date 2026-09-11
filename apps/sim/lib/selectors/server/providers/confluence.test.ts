/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveCredentialBundle, mockResolveCloudId } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolveCredentialBundle: vi.fn(),
  mockResolveCloudId: vi.fn(),
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mockResolveCredentialBundle,
}))

vi.mock('@/lib/selectors/server/providers/atlassian', () => ({
  resolveSelectorAtlassianCloudId: mockResolveCloudId,
}))

import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { confluenceSelectorAttachments } from '@/lib/selectors/server/providers/confluence'
import * as providerHttp from '@/lib/selectors/server/providers/provider-http'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function pageDetailArgs(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'confluence.pages',
    context: { oauthCredential: 'credential-1', domain: 'acme.atlassian.net' },
    request: { kind: 'detail', id: 'page-1' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    credential: { suppliedId: 'credential-1' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

function spaceDetailArgs(signal?: AbortSignal): ExecuteServerSelectorArgs {
  return {
    ...pageDetailArgs(),
    selectorKey: 'confluence.spaces',
    request: { kind: 'detail', id: 'ENG' },
    signal,
  }
}

function spaceIdDetailArgs(): ExecuteServerSelectorArgs {
  return {
    ...pageDetailArgs(),
    selectorKey: 'confluence.spacesById',
    request: { kind: 'detail', id: '12345' },
  }
}

describe('Confluence server selector adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveCredentialBundle.mockResolvedValue({ accessToken: 'server-only-token' })
    mockResolveCloudId.mockResolvedValue('cloud-1')
  })

  afterAll(() => vi.unstubAllGlobals())

  it('hydrates page details through the bounded provider reader without requesting page bodies', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'page-1', title: 'Architecture' }), { status: 200 })
    )

    await expect(
      confluenceSelectorAttachments['confluence.pages'].execute(pageDetailArgs())
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: 'page-1', label: 'Architecture' },
    })

    const requestedUrl = String(mockFetch.mock.calls[0]?.[0])
    expect(requestedUrl).toBe(
      'https://api.atlassian.com/ex/confluence/cloud-1/wiki/api/v2/pages/page-1'
    )
    expect(requestedUrl).not.toContain('body-format')
    expect(mockResolveCredentialBundle).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['read:page:confluence'] })
    )
  })

  it('rejects an oversized page detail response before parsing it', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(16 * 1024 * 1024 + 1) },
      })
    )

    await expect(
      confluenceSelectorAttachments['confluence.pages'].execute(pageDetailArgs())
    ).rejects.toBeInstanceOf(SelectorOptionsUnavailableError)
  })

  it('preserves caller cancellation while hydrating space details', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    controller.abort(abortError)
    mockFetch.mockRejectedValue(abortError)

    await expect(
      confluenceSelectorAttachments['confluence.spaces'].execute(spaceDetailArgs(controller.signal))
    ).rejects.toBe(abortError)
  })

  it('hydrates block space selections by provider resource ID', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: '12345', key: 'ENG', name: 'Engineering' }), {
        status: 200,
      })
    )

    await expect(
      confluenceSelectorAttachments['confluence.spacesById'].execute(spaceIdDetailArgs())
    ).resolves.toEqual({
      kind: 'detail',
      item: { id: '12345', label: 'Engineering (ENG)' },
    })
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/wiki/api/v2/spaces/12345')
    expect(mockResolveCredentialBundle).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['read:space:confluence'] })
    )
  })

  it.each(['current', 'archived'] as const)(
    'looks up a numeric %s space key as a key rather than a resource ID',
    async (status) => {
      mockFetch.mockImplementation((input: URL) => {
        const matches = new URL(input).searchParams.get('status') === status
        return new Response(
          JSON.stringify({
            results: matches ? [{ id: '99999', key: '12345', name: 'Numeric key' }] : [],
          }),
          { status: 200 }
        )
      })

      await expect(
        confluenceSelectorAttachments['confluence.spaces'].execute({
          ...spaceDetailArgs(),
          request: { kind: 'detail', id: '12345' },
        })
      ).resolves.toEqual({
        kind: 'detail',
        item: {
          id: '12345',
          label: status === 'archived' ? 'Numeric key (12345) — archived' : 'Numeric key (12345)',
        },
      })
      expect(mockFetch).toHaveBeenCalledTimes(2)
      for (const [input] of mockFetch.mock.calls) {
        const url = new URL(String(input))
        expect(url.pathname).toBe('/ex/confluence/cloud-1/wiki/api/v2/spaces')
        expect(url.searchParams.get('keys')).toBe('12345')
      }
    }
  )

  it('does not accept a numeric resource ID as a matching space key', async () => {
    mockFetch.mockImplementation(
      () =>
        new Response(
          JSON.stringify({ results: [{ id: '12345', key: 'ENG', name: 'Engineering' }] }),
          { status: 200 }
        )
    )
    await expect(
      confluenceSelectorAttachments['confluence.spaces'].execute({
        ...spaceDetailArgs(),
        request: { kind: 'detail', id: '12345' },
      })
    ).resolves.toEqual({ kind: 'detail', item: null })
  })

  it('preserves key aliases when hydrating the ID selector', async () => {
    mockFetch.mockImplementation(
      () =>
        new Response(
          JSON.stringify({ results: [{ id: '12345', key: 'ENG', name: 'Engineering' }] }),
          { status: 200 }
        )
    )
    await expect(
      confluenceSelectorAttachments['confluence.spacesById'].execute({
        ...spaceIdDetailArgs(),
        request: { kind: 'detail', id: 'ENG' },
      })
    ).resolves.toEqual({ kind: 'detail', item: { id: 'ENG', label: 'Engineering (ENG)' } })
  })

  it('projects provider IDs for block space lists while key selectors remain unchanged', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ id: '12345', key: 'ENG', name: 'Engineering' }],
            _links: { next: '/wiki/api/v2/spaces?cursor=next-page' },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ id: '12345', key: 'ENG', name: 'Engineering' }],
            _links: { next: '/wiki/api/v2/spaces?cursor=next-page' },
          }),
          { status: 200 }
        )
      )

    const args = { ...spaceDetailArgs(), request: { kind: 'list' } as const }
    await expect(
      confluenceSelectorAttachments['confluence.spacesById'].execute({
        ...args,
        selectorKey: 'confluence.spacesById',
      })
    ).resolves.toMatchObject({ items: [{ id: '12345', label: 'Engineering (ENG)' }] })
    await expect(
      confluenceSelectorAttachments['confluence.spaces'].execute(args)
    ).resolves.toMatchObject({ items: [{ id: 'ENG', label: 'Engineering (ENG)' }] })
  })

  it.each(['confluence.spaces', 'confluence.spacesById'] as const)(
    '%s finishes a short list without advertising an empty archived page',
    async (selectorKey) => {
      mockFetch
        .mockResolvedValueOnce(
          Response.json({
            results: [{ id: '12345', key: 'ENG', name: 'Engineering' }],
          })
        )
        .mockResolvedValueOnce(Response.json({ results: [] }))
      const controller = new AbortController()

      await expect(
        confluenceSelectorAttachments[selectorKey].execute({
          ...spaceDetailArgs(controller.signal),
          selectorKey,
          request: { kind: 'list' },
        })
      ).resolves.toEqual({
        kind: 'list',
        items: [
          { id: selectorKey === 'confluence.spaces' ? 'ENG' : '12345', label: 'Engineering (ENG)' },
        ],
      })
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(
        mockFetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('status'))
      ).toEqual(['current', 'archived'])
      for (const [url, init] of mockFetch.mock.calls) {
        expect(new URL(String(url)).searchParams.get('limit')).toBe('250')
        expect(init.signal.aborted).toBe(false)
      }
      controller.abort()
      for (const [, init] of mockFetch.mock.calls) expect(init.signal.aborted).toBe(true)
    }
  )

  it('continues current spaces before fetching and paginating archived spaces', async () => {
    mockFetch
      .mockResolvedValueOnce(
        Response.json({
          results: [{ id: '1', key: 'ENG', name: 'Engineering' }],
          _links: { next: '/wiki/api/v2/spaces?cursor=current-next' },
        })
      )
      .mockResolvedValueOnce(
        Response.json({ results: [{ id: '2', key: 'OPS', name: 'Operations' }] })
      )
      .mockResolvedValueOnce(
        Response.json({
          results: [{ id: '3', key: 'OLD', name: 'Old team' }],
          _links: { next: '/wiki/api/v2/spaces?cursor=archived-next' },
        })
      )
      .mockResolvedValueOnce(
        Response.json({ results: [{ id: '4', key: 'LEGACY', name: 'Legacy' }] })
      )
    const args = spaceDetailArgs()
    const execute = confluenceSelectorAttachments['confluence.spaces'].execute

    await expect(execute({ ...args, request: { kind: 'list' } })).resolves.toMatchObject({
      nextCursor: 'current:current-next',
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    await expect(
      execute({ ...args, request: { kind: 'list', cursor: 'current:current-next' } })
    ).resolves.toEqual({
      kind: 'list',
      items: [
        { id: 'OPS', label: 'Operations (OPS)' },
        { id: 'OLD', label: 'Old team (OLD) — archived' },
      ],
      nextCursor: 'archived:archived-next',
    })
    expect(mockFetch).toHaveBeenCalledTimes(3)
    await expect(
      execute({ ...args, request: { kind: 'list', cursor: 'archived:archived-next' } })
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'LEGACY', label: 'Legacy (LEGACY) — archived' }],
    })
    expect(
      mockFetch.mock.calls.map(([url]) => {
        const params = new URL(String(url)).searchParams
        return [params.get('status'), params.get('cursor')]
      })
    ).toEqual([
      ['current', null],
      ['current', 'current-next'],
      ['archived', null],
      ['archived', 'archived-next'],
    ])
  })

  it('includes archived spaces when there are no current spaces', async () => {
    mockFetch
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(
        Response.json({ results: [{ id: '1', key: 'OLD', name: 'Old team' }] })
      )
    await expect(
      confluenceSelectorAttachments['confluence.spaces'].execute({
        ...spaceDetailArgs(),
        request: { kind: 'list' },
      })
    ).resolves.toEqual({ kind: 'list', items: [{ id: 'OLD', label: 'Old team (OLD) — archived' }] })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('preserves an archived-page failure rather than silently claiming the list is complete', async () => {
    mockFetch
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(
      confluenceSelectorAttachments['confluence.spaces'].execute({
        ...spaceDetailArgs(),
        request: { kind: 'list' },
      })
    ).rejects.toMatchObject({ name: 'SelectorConnectionUnavailableError', status: 403 })
  })

  it.each([
    { failedStatus: 'current', status: 401 },
    { failedStatus: 'current', status: 403 },
    { failedStatus: 'current', status: 429 },
    { failedStatus: 'archived', status: 401 },
    { failedStatus: 'archived', status: 403 },
    { failedStatus: 'archived', status: 429 },
  ])(
    'preserves $status from the $failedStatus lookup when the other status has no matching space',
    async ({ failedStatus, status }) => {
      mockFetch.mockImplementation((input: URL) =>
        new URL(input).searchParams.get('status') === failedStatus
          ? new Response(null, { status })
          : Response.json({ results: [{ id: '99999', key: 'OTHER', name: 'Other space' }] })
      )

      await expect(
        confluenceSelectorAttachments['confluence.spaces'].execute(spaceDetailArgs())
      ).rejects.toMatchObject({
        name:
          status === 429 ? 'SelectorOptionsUnavailableError' : 'SelectorConnectionUnavailableError',
        status,
      })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    }
  )

  it.each(['current', 'archived'] as const)(
    'returns an exact %s match even when the other status lookup fails',
    async (matchingStatus) => {
      mockFetch.mockImplementation((input: URL) =>
        new URL(input).searchParams.get('status') === matchingStatus
          ? Response.json({ results: [{ id: '12345', key: 'ENG', name: 'Engineering' }] })
          : new Response(null, { status: 429 })
      )

      await expect(
        confluenceSelectorAttachments['confluence.spaces'].execute(spaceDetailArgs())
      ).resolves.toEqual({
        kind: 'detail',
        item: {
          id: 'ENG',
          label:
            matchingStatus === 'archived' ? 'Engineering (ENG) — archived' : 'Engineering (ENG)',
        },
      })
    }
  )

  it('reports a space key missing only when both status lookups succeed without a match', async () => {
    mockFetch
      .mockResolvedValueOnce(
        Response.json({ results: [{ id: '99999', key: 'OTHER', name: 'Other space' }] })
      )
      .mockResolvedValueOnce(Response.json({ results: [] }))

    await expect(
      confluenceSelectorAttachments['confluence.spaces'].execute(spaceDetailArgs())
    ).resolves.toEqual({ kind: 'detail', item: null })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('sanitizes an arbitrary partial lookup failure rather than reporting the key missing', async () => {
    const fetchProviderJson = vi
      .spyOn(providerHttp, 'fetchProviderJson')
      .mockRejectedValueOnce(new Error('raw provider failure'))
      .mockResolvedValueOnce({ results: [] })

    try {
      await expect(
        confluenceSelectorAttachments['confluence.spaces'].execute(spaceDetailArgs())
      ).rejects.toMatchObject({
        name: 'SelectorOptionsUnavailableError',
        message: 'Options unavailable',
        status: 502,
      })
    } finally {
      fetchProviderJson.mockRestore()
    }
  })

  it('preserves the first safe provider failure when both space detail requests fail', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))

    const result = confluenceSelectorAttachments['confluence.spaces'].execute(spaceDetailArgs())
    await expect(result).rejects.toBeInstanceOf(SelectorConnectionUnavailableError)
    await expect(result).rejects.toMatchObject({ status: 401 })
  })

  it('skips an arbitrary failure and preserves the next typed space-detail failure', async () => {
    const fetchProviderJson = vi
      .spyOn(providerHttp, 'fetchProviderJson')
      .mockRejectedValueOnce(new Error('raw provider failure'))
      .mockRejectedValueOnce(new SelectorConnectionUnavailableError(403))

    const result = confluenceSelectorAttachments['confluence.spaces'].execute(spaceDetailArgs())
    await expect(result).rejects.toMatchObject({
      name: 'SelectorConnectionUnavailableError',
      status: 403,
    })

    fetchProviderJson.mockRestore()
  })
})
