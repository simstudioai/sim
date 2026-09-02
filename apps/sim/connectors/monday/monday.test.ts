/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('monday listDocuments', () => {
  it('passes board ids as GraphQL variables rather than interpolating them', async () => {
    const requests = mockMonday([boardsPage([item('10')])])

    await mondayConnector.listDocuments('token', { boardIds: '1' }, undefined, {})

    expect(requests[0].variables).toEqual({ ids: ['1'], limit: 100 })
    expect(requests[0].query).not.toContain('1234')
    expect(requests[0].query).toContain('$ids')
  })

  it('leaves listingCapped unset when maxItems lands exactly on source exhaustion', async () => {
    mockMonday([boardsPage([item('10'), item('11')], null)])

    const syncContext: Record<string, unknown> = {}
    const result = await mondayConnector.listDocuments(
      'token',
      { boardIds: '1', maxItems: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
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

  it('throws when monday returns no data and no errors', async () => {
    mockMonday([{ body: { data: null } }])

    await expect(
      mondayConnector.listDocuments('token', { boardIds: '1' }, undefined, {})
    ).rejects.toThrow('no data')
  })

  it('advances to the next board once a board is exhausted', async () => {
    mockMonday([boardsPage([item('10')], null)])

    const result = await mondayConnector.listDocuments('token', { boardIds: '1,2' }, undefined, {})

    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBeDefined()
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

  it('reports every configured board coming back absent once the last one is walked', async () => {
    mockMonday([{ body: { data: { boards: [] } } }, { body: { data: { boards: [] } } }])
    const syncContext: Record<string, unknown> = {}

    const first = await mondayConnector.listDocuments(
      'token',
      { boardIds: '1,2' },
      undefined,
      syncContext
    )
    expect(first.hasMore).toBe(true)

    const error = await mondayConnector
      .listDocuments('token', { boardIds: '1,2' }, first.nextCursor, syncContext)
      .catch((caught: unknown) => caught)
    expect(mondayConnector.isListingScopeUnavailableError?.(error)).toBe(true)
  })

  it('does not doubt an enumerated board list, which only ever holds reachable boards', async () => {
    mockMonday([{ body: { data: { boards: [] } } }])
    const syncContext: Record<string, unknown> = {}

    const result = await mondayConnector.listDocuments('token', {}, undefined, syncContext)
    expect(result.documents).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })
})

describe('monday content extraction', () => {
  it('falls back to display_value for columns that do not populate text', async () => {
    mockMonday([
      boardsPage([
        item('10', {
          column_values: [
            {
              id: 'status',
              type: 'status',
              text: 'Done',
              column: { id: 'status', title: 'Status' },
            },
            {
              id: 'mirror',
              type: 'mirror',
              text: null,
              display_value: 'Mirrored Value',
              column: { id: 'mirror', title: 'Mirror' },
            },
            {
              id: 'formula',
              type: 'formula',
              text: null,
              display_value: '42',
              column: { id: 'formula', title: 'Formula' },
            },
          ],
        }),
      ]),
    ])

    const result = await mondayConnector.listDocuments('token', { boardIds: '1' }, undefined, {})

    expect(result.documents[0].content).toContain('Status: Done')
    expect(result.documents[0].content).toContain('Mirror: Mirrored Value')
    expect(result.documents[0].content).toContain('Formula: 42')
  })

  it('selects display_value fragments for the column types that need them', async () => {
    const requests = mockMonday([boardsPage([item('10')])])

    await mondayConnector.listDocuments('token', { boardIds: '1' }, undefined, {})

    expect(requests[0].query).toContain('... on MirrorValue { display_value }')
    expect(requests[0].query).toContain('... on BoardRelationValue { display_value }')
    expect(requests[0].query).toContain('... on FormulaValue { display_value }')
  })

  it('produces an identical contentHash from listDocuments and getDocument', async () => {
    mockMonday([boardsPage([item('10')]), { body: { data: { items: [item('10')] } } }])

    const listed = await mondayConnector.listDocuments('token', { boardIds: '1' }, undefined, {})
    const fetched = await mondayConnector.getDocument('token', {}, '10')

    expect(fetched?.contentHash).toBe(listed.documents[0].contentHash)
    expect(fetched?.contentHash).toBe('monday:10:2026-02-01T00:00:00Z')
  })
})

describe('monday getDocument', () => {
  it('returns null when the item is not found', async () => {
    mockMonday([{ body: { data: { items: [] } } }])

    expect(await mondayConnector.getDocument('token', {}, '404')).toBeNull()
  })

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

describe('monday validateConfig', () => {
  it('rejects a negative maxItems without calling the API', async () => {
    const requests = mockMonday([])

    const result = await mondayConnector.validateConfig('token', { maxItems: '-1' })

    expect(result.valid).toBe(false)
    expect(requests).toHaveLength(0)
  })

  it('surfaces the monday error code on an HTTP 200 failure', async () => {
    mockMonday([
      {
        body: { errors: [{ message: 'Not Authenticated', extensions: { code: 'Unauthorized' } }] },
      },
    ])

    const result = await mondayConnector.validateConfig('token', {})

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Unauthorized')
  })

  it('sends the raw token and a pinned API-Version header', async () => {
    mockMonday([{ body: { data: { me: { id: '1' } } } }])

    await mondayConnector.validateConfig('token', {})

    const headers = mockFetchWithRetry.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('token')
    expect(headers['API-Version']).toMatch(/^\d{4}-\d{2}$/)
  })
})
