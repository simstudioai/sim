import { jsonResponse } from '@sim/testing'
import {
  knowledgeSecureFetchMock,
  knowledgeSecureFetchMockFns,
} from '@sim/testing/mocks/knowledge-secure-fetch.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)

import { sentryConnector } from '@/connectors/sentry/sentry'

const mockFetch = knowledgeSecureFetchMockFns.mockSecureFetchWithRetry

const ACCESS_TOKEN = 'test-token'

const BASE_CONFIG = {
  organization: 'acme',
  project: 'web',
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
  it('flags listingCapped when maxIssues stops short of a source that has more pages', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([issueFixture('1'), issueFixture('2')], { headers: NEXT_PAGE_LINK })
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
