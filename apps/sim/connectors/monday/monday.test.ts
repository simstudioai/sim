import { describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({ VALIDATE_RETRY_OPTIONS: {} }))
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => ({
  fetchWithRetry: mockFetchWithRetry,
}))
vi.mock('@/components/icons', () => ({ MondayIcon: () => null }))

import { mondayConnector } from '@/connectors/monday/monday'

interface MondayReply {
  status?: number
  body?: unknown
}

/**
 * Queues monday GraphQL replies in order. monday has a single endpoint, so calls
 * are matched positionally; the recorded request bodies are returned for
 * assertions on the query text and variables.
 */
function mockMonday(replies: MondayReply[]) {
  const requests: { query: string; variables: Record<string, unknown> }[] = []
  let call = 0
  mockFetchWithRetry.mockImplementation(async (_url: string, options: RequestInit) => {
    requests.push(JSON.parse(String(options.body)))
    const reply = replies[call++] ?? { body: { data: {} } }
    const status = reply.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body ?? {}),
    } as unknown as Response
  })
  return requests
}

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Item ${id}`,
    state: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    url: `https://example.monday.com/boards/1/pulses/${id}`,
    board: { id: '1', name: 'Board One' },
    group: { id: 'g1', title: 'Group One' },
    creator: { name: 'Ada' },
    column_values: [],
    updates: [],
    ...overrides,
  }
}

function boardsPage(items: unknown[], cursor: string | null = null): MondayReply {
  return {
    body: { data: { boards: [{ id: '1', name: 'Board One', items_page: { cursor, items } }] } },
  }
}

describe('monday listDocuments', () => {
  it('passes board ids as GraphQL variables rather than interpolating them', async () => {
    const requests = mockMonday([boardsPage([item('10')])])

    await mondayConnector.listDocuments('token', { boardIds: '1' }, undefined, {})

    expect(requests[0].variables).toEqual({ ids: ['1'], limit: 100 })
    expect(requests[0].query).not.toContain('1234')
    expect(requests[0].query).toContain('$ids')
  })

  it('flags listingCapped when maxItems stops a board that still has a cursor', async () => {
    mockMonday([boardsPage([item('10'), item('11')], 'cursor-2')])

    const syncContext: Record<string, unknown> = {}
    await mondayConnector.listDocuments(
      'token',
      { boardIds: '1', maxItems: '2' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
  })

  it('flags listingCapped when maxItems hides items on the same page', async () => {
    mockMonday([boardsPage([item('10'), item('11'), item('12')], null)])

    const syncContext: Record<string, unknown> = {}
    const result = await mondayConnector.listDocuments(
      'token',
      { boardIds: '1', maxItems: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('throws instead of returning an empty listing when monday returns errors on HTTP 200', async () => {
    mockMonday([
      {
        body: {
          data: {
            boards: [{ id: '1', name: 'Board One', items_page: { cursor: null, items: [] } }],
          },
          errors: [
            { message: 'Board not found', extensions: { code: 'ResourceNotFoundException' } },
          ],
        },
      },
    ])

    await expect(
      mondayConnector.listDocuments('token', { boardIds: '1' }, undefined, {})
    ).rejects.toThrow('ResourceNotFoundException')
  })
})

describe('monday listDocuments with configured boards the caller cannot reach', () => {
  it('reports the sole configured board coming back absent as the scope being unavailable', async () => {
    mockMonday([{ body: { data: { boards: [] } } }])
    const syncContext: Record<string, unknown> = {}

    const error = await mondayConnector
      .listDocuments('token', { boardIds: '1' }, undefined, syncContext)
      .catch((caught: unknown) => caught)

    expect(mondayConnector.isListingScopeUnavailableError?.(error)).toBe(true)
  })

  it('skips only the unreachable board when another configured board is reachable', async () => {
    mockMonday([
      { body: { data: { boards: [] } } },
      {
        body: {
          data: {
            boards: [
              { id: '2', name: 'Board Two', items_page: { cursor: null, items: [item('a')] } },
            ],
          },
        },
      },
    ])
    const syncContext: Record<string, unknown> = {}

    const first = await mondayConnector.listDocuments(
      'token',
      { boardIds: '1,2' },
      undefined,
      syncContext
    )
    expect(first.documents).toHaveLength(0)
    expect(first.hasMore).toBe(true)

    const second = await mondayConnector.listDocuments(
      'token',
      { boardIds: '1,2' },
      first.nextCursor,
      syncContext
    )
    expect(second.documents.map((doc) => doc.externalId)).toEqual(['a'])
    expect(second.hasMore).toBe(false)
  })

  it('does not doubt an enumerated board list, which only ever holds reachable boards', async () => {
    mockMonday([{ body: { data: { boards: [] } } }])
    const syncContext: Record<string, unknown> = {}

    const result = await mondayConnector.listDocuments('token', {}, undefined, syncContext)
    expect(result.documents).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })
})

describe('monday getDocument', () => {
  /**
   * A swallowed error would return `null`, which the sync engine reads as an
   * absent document rather than a failure — the item would silently vanish from
   * the run with no counter and no error row.
   */
  it('throws rather than returning null when the API fails', async () => {
    mockMonday([{ status: 500, body: { error_message: 'Internal server error' } }])

    await expect(mondayConnector.getDocument('token', {}, '10')).rejects.toThrow('500')
  })
})
