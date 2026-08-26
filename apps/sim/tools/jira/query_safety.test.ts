/**
 * @vitest-environment node
 *
 * `path_safety.test.ts` covers identifiers that land in a URL *path*. This file
 * covers the two Jira parameters that land in a *query string*, where the
 * failure mode is different: a raw `&` does not pop a path segment, it appends
 * an attacker-chosen parameter to a request that still carries the caller's
 * OAuth token.
 *
 * Both tools build the same URL twice — once in `request.url` and once in a
 * `transformResponse` rebuild for the domain-discovery branch — so every
 * assertion here is run against both, and the two must agree byte for byte.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jiraGetCommentsTool } from '@/tools/jira/get_comments'
import { jiraRemoveWatcherTool } from '@/tools/jira/remove_watcher'

const { mockResolveAtlassianCloudId } = vi.hoisted(() => ({
  mockResolveAtlassianCloudId: vi.fn(),
}))

vi.mock('@/lib/atlassian/discovery', () => ({
  resolveAtlassianCloudId: mockResolveAtlassianCloudId,
  selectAtlassianCloudId: () => CLOUD_ID,
}))

const CLOUD_ID = '1324a887-45db-1bf4-1e99-ef0ff456d421'
const ISSUE_BASE = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3/issue/PROJ-123`

let fetchMock: ReturnType<typeof vi.fn>

function fetchedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveAtlassianCloudId.mockResolvedValue(CLOUD_ID)
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ comments: [], total: 0, startAt: 0, maxResults: 50 }),
  })
  vi.stubGlobal('fetch', fetchMock)
})

describe('jira_get_comments orderBy', () => {
  function params(overrides: Record<string, unknown> = {}) {
    return {
      accessToken: 'inert-token',
      domain: 'example.atlassian.net',
      issueKey: 'PROJ-123',
      cloudId: CLOUD_ID,
      ...overrides,
    } as any
  }

  const buildRequestUrl = (overrides: Record<string, unknown> = {}) =>
    (jiraGetCommentsTool.request.url as (p: any) => string)(params(overrides))

  /** Drives the domain-discovery branch, which rebuilds the URL by hand. */
  async function rebuiltUrl(overrides: Record<string, unknown> = {}): Promise<string> {
    await jiraGetCommentsTool.transformResponse!(
      { ok: true, status: 200, json: async () => ({}) } as Response,
      params({ ...overrides, cloudId: undefined })
    )
    const urls = fetchedUrls()
    expect(urls).toHaveLength(1)
    return urls[0]
  }

  it.each([
    [undefined, '-created'],
    ['created', 'created'],
    ['-created', '-created'],
    ['+created', '+created'],
  ])('passes orderBy=%j through byte-identically', async (orderBy, expected) => {
    const expectedUrl = `${ISSUE_BASE}/comment?startAt=0&maxResults=50&orderBy=${expected}`

    expect(buildRequestUrl({ orderBy })).toBe(expectedUrl)
    expect(await rebuiltUrl({ orderBy })).toBe(expectedUrl)
  })

  it('emits exactly the three documented query parameters', () => {
    const url = new URL(buildRequestUrl())
    expect([...url.searchParams.keys()]).toEqual(['startAt', 'maxResults', 'orderBy'])
    expect(url.searchParams.get('orderBy')).toBe('-created')
  })

  it.each([
    '-created&maxResults=5000',
    'created&expand=renderedBody',
    '-created#',
    'updated',
  ])('rejects orderBy=%j instead of appending it to the query', (orderBy) => {
    expect(() => buildRequestUrl({ orderBy })).toThrow(/orderBy/)
  })

  /**
   * An empty orderBy previously produced a bare `orderBy=`, which is not in
   * Jira's enum either. Treating it as unset is strictly closer to the caller's
   * intent than either sending it or failing.
   */
  it.each(['', '   '])('treats orderBy=%j as unset', (orderBy) => {
    expect(buildRequestUrl({ orderBy })).toBe(
      `${ISSUE_BASE}/comment?startAt=0&maxResults=50&orderBy=-created`
    )
  })

  it('rejects a hostile orderBy on the transformResponse rebuild too', async () => {
    await expect(rebuiltUrl({ orderBy: '-created&maxResults=5000' })).rejects.toThrow(/orderBy/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('contains a non-numeric startAt instead of letting it open a new parameter', () => {
    const url = new URL(buildRequestUrl({ startAt: '0&maxResults=5000' }))

    expect([...url.searchParams.keys()]).toEqual(['startAt', 'maxResults', 'orderBy'])
    expect(url.searchParams.get('maxResults')).toBe('50')
  })

  it('contains a non-numeric maxResults the same way', () => {
    const url = new URL(buildRequestUrl({ maxResults: '50&orderBy=created' }))

    expect([...url.searchParams.keys()]).toEqual(['startAt', 'maxResults', 'orderBy'])
    expect(url.searchParams.get('orderBy')).toBe('-created')
  })

  it('keeps real numeric pagination byte-identical', () => {
    expect(buildRequestUrl({ startAt: 25, maxResults: 100 })).toBe(
      `${ISSUE_BASE}/comment?startAt=25&maxResults=100&orderBy=-created`
    )
  })
})

describe('jira_remove_watcher accountId', () => {
  function params(overrides: Record<string, unknown> = {}) {
    return {
      accessToken: 'inert-token',
      domain: 'example.atlassian.net',
      issueKey: 'PROJ-123',
      accountId: '5b10ac8d82e05b22cc7d4ef5',
      cloudId: CLOUD_ID,
      ...overrides,
    } as any
  }

  const buildRequestUrl = (overrides: Record<string, unknown> = {}) =>
    (jiraRemoveWatcherTool.request.url as (p: any) => string)(params(overrides))

  it('passes a real accountId through unchanged', () => {
    expect(buildRequestUrl()).toBe(`${ISSUE_BASE}/watchers?accountId=5b10ac8d82e05b22cc7d4ef5`)
  })

  it.each([undefined, null, '', '   '])(
    'fails by name when accountId=%j rather than sending an empty one',
    (accountId) => {
      expect(() => buildRequestUrl({ accountId })).toThrow(/accountId is required/)
    }
  )

  it('fails by name on the transformResponse rebuild too', async () => {
    await expect(
      jiraRemoveWatcherTool.transformResponse!(
        { ok: true, status: 200, json: async () => ({}) } as Response,
        params({ accountId: '', cloudId: undefined })
      )
    ).rejects.toThrow(/accountId is required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rebuilds the identical URL on the discovery branch', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) })

    await jiraRemoveWatcherTool.transformResponse!(
      { ok: true, status: 200, json: async () => ({}) } as Response,
      params({ cloudId: undefined })
    )

    expect(fetchedUrls()).toEqual([
      `${ISSUE_BASE}/watchers?accountId=5b10ac8d82e05b22cc7d4ef5`,
    ])
  })
})
