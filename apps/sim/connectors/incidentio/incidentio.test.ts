/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildStatusCategoryParams,
  DEFAULT_EXCLUDED_STATUS_CATEGORIES,
  incidentioConnector,
  SYNC_ALL_STATUS_CATEGORIES,
} from '@/connectors/incidentio/incidentio'

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
function requestUrl(callIndex = 0): URL {
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

  it('treats a whitespace-only selection as unset', () => {
    expect(buildStatusCategoryParams('   ')).toEqual([['status_category[not_in]', 'canceled']])
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

  it('emits no filter at all for the explicit sync-everything option', () => {
    expect(buildStatusCategoryParams(SYNC_ALL_STATUS_CATEGORIES)).toEqual([])
  })

  it('honours an explicit category selection verbatim', () => {
    expect(buildStatusCategoryParams('closed')).toEqual([['status_category[one_of]', 'closed']])
  })

  it('honours an explicitly selected canceled category', () => {
    expect(buildStatusCategoryParams('canceled')).toEqual([['status_category[one_of]', 'canceled']])
  })

  it('trims an explicit selection', () => {
    expect(buildStatusCategoryParams(' live ')).toEqual([['status_category[one_of]', 'live']])
  })
})

describe('incidentioConnector.listDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('appends every excluded category as a separate not_in param', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ incidents: [incidentFixture()] }))

    await incidentioConnector.listDocuments(ACCESS_TOKEN, {})

    const url = requestUrl()
    expect(url.searchParams.getAll('status_category[not_in]')).toEqual([
      ...DEFAULT_EXCLUDED_STATUS_CATEGORIES,
    ])
    expect(url.searchParams.has('status_category[one_of]')).toBe(false)
  })

  it('keeps the other listing params intact alongside the exclusion', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ incidents: [] }))

    await incidentioConnector.listDocuments(
      ACCESS_TOKEN,
      { mode: 'standard' },
      'cursor-1',
      undefined,
      new Date('2026-01-01T00:00:00.000Z')
    )

    const url = requestUrl()
    expect(url.searchParams.get('page_size')).toBe('100')
    expect(url.searchParams.get('sort_by')).toBe('created_at_oldest_first')
    expect(url.searchParams.get('after')).toBe('cursor-1')
    expect(url.searchParams.get('updated_at[gte]')).toBe('2026-01-01T00:00:00.000Z')
    expect(url.searchParams.get('mode[one_of]')).toBe('standard')
    expect(url.searchParams.getAll('status_category[not_in]')).toEqual([
      ...DEFAULT_EXCLUDED_STATUS_CATEGORIES,
    ])
  })

  it('sends no status_category filter when the user explicitly selects all', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ incidents: [] }))

    await incidentioConnector.listDocuments(ACCESS_TOKEN, {
      statusCategory: SYNC_ALL_STATUS_CATEGORIES,
    })

    const url = requestUrl()
    expect(url.searchParams.has('status_category[not_in]')).toBe(false)
    expect(url.searchParams.has('status_category[one_of]')).toBe(false)
  })

  it('sends one_of for an explicit category and drops the default exclusion', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ incidents: [] }))

    await incidentioConnector.listDocuments(ACCESS_TOKEN, { statusCategory: 'live' })

    const url = requestUrl()
    expect(url.searchParams.get('status_category[one_of]')).toBe('live')
    expect(url.searchParams.has('status_category[not_in]')).toBe(false)
  })

  it('falls back to the default exclusion when statusCategory is not a string', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ incidents: [] }))

    await incidentioConnector.listDocuments(ACCESS_TOKEN, { statusCategory: 42 })

    const url = requestUrl()
    expect(url.searchParams.getAll('status_category[not_in]')).toEqual([
      ...DEFAULT_EXCLUDED_STATUS_CATEGORIES,
    ])
    expect(url.searchParams.has('status_category[one_of]')).toBe(false)
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

  it('throws instead of reporting an empty listing when the API fails', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'nope' }, 500))

    await expect(incidentioConnector.listDocuments(ACCESS_TOKEN, {})).rejects.toThrow(
      'Failed to list incident.io incidents: 500'
    )
  })
})

describe('incidentioConnector.getDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hydrates an incident with its status updates', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ incident: incidentFixture() }))
      .mockResolvedValueOnce(
        jsonResponse({
          incident_updates: [
            {
              id: 'upd-1',
              message: 'Mitigated',
              created_at: '2026-01-01T01:00:00Z',
              updater: { user: { name: 'Ada' } },
            },
          ],
        })
      )

    const doc = await incidentioConnector.getDocument(ACCESS_TOKEN, {}, 'inc-1')

    expect(doc?.externalId).toBe('inc-1')
    expect(doc?.title).toBe('INC-1: Checkout is down')
    expect(doc?.content).toContain('Mitigated')
    expect(doc?.content).toContain('Ada')
    expect(doc?.contentDeferred).toBe(false)
  })

  it('returns the incident even when the updates fetch fails', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ incident: incidentFixture() }))
      .mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 500))

    const doc = await incidentioConnector.getDocument(ACCESS_TOKEN, {}, 'inc-1')

    expect(doc?.externalId).toBe('inc-1')
    expect(doc?.content).toContain('Checkout is down')
  })

  it('returns null for a deleted incident', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 404))

    await expect(incidentioConnector.getDocument(ACCESS_TOKEN, {}, 'inc-1')).resolves.toBeNull()
  })

  it('returns null instead of throwing when the API fails', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'nope' }, 500))

    await expect(incidentioConnector.getDocument(ACCESS_TOKEN, {}, 'inc-1')).resolves.toBeNull()
  })

  it('returns null instead of throwing when fetch rejects', async () => {
    mockFetch.mockRejectedValue(new Error('boom'))

    await expect(incidentioConnector.getDocument(ACCESS_TOKEN, {}, 'inc-1')).resolves.toBeNull()
  })

  it('returns null for an empty external id without calling the API', async () => {
    await expect(incidentioConnector.getDocument(ACCESS_TOKEN, {}, '')).resolves.toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
