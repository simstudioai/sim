/**
 * `GET /articleVersions` returns one row per article *revision* and offers no
 * latest-version filter, so what this connector indexes is decided entirely by
 * the required status choice and the version cap. Both are exercised here, along
 * with the `listingCapped` flag the sync engine reads before hard-deleting the
 * documents a partial listing left out.
 */
import { jsonResponse } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workdayConnector } from '@/connectors/workday/workday'

const ACCESS_TOKEN = 'client-secret:refresh-token'
const CONFIG = {
  tenantUrl: 'https://wd5-impl-services1.workday.com',
  tenant: 'acme_pt1',
  clientId: 'client-id',
  status: 'Published',
}

const PUBLISHED_ID = '0d75a5e37a411000167d21b9239f0001'
const AUDIENCE_ID = '8ac3f16c1fff10000c53e90920940001'

const mockFetch = vi.fn()

function versionFixture(id: string, version = 1) {
  return {
    id,
    title: `Article ${id}`,
    content: 'Body text',
    version,
    lastUpdatedDate: '2026-01-01T00:00:00.000Z',
    parentArticle: { id: `parent-${id}`, descriptor: `Article ${id}` },
    status: { id: PUBLISHED_ID, descriptor: 'Published' },
  }
}

/**
 * Routes by URL rather than call order, because the number of lookups before the
 * listing depends on which filters the config asks for.
 */
function mockApi(listing: unknown, options: { audiences?: unknown } = {}) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ccx/oauth2/')) {
      return jsonResponse({ access_token: 'bearer', expires_in: 3600 })
    }
    if (url.includes('/articleStatuses')) {
      return jsonResponse({
        total: 3,
        data: [
          { id: PUBLISHED_ID, descriptor: 'Published' },
          { id: 'aaaa5a5e37a411000167d21b9239f002', descriptor: 'Draft' },
          { id: 'bbbb5a5e37a411000167d21b9239f003', descriptor: 'Archived' },
        ],
      })
    }
    if (url.includes('/values/common/audiences')) {
      return jsonResponse(
        options.audiences ?? {
          total: 1,
          data: [{ id: AUDIENCE_ID, descriptor: 'All Employees' }],
        }
      )
    }
    return jsonResponse(listing)
  })
}

function tokenExchanges(): string[] {
  return mockFetch.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.includes('/ccx/oauth2/'))
}

function _listingUrls(): string[] {
  return mockFetch.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.includes('/articleVersions'))
}

describe('workday listDocuments', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('refuses to list when no status was chosen, rather than indexing every revision', async () => {
    mockApi({ total: 1, data: [versionFixture('a')] })

    await expect(
      workdayConnector.listDocuments(ACCESS_TOKEN, { ...CONFIG, status: '' }, undefined, {})
    ).rejects.toThrow(/Article Status is required/)
  })

  it('flags listingCapped when the cap stops short of the tenant total', async () => {
    mockApi({ total: 10, data: [versionFixture('a')] })

    const syncContext: Record<string, unknown> = {}
    await workdayConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, maxVersions: '1' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
  })

  it('rejects a tenant host that is not a Workday domain', async () => {
    mockApi({ total: 0, data: [] })

    await expect(
      workdayConnector.listDocuments(
        ACCESS_TOKEN,
        { ...CONFIG, tenantUrl: 'https://evil.example.com' },
        undefined,
        {}
      )
    ).rejects.toThrow(/Workday-hosted domain/)
  })
})

describe('workday credential failures', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('re-authenticates once and replays the request when a cached token has expired', async () => {
    let listingCalls = 0
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/ccx/oauth2/')) {
        return jsonResponse({ access_token: 'bearer', expires_in: 3600 })
      }
      if (url.includes('/articleStatuses')) {
        return jsonResponse({ total: 1, data: [{ id: PUBLISHED_ID, descriptor: 'Published' }] })
      }
      listingCalls += 1
      return listingCalls === 1
        ? jsonResponse({ error: 'expired token' }, 401)
        : jsonResponse({ total: 1, data: [versionFixture('a')] })
    })

    const result = await workdayConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})

    expect(result.documents).toHaveLength(1)
    expect(listingCalls).toBe(2)
    expect(tokenExchanges()).toHaveLength(2)
  })

  it('surfaces a persistent 401 instead of retrying the exchange forever', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/ccx/oauth2/')) {
        return jsonResponse({ access_token: 'bearer', expires_in: 3600 })
      }
      if (url.includes('/articleStatuses')) {
        return jsonResponse({ total: 1, data: [{ id: PUBLISHED_ID, descriptor: 'Published' }] })
      }
      return jsonResponse({ error: 'still unauthorized' }, 401)
    })

    await expect(
      workdayConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})
    ).rejects.toThrow(/still unauthorized/)
    expect(tokenExchanges()).toHaveLength(2)
  })

  it('refuses a tenant that answered the status filter with another status', async () => {
    mockApi({
      total: 1,
      data: [{ ...versionFixture('a'), status: { id: 'other', descriptor: 'Draft' } }],
    })

    const result = await workdayConnector.validateConfig(ACCESS_TOKEN, CONFIG)

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/ignored the article status filter/)
  })

  it('rejects a credential that is not a clientSecret:refreshToken pair', async () => {
    mockApi({ total: 0, data: [] })

    const result = await workdayConnector.validateConfig('only-one-secret', CONFIG)

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/clientSecret:refreshToken/)
  })
})
