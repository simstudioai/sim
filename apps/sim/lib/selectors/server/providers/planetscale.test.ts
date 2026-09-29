import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { planetScaleSelectorAttachments } from '@/lib/selectors/server/providers/planetscale'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'

function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'planetscale.databases',
    context: {
      serviceTokenId: 'test-id',
      serviceToken: 'test-secret',
      organization: 'example',
      database: 'test-db',
      branch: 'main',
    },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace-1' },
    workspaceId: 'workspace-1',
    principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
    requesterUserId: 'user-1',
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}

function page(data: unknown[], nextPage: number | null = null): Response {
  return Response.json({
    data,
    current_page: 1,
    per_page: 100,
    next_page: nextPage,
    total_count: data.length,
    total_pages: nextPage ?? 1,
  })
}

describe('PlanetScale server selectors', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  it.each([{ serviceToken: '' }, { serviceTokenId: 'id\r\nInjected' }, { organization: '..' }])(
    'rejects invalid credential or scope input before contacting the provider: %j',
    async (context) => {
      const input = args()
      Object.assign(input.context, context)
      await expect(
        planetScaleSelectorAttachments['planetscale.databases'].execute(input)
      ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('pages using numeric cursors on the fixed origin and projects database names', async () => {
    fetchMock.mockResolvedValueOnce(
      page([{ id: 'opaque-id', name: 'test-db', serviceToken: 'must-not-leak' }], 3)
    )
    const input = args({ request: { kind: 'list', cursor: '2', search: 'test' } })
    await expect(
      planetScaleSelectorAttachments['planetscale.databases'].execute(input)
    ).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'test-db', label: 'test-db' }],
      nextCursor: '3',
    })
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(url.origin).toBe('https://api.planetscale.com')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('q')).toBe('test')
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      'test-id:test-secret'
    )
  })

  it.each(['0', '-1', '1.5', 'https://untrusted.example/page'])(
    'rejects an invalid page cursor: %s',
    async (cursor) => {
      await expect(
        planetScaleSelectorAttachments['planetscale.databases'].execute(
          args({ request: { kind: 'list', cursor } })
        )
      ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it.each([
    [
      'planetscale.branches',
      { id: 'branch-id', name: 'development' },
      { id: 'development', label: 'development' },
    ],
    [
      'planetscale.backups',
      { id: 'backup-id', name: 'Before migration' },
      { id: 'backup-id', label: 'Before migration' },
    ],
    [
      'planetscale.deployRequests',
      { id: 'deploy-id', number: 42, branch: 'dev', into_branch: 'main' },
      { id: '42', label: '#42: dev → main' },
    ],
  ] as const)('projects the endpoint identifier for %s', async (key, resource, option) => {
    fetchMock.mockResolvedValueOnce(page([resource]))
    await expect(
      planetScaleSelectorAttachments[key].execute(args({ selectorKey: key }))
    ).resolves.toEqual({ kind: 'list', items: [option] })
  })

  it('uses the deploy-request number for selected-item detail', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ id: 'opaque-id', number: 42, branch: 'dev', into_branch: 'main' })
    )
    await expect(
      planetScaleSelectorAttachments['planetscale.deployRequests'].execute(
        args({ selectorKey: 'planetscale.deployRequests', request: { kind: 'detail', id: '42' } })
      )
    ).resolves.toEqual({ kind: 'detail', item: { id: '42', label: '#42: dev → main' } })
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(
      '/v1/organizations/example/databases/test-db/deploy-requests/42'
    )
  })

  it.each([
    { data: 'invalid', next_page: null },
    { data: [{ id: 'missing-name' }], next_page: null },
    { data: [], next_page: 'https://untrusted.example' },
  ])('rejects malformed provider pages: %j', async (payload) => {
    fetchMock.mockResolvedValueOnce(Response.json(payload))
    await expect(
      planetScaleSelectorAttachments['planetscale.databases'].execute(args())
    ).rejects.toMatchObject({ name: 'SelectorOptionsUnavailableError' })
  })

  it('returns null for a deleted selection', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(
      planetScaleSelectorAttachments['planetscale.branches'].execute(
        args({ selectorKey: 'planetscale.branches', request: { kind: 'detail', id: 'deleted' } })
      )
    ).resolves.toEqual({ kind: 'detail', item: null })
  })

  it('preserves cancellation during provider work', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(async (_url, init) => {
      controller.abort()
      expect(init?.signal?.aborted).toBe(true)
      init?.signal?.throwIfAborted()
      return page([])
    })
    await expect(
      planetScaleSelectorAttachments['planetscale.databases'].execute(
        args({ signal: controller.signal })
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
