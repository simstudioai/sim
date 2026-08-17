/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => ({
  secureFetchWithRetry: mockFetch,
}))

import { sentryConnector } from '@/connectors/sentry/sentry'

const ACCESS_TOKEN = 'test-token'

const BASE_CONFIG = {
  organization: 'acme',
  project: 'web',
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function issueFixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    shortId: `WEB-${id}`,
    title: `Boom ${id}`,
    permalink: `https://sentry.io/organizations/acme/issues/${id}/`,
    level: 'error',
    status: 'unresolved',
    count: '12',
    userCount: 3,
    firstSeen: '2024-01-01T00:00:00.000Z',
    lastSeen: '2024-02-01T00:00:00.000Z',
    ...overrides,
  }
}

/** A `Link` header advertising another page, exactly as Sentry emits it. */
const NEXT_PAGE_LINK = {
  Link: '<https://sentry.io/api/0/organizations/acme/issues/?cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"',
}

function requestUrl(callIndex = 0): URL {
  const call = mockFetch.mock.calls[callIndex]
  if (!call) throw new Error(`No fetch call at index ${callIndex}`)
  return new URL(String(call[0]))
}

beforeEach(() => {
  mockFetch.mockReset()
})

/**
 * `listingCapped` must track whether this listing pass actually withheld issues
 * it could otherwise have returned — not how the connector happens to be
 * configured. The listing's date range is pinned to the widest range Sentry's
 * issue search can serve, so it never withholds anything and never contributes
 * to the flag; only `maxIssues` does.
 */
describe('sentryConnector.listDocuments listing completeness', () => {
  it('does not flag listingCapped when the listing exhausts the source', async () => {
    mockFetch.mockResolvedValue(jsonResponse([issueFixture('1'), issueFixture('2')]))
    const syncContext: Record<string, unknown> = {}

    const result = await sentryConnector.listDocuments(
      ACCESS_TOKEN,
      { ...BASE_CONFIG },
      undefined,
      syncContext
    )

    expect(result.hasMore).toBe(false)
    expect(result.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('does not flag listingCapped when the source is legitimately empty', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))
    const syncContext: Record<string, unknown> = {}

    await sentryConnector.listDocuments(ACCESS_TOKEN, { ...BASE_CONFIG }, undefined, syncContext)

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('does not flag listingCapped when maxIssues lands exactly on exhaustion', async () => {
    mockFetch.mockResolvedValue(jsonResponse([issueFixture('1'), issueFixture('2')]))
    const syncContext: Record<string, unknown> = {}

    await sentryConnector.listDocuments(
      ACCESS_TOKEN,
      { ...BASE_CONFIG, maxIssues: '2' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('flags listingCapped when maxIssues stops short of a source that has more pages', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([issueFixture('1'), issueFixture('2')], 200, NEXT_PAGE_LINK)
    )
    const syncContext: Record<string, unknown> = {}

    const result = await sentryConnector.listDocuments(
      ACCESS_TOKEN,
      { ...BASE_CONFIG, maxIssues: '2' },
      undefined,
      syncContext
    )

    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('flags listingCapped when maxIssues drops issues from the page it received', async () => {
    mockFetch.mockResolvedValue(jsonResponse([issueFixture('1'), issueFixture('2')]))
    const syncContext: Record<string, unknown> = {}

    const result = await sentryConnector.listDocuments(
      ACCESS_TOKEN,
      { ...BASE_CONFIG, maxIssues: '1' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(1)
    expect(syncContext.listingCapped).toBe(true)
  })
})

describe('sentryConnector.listDocuments request shape', () => {
  it('lists through the org-scoped issues endpoint without a date range', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))

    await sentryConnector.listDocuments(ACCESS_TOKEN, { ...BASE_CONFIG }, undefined, {})

    const url = requestUrl()
    expect(url.origin + url.pathname).toBe('https://sentry.io/api/0/organizations/acme/issues/')
    expect(url.searchParams.get('statsPeriod')).toBeNull()
  })

  it('sends the org-scoped listing params', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))

    await sentryConnector.listDocuments(
      ACCESS_TOKEN,
      { ...BASE_CONFIG, statsPeriod: '24h', environment: 'production' },
      'cursor-1',
      {}
    )

    expect(Object.fromEntries(requestUrl().searchParams)).toEqual({
      project: 'web',
      query: 'is:unresolved',
      sort: 'new',
      limit: '100',
      groupStatsPeriod: '24h',
      environment: 'production',
      cursor: 'cursor-1',
    })
  })

  it('sends the configured stats period as groupStatsPeriod, never as statsPeriod', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))

    await sentryConnector.listDocuments(
      ACCESS_TOKEN,
      { ...BASE_CONFIG, statsPeriod: '14d' },
      undefined,
      {}
    )

    const url = requestUrl()
    expect(url.searchParams.get('statsPeriod')).toBeNull()
    expect(url.searchParams.get('groupStatsPeriod')).toBe('14d')
  })

  it('ignores an unrecognized date-range key rather than transmitting it', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))

    await sentryConnector.listDocuments(
      ACCESS_TOKEN,
      { ...BASE_CONFIG, issueWindow: '9000d' },
      undefined,
      {}
    )

    const url = requestUrl()
    expect(url.searchParams.get('statsPeriod')).toBeNull()
    expect(url.searchParams.get('issueWindow')).toBeNull()
  })
})

describe('sentryConnector.validateConfig', () => {
  it('rejects a per-issue stats period Sentry does not accept', async () => {
    const result = await sentryConnector.validateConfig(ACCESS_TOKEN, {
      ...BASE_CONFIG,
      statsPeriod: '90d',
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Stats period')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('probes the same issues endpoint the sync lists through', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))

    const result = await sentryConnector.validateConfig(ACCESS_TOKEN, { ...BASE_CONFIG })

    expect(result.valid).toBe(true)
    const probeUrl = requestUrl(1)
    expect(probeUrl.origin + probeUrl.pathname).toBe(
      'https://sentry.io/api/0/organizations/acme/issues/'
    )
    expect(probeUrl.searchParams.get('statsPeriod')).toBeNull()
  })
})
