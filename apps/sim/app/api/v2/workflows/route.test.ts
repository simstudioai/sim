/**
 * @vitest-environment node
 *
 * Public v2 workflow list: the search/sort/filter convention, and the keyset
 * cursor's binding to the sort it was minted under. The assertions look at the
 * WHERE/ORDER BY the route hands drizzle, because that is the whole point of
 * the change — a search must narrow the query, not the result.
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimit, mockResolveWorkspaceAccess } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/app/api/v2/lib/gate', () => ({
  v2ApiGateError: vi.fn().mockResolvedValue(null),
}))

import { GET } from '@/app/api/v2/workflows/route'

const WS = 'workspace-1'

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2024-01-01T01:00:00Z'),
}

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf_1',
    name: 'Daily digest',
    description: null,
    folderId: null,
    workspaceId: WS,
    isDeployed: false,
    deployedAt: null,
    runCount: 3,
    lastRunAt: null,
    sortOrder: 0,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  }
}

const callList = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/api/v2/workflows?${query}`))

/** The condition nodes the route passed to `.where()` on the last query. */
const lastConditions = () =>
  flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0]).filter(Boolean)

const lastOrderBy = () => dbChainMockFns.orderBy.mock.calls.at(-1) ?? []

/**
 * Timestamp keys order on `date_trunc('milliseconds', col)` rather than the raw
 * column, so the mocked `sql` fragment carries the column in its interpolated
 * values rather than being the column itself.
 */
const truncatedColumnOf = (entry: { column: { values?: unknown[] } }) => entry.column?.values?.[0]

describe('GET /api/v2/workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
  })

  it('narrows the query with a case-insensitive substring match on the name', async () => {
    queueTableRows(schemaMock.workflow, [buildRow()])

    const res = await callList(`workspaceId=${WS}&search=digest`)

    expect(res.status).toBe(200)
    const search = lastConditions().find((c) => c.type === 'ilike')
    expect(search).toMatchObject({ column: schemaMock.workflow.name, pattern: '%digest%' })
  })

  it('escapes LIKE wildcards so a caller cannot widen its own match', async () => {
    queueTableRows(schemaMock.workflow, [])

    await callList(`workspaceId=${WS}&search=${encodeURIComponent('100%_x')}`)

    expect(lastConditions().find((c) => c.type === 'ilike')).toMatchObject({
      pattern: '%100\\%\\_x%',
    })
  })

  it('adds no search condition when the caller did not search', async () => {
    queueTableRows(schemaMock.workflow, [buildRow()])

    await callList(`workspaceId=${WS}`)

    expect(lastConditions().some((c) => c.type === 'ilike')).toBe(false)
  })

  it('400s on a sort field outside the enum instead of letting it reach the query', async () => {
    const res = await callList(`workspaceId=${WS}&sortBy=(select 1)`)

    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('400s on a sort direction outside the enum', async () => {
    const res = await callList(`workspaceId=${WS}&sortOrder=sideways`)

    expect(res.status).toBe(400)
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('400s on an empty search rather than treating it as unsearched', async () => {
    const res = await callList(`workspaceId=${WS}&search=`)

    expect(res.status).toBe(400)
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('defaults to the workspace position ordering', async () => {
    queueTableRows(schemaMock.workflow, [buildRow()])

    await callList(`workspaceId=${WS}`)

    const orderBy = lastOrderBy()
    expect(orderBy.map((e: { type: string }) => e.type)).toEqual(['asc', 'asc', 'asc'])
    expect(orderBy[0].column).toBe(schemaMock.workflow.sortOrder)
    expect(truncatedColumnOf(orderBy[1])).toBe(schemaMock.workflow.createdAt)
    expect(orderBy[2].column).toBe(schemaMock.workflow.id)
  })

  it('orders by the requested field and direction', async () => {
    queueTableRows(schemaMock.workflow, [buildRow()])

    await callList(`workspaceId=${WS}&sortBy=name&sortOrder=desc`)

    expect(lastOrderBy()).toEqual([
      { type: 'desc', column: schemaMock.workflow.name },
      { type: 'desc', column: schemaMock.workflow.id },
    ])
  })

  it('combines a filter with a cursor into one consistent page', async () => {
    queueTableRows(schemaMock.workflow, [buildRow(), buildRow({ id: 'wf_2', name: 'Zebra' })])

    const first = await callList(`workspaceId=${WS}&search=a&sortBy=name&limit=1`)
    const body = await first.json()

    expect(body.data).toHaveLength(1)
    expect(body.nextCursor).not.toBeNull()

    queueTableRows(schemaMock.workflow, [buildRow({ id: 'wf_2', name: 'Zebra' })])
    const second = await callList(
      `workspaceId=${WS}&search=a&sortBy=name&limit=1&cursor=${encodeURIComponent(body.nextCursor)}`
    )

    expect(second.status).toBe(200)
    const conditions = lastConditions()
    // The filter survives the cursor page, and the keyset resumes from the last row.
    expect(conditions.find((c) => c.type === 'ilike')).toMatchObject({ pattern: '%a%' })
    expect(conditions.some((c) => c.type === 'or')).toBe(true)
  })

  it('terminates pagination once a filtered page is not full', async () => {
    queueTableRows(schemaMock.workflow, [buildRow()])

    const res = await callList(`workspaceId=${WS}&search=digest&limit=50`)

    expect((await res.json()).nextCursor).toBeNull()
  })

  it('400s when a cursor is replayed under a different sort', async () => {
    queueTableRows(schemaMock.workflow, [buildRow(), buildRow({ id: 'wf_2' })])

    const first = await callList(`workspaceId=${WS}&sortBy=name&limit=1`)
    const { nextCursor } = await first.json()
    vi.clearAllMocks()

    const res = await callList(
      `workspaceId=${WS}&sortBy=createdAt&limit=1&cursor=${encodeURIComponent(nextCursor)}`
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toMatch(/cursor does not match/i)
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('400s on a malformed cursor instead of silently restarting from page one', async () => {
    const res = await callList(`workspaceId=${WS}&cursor=not-a-cursor`)

    expect(res.status).toBe(400)
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })
})
