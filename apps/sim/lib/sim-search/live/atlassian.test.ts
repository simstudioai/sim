import { describe, expect, it, vi } from 'vitest'
import { previewConfluence, readAtlassian, searchAtlassian } from '@/lib/sim-search/live/atlassian'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import type { NativeClient } from '@/lib/sim-search/live/types'

const SITE = { id: 'cloud', url: 'https://acme.atlassian.net' }

/** Answers only the paths a test names, so a read through the v1 content API fails loudly. */
function client(rows: Record<string, unknown>): NativeClient & { json: ReturnType<typeof vi.fn> } {
  return {
    json: vi.fn(async (path: string) => {
      if (path === '/oauth/token/accessible-resources') return [SITE]
      if (!(path in rows)) throw new Error(`Unexpected request: ${path}`)
      return rows[path]
    }),
    text: vi.fn(),
    bytes: vi.fn(),
  }
}

const v2 = '/ex/confluence/cloud/wiki/api/v2'

describe('Confluence live documents', () => {
  it('reads pages and blog posts through v2, which needs only the granular read scopes', async () => {
    const api = client({
      [`${v2}/pages/123`]: {
        id: '123',
        title: 'Runbook',
        body: { view: { value: '<p>Restart the <b>ingest</b> worker.</p>' } },
        version: { createdAt: '2026-09-18T04:50:29.778Z' },
        _links: { webui: '/spaces/ENG/pages/123/Runbook' },
      },
      [`${v2}/blogposts/9`]: {
        id: '9',
        title: 'Release notes',
        body: { view: { value: '<p>Shipped search.</p>' } },
        version: { createdAt: '2026-09-20T00:00:00.000Z' },
        _links: { webui: '/spaces/ENG/blog/9' },
      },
    })
    await expect(readAtlassian(api, 'confluence', '123', 'cloud', 'page')).resolves.toMatchObject({
      id: '123',
      kind: 'page',
      title: 'Runbook',
      content: expect.stringContaining('Restart the ingest worker.'),
      url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Runbook',
      modifiedAt: '2026-09-18T04:50:29.778Z',
    })
    await expect(readAtlassian(api, 'confluence', '9', 'cloud', 'blogpost')).resolves.toMatchObject(
      {
        kind: 'blogpost',
        content: expect.stringContaining('Shipped search.'),
      }
    )
  })

  it('reads a legacy reference without a kind as a blog post when no page has that id', async () => {
    const api: NativeClient = {
      json: vi.fn(async (path: string) => {
        if (path === '/oauth/token/accessible-resources') return [SITE]
        if (path === `${v2}/blogposts/9`)
          return { id: '9', title: 'Release notes', body: { view: { value: '<p>Shipped.</p>' } } }
        throw new NativeSearchError('unavailable', 'Provider request failed (404).', undefined, 404)
      }),
      text: vi.fn(),
      bytes: vi.fn(),
    }
    await expect(readAtlassian(api, 'confluence', '9', 'cloud')).resolves.toMatchObject({
      kind: 'blogpost',
      content: expect.stringContaining('Shipped.'),
    })
  })

  it('keeps a legacy reference page failure that is not a missing page', async () => {
    const failure = new NativeSearchError(
      'unavailable',
      'Provider request failed (500).',
      undefined,
      500
    )
    const api: NativeClient = {
      json: vi.fn(async (path: string) => {
        if (path === '/oauth/token/accessible-resources') return [SITE]
        if (path === `${v2}/pages/9`) throw failure
        throw new Error(`Unexpected request: ${path}`)
      }),
      text: vi.fn(),
      bytes: vi.fn(),
    }
    await expect(readAtlassian(api, 'confluence', '9', 'cloud')).rejects.toBe(failure)
  })

  it('reads a space result as its homepage, keeping the space as the document', async () => {
    const api = client({
      [`${v2}/spaces`]: {
        results: [{ id: '7', key: 'ENG', name: 'Engineering', homepageId: '55' }],
      },
      [`${v2}/pages/55`]: {
        id: '55',
        title: 'Engineering Home',
        body: { view: { value: '<p>Team charter.</p>' } },
        _links: { webui: '/spaces/ENG/overview' },
      },
    })
    await expect(readAtlassian(api, 'confluence', 'ENG', 'cloud', 'space')).resolves.toMatchObject({
      id: 'ENG',
      kind: 'space',
      title: 'Engineering',
      content: expect.stringContaining('Team charter.'),
    })
  })

  it('records whether a search result is a page, blog post, or space so its read picks the endpoint', async () => {
    const api = client({
      '/ex/confluence/cloud/wiki/rest/api/search': {
        results: [
          {
            content: {
              id: '123',
              type: 'page',
              space: { key: 'ENG' },
              title: 'Runbook',
              _links: { webui: '/spaces/ENG/pages/123' },
            },
          },
          {
            content: {
              id: '9',
              type: 'blogpost',
              title: 'Release notes',
              _links: { webui: '/spaces/ENG/blog/9' },
            },
          },
          {
            entityType: 'space',
            title: 'Engineering',
            url: '/spaces/ENG',
            space: { key: 'ENG', name: 'Engineering' },
          },
        ],
        _links: {},
      },
    })
    const page = await searchAtlassian(api, 'confluence', {
      query: 'runbook',
      limit: 10,
      scopes: [],
    })
    expect(page.documents.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: '123', kind: 'page' },
      { id: '9', kind: 'blogpost' },
      { id: 'ENG', kind: 'space' },
    ])
    expect(page.documents[2]?.url).toBe('https://acme.atlassian.net/wiki/spaces/ENG')
    expect(page.documents[0]?.accessMetadata).toEqual({ spaceKey: 'ENG' })
    expect(page.documents[2]?.accessMetadata).toEqual({ spaceKey: 'ENG' })
  })

  it('drops native CQL matches that the page and blog post reads cannot open', async () => {
    const api = client({
      '/ex/confluence/cloud/wiki/rest/api/search': {
        results: [
          { content: { id: '123', type: 'page', title: 'Runbook' } },
          { content: { id: '77', type: 'attachment', title: 'diagram.png' } },
          { content: { id: '78', type: 'comment', title: 'Re: Runbook' } },
          { content: { id: '79', type: 'whiteboard', title: 'Planning' } },
          { content: { id: '80', type: 'folder', title: 'Archive' } },
        ],
        _links: {},
      },
    })
    const page = await searchAtlassian(api, 'confluence', {
      query: '',
      native: { provider: 'confluence', query: 'title ~ "runbook"' },
      limit: 10,
      scopes: [],
    })
    expect(page.documents.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: '123', kind: 'page' },
    ])
    expect(page.message).toContain('cannot be read')
    expect(page.partial).toBe(true)
  })

  it('keeps the search excerpt when a previewed page body has no text', async () => {
    const page = (value: string) =>
      client({ [`${v2}/pages/7`]: { id: '7', title: 'Diagram', body: { view: { value } } } })
    const document = {
      id: '7',
      kind: 'page',
      container: 'cloud',
      title: 'Diagram',
      url: '',
      content: '',
    }
    expect(await previewConfluence(page('<img src="x.png">'), document)).toBeUndefined()
    expect(await previewConfluence(page('<p>Rollout steps</p>'), document)).toBe('Rollout steps')
  })
})

describe('Jira any-term search', () => {
  const issues = {
    '/ex/jira/cloud/rest/api/3/search/jql': {
      issues: [
        { key: 'ENG-1', fields: { summary: 'Token creator role request' } },
        { key: 'ENG-2', fields: { summary: 'Role request form' } },
      ],
    },
  }
  const query = { query: 'glean token creator role request', limit: 25, scopes: [] }

  it('keeps only issues holding at least half the query terms', async () => {
    const page = await searchAtlassian(client(issues), 'jira', { ...query, textMatch: 'any' })
    expect(page.documents.map((document) => document.id)).toEqual(['ENG-1'])
  })

  it('counts only the summary and description, not the added status line', async () => {
    const api = client({
      '/ex/jira/cloud/rest/api/3/search/jql': {
        issues: [{ key: 'ENG-3', fields: { summary: 'Release update', status: { name: 'Open' } } }],
      },
    })
    const page = await searchAtlassian(api, 'jira', {
      query: 'release status update owner timeline',
      limit: 25,
      scopes: [],
      textMatch: 'any',
    })
    expect(page.documents).toEqual([])
  })

  it('keeps every issue an all-terms search returns', async () => {
    const page = await searchAtlassian(client(issues), 'jira', query)
    expect(page.documents.map((document) => document.id)).toEqual(['ENG-1', 'ENG-2'])
  })

  it('leaves a Confluence any-term search to its relevance ranking', async () => {
    const api = client({
      '/ex/confluence/cloud/wiki/rest/api/search': {
        results: [{ content: { id: '5', type: 'page', title: 'Role request form' } }],
        _links: {},
      },
    })
    const page = await searchAtlassian(api, 'confluence', { ...query, textMatch: 'any' })
    expect(page.documents.map((document) => document.id)).toEqual(['5'])
  })
})

describe('Confluence plain search ranking', () => {
  const search = '/ex/confluence/cloud/wiki/rest/api/search'
  /** Answers the all-terms query with `exact` and the relevance query with `ranked`, or its failure. */
  function confluence(exact: { ids: string[]; more: boolean }, ranked: string[] | (() => never)) {
    const results = (ids: string[]) =>
      ids.map((id) => ({ content: { id, type: 'page', title: id } }))
    const json = vi.fn(async (path: string, options?: { query?: Record<string, string> }) => {
      if (path === '/oauth/token/accessible-resources') return [SITE]
      if (path !== search) throw new Error(`Unexpected request: ${path}`)
      if (options?.query?.cql?.includes('siteSearch ~'))
        return { results: results(typeof ranked === 'function' ? ranked() : ranked), _links: {} }
      return {
        results: results(exact.ids),
        _links: exact.more ? { next: `${search}?cursor=page-2` } : {},
      }
    })
    return { json, text: vi.fn(), bytes: vi.fn() } satisfies NativeClient
  }
  const query = { query: 'merge train service', limit: 2, scopes: [] }
  const overflowing = { ids: ['old-1', 'old-2'], more: true }

  it('ranks an all-terms match too large for one page with relevance search', async () => {
    const api = confluence(overflowing, ['best', 'next'])
    const page = await searchAtlassian(api, 'confluence', query)
    expect(page.documents.map((document) => document.id)).toEqual(['best', 'next'])
    expect(page.hasMore).toBe(true)
    expect(page.partial).toBe(true)
    expect(page.nextCursor).toBeUndefined()
  })

  it.each([
    ['a provider refusal', new NativeSearchError('rate_limited', 'Rate limited.', 30)],
    ['a request timeout', new Error('Request timed out after 10000ms')],
  ])(
    'keeps the all-terms page and its cursor when relevance ranking fails on %s',
    async (_, failure) => {
      const api = confluence(overflowing, () => {
        throw failure
      })
      const page = await searchAtlassian(api, 'confluence', query)
      expect(page.documents.map((document) => document.id)).toEqual(['old-1', 'old-2'])
      expect(page.nextCursor).toBe('page-2')
      expect(page.partial).toBe(true)
    }
  )

  it.each([
    ['an Error', new Error('Caller stopped')],
    ['a string', 'AbortReason.UserStop'],
    ['a DOMException', new DOMException('Search cancelled', 'AbortError')],
  ])('propagates a cancellation whose reason is %s', async (_, reason) => {
    const caller = new AbortController()
    const api = confluence(overflowing, () => {
      caller.abort(reason)
      throw reason
    })
    await expect(
      searchAtlassian(api, 'confluence', { ...query, signal: caller.signal })
    ).rejects.toBe(reason)
  })

  it('keeps an all-terms match that fits on one page', async () => {
    const api = confluence({ ids: ['exact'], more: false }, ['loose'])
    const page = await searchAtlassian(api, 'confluence', query)
    expect(page.documents.map((document) => document.id)).toEqual(['exact'])
    expect(api.json).toHaveBeenCalledTimes(2)
  })

  it('keeps date order and native queries on the all-terms page', async () => {
    const dated = confluence({ ids: ['newest', 'older'], more: true }, ['best'])
    const byDate = await searchAtlassian(dated, 'confluence', {
      ...query,
      filters: { sortBy: 'newest' },
    })
    expect(byDate.documents.map((document) => document.id)).toEqual(['newest', 'older'])
    expect(byDate.nextCursor).toBe('page-2')
    const native = confluence({ ids: ['a', 'b'], more: true }, ['best'])
    const own = await searchAtlassian(native, 'confluence', {
      ...query,
      native: { provider: 'confluence', query: 'text ~ "merge train"' },
    })
    expect(own.documents.map((document) => document.id)).toEqual(['a', 'b'])
    expect(own.nextCursor).toBe('page-2')
  })
})
