/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockResolveCredentialBundle } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockResolveCredentialBundle: vi.fn(),
}))

vi.mock('@/lib/selectors/server/providers/credential-bundle', () => ({
  resolveSelectorCredentialBundle: mockResolveCredentialBundle,
}))

import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { SelectorContextUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { codaSelectorAttachments } from '@/lib/selectors/server/providers/coda'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import type { SelectorContext, SelectorRequest } from '@/lib/selectors/types'

function args(
  selectorKey: ServerSelectorKey,
  request: SelectorRequest,
  context: SelectorContext = {}
): ExecuteServerSelectorArgs {
  return {
    selectorKey,
    context: { oauthCredential: 'credential-1', ...context },
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('Coda server selector adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockResolveCredentialBundle.mockResolvedValue({ accessToken: 'server-only-token' })
  })

  afterAll(() => vi.unstubAllGlobals())

  it('continues a doc search with only the Coda page token and returns the next cursor', async () => {
    mockFetch.mockResolvedValueOnce(
      json({ items: [{ id: 'doc1', name: 'Roadmap', owner: 'a@b.co' }], nextPageToken: 'tok2' })
    )

    const result = await codaSelectorAttachments['coda.docs'].execute(
      args('coda.docs', { kind: 'list', search: ' road ', cursor: 'tok1' })
    )

    expect(result).toEqual({
      kind: 'list',
      items: [{ id: 'doc1', label: 'Roadmap' }],
      nextCursor: 'tok2',
    })
    const [url, init] = mockFetch.mock.calls[0]
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(url).toBe('https://coda.io/apis/v1/docs?pageToken=tok1')
    expect(init.headers).toEqual({
      Authorization: 'Bearer server-only-token',
      Accept: 'application/json',
    })
  })

  it('sends the search term and page size on the first doc page', async () => {
    mockFetch.mockResolvedValueOnce(json({ items: [] }))

    await codaSelectorAttachments['coda.docs'].execute(
      args('coda.docs', { kind: 'list', search: ' road ' })
    )

    expect(mockFetch.mock.calls[0][0]).toBe('https://coda.io/apis/v1/docs?limit=100&query=road')
  })

  it('reads every page of a doc-scoped list into one flat result', async () => {
    mockFetch
      .mockResolvedValueOnce(
        json({ items: [{ id: 'grid-1', name: 'Tasks', tableType: 'table' }], nextPageToken: 'p2' })
      )
      .mockResolvedValueOnce(json({ items: [{ id: 'table-2', name: 'Open', tableType: 'view' }] }))

    const result = await codaSelectorAttachments['coda.tables'].execute(
      args('coda.tables', { kind: 'list' }, { docId: 'AbCDeFGH' })
    )

    expect(result).toEqual({
      kind: 'list',
      items: [
        { id: 'grid-1', label: 'Tasks', meta: { tableType: 'table' } },
        { id: 'table-2', label: 'Open (view)', meta: { tableType: 'view' } },
      ],
    })
    expect(mockFetch.mock.calls[1][0]).toBe(
      'https://coda.io/apis/v1/docs/AbCDeFGH/tables?pageToken=p2'
    )
  })

  it('scopes columns and rows to the selected doc and table', async () => {
    mockFetch.mockResolvedValueOnce(
      json({ items: [{ id: 'c-1', name: 'Status', format: { type: 'select', isArray: false } }] })
    )

    await expect(
      codaSelectorAttachments['coda.columns'].execute(
        args('coda.columns', { kind: 'list' }, { docId: 'doc', tableId: 'grid 1' })
      )
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'c-1', label: 'Status', meta: { formatType: 'select' } }],
    })
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://coda.io/apis/v1/docs/doc/tables/grid%201/columns?limit=100'
    )
  })

  it('resolves a missing resource detail to no option', async () => {
    mockFetch.mockResolvedValueOnce(json({ message: 'Not Found' }, 404))

    await expect(
      codaSelectorAttachments['coda.pages'].execute(
        args('coda.pages', { kind: 'detail', id: 'canvas-gone' }, { docId: 'doc' })
      )
    ).resolves.toEqual({ kind: 'detail', item: null })
    expect(mockFetch.mock.calls[0][0]).toBe('https://coda.io/apis/v1/docs/doc/pages/canvas-gone')
  })

  it('labels permissions by principal and resolves details from the list', async () => {
    mockFetch.mockResolvedValue(
      json({
        items: [
          { id: 'perm-1', access: 'write', principal: { type: 'email', email: 'a@b.co' } },
          { id: 'perm-2', access: 'readonly', principal: { type: 'anyone' } },
        ],
      })
    )

    await expect(
      codaSelectorAttachments['coda.permissions'].execute(
        args('coda.permissions', { kind: 'detail', id: 'perm-2' }, { docId: 'doc' })
      )
    ).resolves.toEqual({
      kind: 'detail',
      item: {
        id: 'perm-2',
        label: 'Anyone with the link (readonly)',
        meta: { access: 'readonly', principalType: 'anyone' },
      },
    })
  })

  it('rejects missing or traversal context before contacting Coda', async () => {
    await expect(
      codaSelectorAttachments['coda.pages'].execute(args('coda.pages', { kind: 'list' }))
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    await expect(
      codaSelectorAttachments['coda.rows'].execute(
        args('coda.rows', { kind: 'list' }, { docId: 'doc', tableId: '..' })
      )
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    await expect(
      codaSelectorAttachments['coda.docs'].execute(
        args('coda.docs', { kind: 'list', cursor: 'bad token' })
      )
    ).rejects.toBeInstanceOf(SelectorContextUnavailableError)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
