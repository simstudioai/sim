import { describe, expect, it, vi } from 'vitest'
import { readAtlassian, searchAtlassian } from '@/lib/sim-search/live/atlassian'
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
    expect(api.json).toHaveBeenCalledWith(`${v2}/pages/123`, { query: { 'body-format': 'view' } })
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
    expect(api.json).toHaveBeenCalledWith(`${v2}/spaces`, { query: { keys: 'ENG' } })
  })

  it('records whether a search result is a page, blog post, or space so its read picks the endpoint', async () => {
    const api = client({
      '/ex/confluence/cloud/wiki/rest/api/search': {
        results: [
          {
            content: {
              id: '123',
              type: 'page',
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
  })
})
