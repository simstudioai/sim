import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildStatusCategoryParams, incidentioConnector } from '@/connectors/incidentio/incidentio'

/** Every status category incident.io documents for a still-current incident. */
const CURRENT_STATUS_CATEGORIES = ['triage', 'live', 'paused', 'learning', 'closed'] as const

/**
 * Triage outcomes that are NOT deletions: the incident still exists and stays
 * readable, and a declined incident can be moved back to triage.
 */
const NON_DELETION_TRIAGE_CATEGORIES = ['declined', 'merged'] as const

const ACCESS_TOKEN = 'test-token'

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Resolves the URL of the nth (0-indexed) fetch the connector performed. */
function _requestUrl(callIndex = 0): URL {
  const call = mockFetch.mock.calls[callIndex]
  if (!call) throw new Error(`No fetch call at index ${callIndex}`)
  return new URL(String(call[0]))
}

function incidentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    reference: 'INC-1',
    name: 'Checkout is down',
    summary: 'Payments failing',
    permalink: 'https://app.incident.io/incidents/1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    incident_status: { name: 'Closed', category: 'closed' },
    ...overrides,
  }
}

describe('buildStatusCategoryParams', () => {
  it('excludes only canceled when no category is selected', () => {
    expect(buildStatusCategoryParams('')).toEqual([['status_category[not_in]', 'canceled']])
  })

  it('never excludes a still-current category', () => {
    const excluded = buildStatusCategoryParams('').map(([, value]) => value)
    for (const category of CURRENT_STATUS_CATEGORIES) {
      expect(excluded).not.toContain(category)
    }
  })

  it('never excludes declined or merged, which are not deletions', () => {
    const excluded = buildStatusCategoryParams('').map(([, value]) => value)
    for (const category of NON_DELETION_TRIAGE_CATEGORIES) {
      expect(excluded).not.toContain(category)
    }
  })
})

describe('incidentioConnector.listDocuments', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not client-side filter the listing, so no still-listed incident is dropped', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        incidents: [
          incidentFixture({
            id: 'inc-1',
            incident_status: { name: 'Declined', category: 'declined' },
          }),
          incidentFixture({ id: 'inc-2', incident_status: { name: 'Merged', category: 'merged' } }),
          incidentFixture({
            id: 'inc-3',
            incident_status: { name: 'Canceled', category: 'canceled' },
          }),
        ],
      })
    )

    const result = await incidentioConnector.listDocuments(ACCESS_TOKEN, {})

    expect(result.documents.map((doc) => doc.externalId)).toEqual(['inc-1', 'inc-2', 'inc-3'])
  })

  it('derives the next cursor from pagination_meta, not from the document count', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        incidents: [incidentFixture({ id: 'inc-1' }), incidentFixture({ id: 'inc-2' })],
        pagination_meta: { after: 'cursor-2', page_size: 100 },
      })
    )

    const result = await incidentioConnector.listDocuments(ACCESS_TOKEN, {})

    expect(result.nextCursor).toBe('cursor-2')
    expect(result.hasMore).toBe(true)
  })

  it('stops paginating once the max-incident cap is reached', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        incidents: [incidentFixture({ id: 'inc-1' }), incidentFixture({ id: 'inc-2' })],
        pagination_meta: { after: 'cursor-2' },
      })
    )

    const syncContext: Record<string, unknown> = {}
    const result = await incidentioConnector.listDocuments(
      ACCESS_TOKEN,
      { maxIncidents: '1' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(1)
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
    expect(syncContext.listingCapped).toBe(true)
  })

  it('stops paginating when a page returns no incidents but still echoes a cursor', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ incidents: [], pagination_meta: { after: 'cursor-9' } })
    )

    const result = await incidentioConnector.listDocuments(ACCESS_TOKEN, {})

    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
  })

  it('throws instead of reporting an empty listing when the API fails', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'nope' }, 500))

    await expect(incidentioConnector.listDocuments(ACCESS_TOKEN, {})).rejects.toThrow(
      'Failed to list incident.io incidents: 500'
    )
  })
})

describe('incidentioConnector.getDocument', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks the hash partial when updates could not be fetched, so the next sync retries', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ incident: incidentFixture() }))
      .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 500))

    const partial = await incidentioConnector.getDocument(ACCESS_TOKEN, {}, 'inc-1')

    vi.clearAllMocks()
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ incident: incidentFixture() }))
      .mockResolvedValueOnce(jsonResponse({ incident_updates: [] }))

    const complete = await incidentioConnector.getDocument(ACCESS_TOKEN, {}, 'inc-1')

    vi.clearAllMocks()
    mockFetch.mockResolvedValue(jsonResponse({ incidents: [incidentFixture()] }))
    const listed = await incidentioConnector.listDocuments(ACCESS_TOKEN, {})
    const stubHash = listed.documents[0].contentHash

    expect(complete?.contentHash).toBe(stubHash)
    expect(partial?.contentHash).not.toBe(stubHash)
  })

  it('throws when the API fails so the sync engine records a failed row', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'nope' }, 500))

    await expect(incidentioConnector.getDocument(ACCESS_TOKEN, {}, 'inc-1')).rejects.toThrow('500')
  })
})
