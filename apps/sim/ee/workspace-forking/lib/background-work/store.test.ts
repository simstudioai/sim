/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import { listSurfacedBackgroundWork } from '@/ee/workspace-forking/lib/background-work/store'

const executor = dbChainMock.db as unknown as DbOrTx

/** Shape produced by the drizzle-orm mock's `sql` tagged template. */
interface MockSqlFragment {
  strings: readonly string[]
  values: unknown[]
}

interface MockCondition {
  type: string
  conditions?: MockCondition[]
  left?: unknown
  right?: unknown
  column?: unknown
  values?: unknown[]
}

/** Resolves the first `.where(...)` (the children lookup) to the given fork ids. */
function mockChildrenLookup(childIds: string[]) {
  dbChainMockFns.where.mockImplementationOnce(
    () => Promise.resolve(childIds.map((id) => ({ id }))) as never
  )
}

/** Builds an opaque cursor the way the store encodes one (base64 JSON). */
function encodeCursor(data: { updatedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

function decodeCursor(cursor: string): { updatedAt: string; id: string } {
  return JSON.parse(Buffer.from(cursor, 'base64').toString())
}

describe('listSurfacedBackgroundWork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns the surfaced rows ordered by recency with the id tiebreaker', async () => {
    mockChildrenLookup([])
    const rows = [
      { id: 'job-1', updatedAt: new Date('2026-07-01T10:00:00.000Z') },
      { id: 'job-2', updatedAt: new Date('2026-07-01T09:00:00.000Z') },
    ]
    dbChainMockFns.limit.mockResolvedValueOnce(rows as never)

    const result = await listSurfacedBackgroundWork(executor, 'ws-1')

    expect(result.rows).toEqual(rows)
    expect(dbChainMockFns.orderBy).toHaveBeenCalledWith(
      { type: 'desc', column: 'updatedAt' },
      { type: 'desc', column: 'id' }
    )
    // Over-fetches one row past the default page size to detect another page.
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(51)
  })

  it('returns a null cursor when the page is not full', async () => {
    mockChildrenLookup([])
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'job-1', updatedAt: new Date('2026-07-01T10:00:00.000Z') },
    ] as never)

    const result = await listSurfacedBackgroundWork(executor, 'ws-1', { limit: 2 })

    expect(result.rows).toHaveLength(1)
    expect(result.nextCursor).toBeNull()
  })

  it('returns a null cursor for an empty page', async () => {
    mockChildrenLookup([])
    dbChainMockFns.limit.mockResolvedValueOnce([] as never)

    const result = await listSurfacedBackgroundWork(executor, 'ws-1')

    expect(result).toEqual({ rows: [], nextCursor: null })
  })

  it('trims the over-fetched row and encodes the next cursor from the last returned row', async () => {
    mockChildrenLookup([])
    const rows = [
      {
        id: 'job-1',
        updatedAt: new Date('2026-07-01T10:00:00.000Z'),
        updatedAtCursor: '2026-07-01 10:00:00',
      },
      {
        id: 'job-2',
        updatedAt: new Date('2026-07-01T09:00:00.000Z'),
        updatedAtCursor: '2026-07-01 09:00:00',
      },
      {
        id: 'job-3',
        updatedAt: new Date('2026-07-01T08:00:00.000Z'),
        updatedAtCursor: '2026-07-01 08:00:00',
      },
    ]
    dbChainMockFns.limit.mockResolvedValueOnce(rows as never)

    const result = await listSurfacedBackgroundWork(executor, 'ws-1', { limit: 2 })

    expect(dbChainMockFns.limit).toHaveBeenCalledWith(3)
    expect(result.rows).toEqual(rows.slice(0, 2))
    expect(result.nextCursor).not.toBeNull()
    expect(decodeCursor(result.nextCursor as string)).toEqual({
      updatedAt: '2026-07-01 09:00:00',
      id: 'job-2',
    })
  })

  it('encodes the cursor from the exact microsecond timestamp text, not the truncated Date', async () => {
    mockChildrenLookup([])
    // The Date column value is millisecond-truncated by Drizzle; the cursor must
    // carry the microsecond text so the keyset boundary is exact.
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'job-1',
        updatedAt: new Date('2026-07-01T10:00:00.123Z'),
        updatedAtCursor: '2026-07-01 10:00:00.123456',
      },
      {
        id: 'job-2',
        updatedAt: new Date('2026-07-01T09:00:00.000Z'),
        updatedAtCursor: '2026-07-01 09:00:00',
      },
    ] as never)

    const result = await listSurfacedBackgroundWork(executor, 'ws-1', { limit: 1 })

    expect(decodeCursor(result.nextCursor as string)).toEqual({
      updatedAt: '2026-07-01 10:00:00.123456',
      id: 'job-1',
    })
  })

  it('applies the cursor as a keyset condition with the id tiebreaker', async () => {
    mockChildrenLookup([])
    const cursorTimestamp = '2026-07-01 09:00:00.123456'
    const cursor = encodeCursor({ updatedAt: cursorTimestamp, id: 'job-2' })

    await listSurfacedBackgroundWork(executor, 'ws-1', { cursor })

    const rowsWhere = dbChainMockFns.where.mock.calls[1][0] as MockCondition
    expect(rowsWhere.type).toBe('and')
    expect(rowsWhere.conditions).toHaveLength(3)

    // The cursor timestamp is bound as a `::timestamp`-cast SQL fragment so the
    // comparison happens at full microsecond precision in Postgres.
    const expectedTimestampFragment = expect.objectContaining({ values: [cursorTimestamp] })
    const keyset = (rowsWhere.conditions as MockCondition[])[2]
    expect(keyset).toEqual(
      expect.objectContaining({
        type: 'or',
        conditions: [
          expect.objectContaining({
            type: 'lt',
            left: 'updatedAt',
            right: expectedTimestampFragment,
          }),
          expect.objectContaining({
            type: 'and',
            conditions: [
              expect.objectContaining({
                type: 'eq',
                left: 'updatedAt',
                right: expectedTimestampFragment,
              }),
              expect.objectContaining({ type: 'lt', left: 'id', right: 'job-2' }),
            ],
          }),
        ],
      })
    )
  })

  it('accepts a legacy ISO cursor produced before the text-precision format', async () => {
    mockChildrenLookup([])
    const cursor = encodeCursor({ updatedAt: '2026-07-01T09:00:00.000Z', id: 'job-2' })

    await listSurfacedBackgroundWork(executor, 'ws-1', { cursor })

    const rowsWhere = dbChainMockFns.where.mock.calls[1][0] as MockCondition
    expect(rowsWhere.conditions).toHaveLength(3)
    const keyset = (rowsWhere.conditions as MockCondition[])[2]
    expect((keyset.conditions as MockCondition[])[0]).toEqual(
      expect.objectContaining({
        type: 'lt',
        left: 'updatedAt',
        right: expect.objectContaining({ values: ['2026-07-01T09:00:00.000Z'] }),
      })
    )
  })

  it('pages through rows with identical updatedAt via the id tiebreaker', async () => {
    // Two rows share one timestamp; page 1 ends on the higher id. The next
    // cursor must carry that id so the second page matches the remaining row
    // through the eq(updatedAt) + lt(id) arm instead of skipping it.
    const sharedAt = new Date('2026-07-01T09:00:00.000Z')
    const sharedAtCursor = '2026-07-01 09:00:00'
    mockChildrenLookup([])
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'job-b', updatedAt: sharedAt, updatedAtCursor: sharedAtCursor },
      { id: 'job-a', updatedAt: sharedAt, updatedAtCursor: sharedAtCursor },
    ] as never)

    const firstPage = await listSurfacedBackgroundWork(executor, 'ws-1', { limit: 1 })
    expect(firstPage.rows).toEqual([
      { id: 'job-b', updatedAt: sharedAt, updatedAtCursor: sharedAtCursor },
    ])
    expect(decodeCursor(firstPage.nextCursor as string)).toEqual({
      updatedAt: sharedAtCursor,
      id: 'job-b',
    })

    mockChildrenLookup([])
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'job-a', updatedAt: sharedAt, updatedAtCursor: sharedAtCursor },
    ] as never)

    const secondPage = await listSurfacedBackgroundWork(executor, 'ws-1', {
      cursor: firstPage.nextCursor as string,
      limit: 1,
    })

    const rowsWhere = dbChainMockFns.where.mock.calls[3][0] as MockCondition
    const keyset = (rowsWhere.conditions as MockCondition[])[2]
    expect(keyset.conditions?.[1]).toEqual(
      expect.objectContaining({
        type: 'and',
        conditions: [
          expect.objectContaining({
            type: 'eq',
            left: 'updatedAt',
            right: expect.objectContaining({ values: [sharedAtCursor] }),
          }),
          expect.objectContaining({ type: 'lt', left: 'id', right: 'job-b' }),
        ],
      })
    )
    expect(secondPage.rows).toEqual([
      { id: 'job-a', updatedAt: sharedAt, updatedAtCursor: sharedAtCursor },
    ])
    expect(secondPage.nextCursor).toBeNull()
  })

  it('ignores a cursor whose timestamp Postgres would reject and serves the first page', async () => {
    // Feb 30 parses in JS (Date normalizes it to Mar 2) but fails a Postgres
    // ::timestamp cast — it must degrade to the first page, not a 500.
    mockChildrenLookup([])
    const cursor = encodeCursor({ updatedAt: '2026-02-30 09:00:00', id: 'job-2' })

    await listSurfacedBackgroundWork(executor, 'ws-1', { cursor })

    const rowsWhere = dbChainMockFns.where.mock.calls[1][0] as MockCondition
    expect(rowsWhere.conditions).toHaveLength(2)
  })

  it('ignores a cursor with an out-of-range time and serves the first page', async () => {
    mockChildrenLookup([])
    const cursor = encodeCursor({ updatedAt: '2026-07-01 99:00:00', id: 'job-2' })

    await listSurfacedBackgroundWork(executor, 'ws-1', { cursor })

    const rowsWhere = dbChainMockFns.where.mock.calls[1][0] as MockCondition
    expect(rowsWhere.conditions).toHaveLength(2)
  })

  it('ignores an undecodable cursor and serves the first page', async () => {
    mockChildrenLookup([])

    await listSurfacedBackgroundWork(executor, 'ws-1', { cursor: 'not-base64-json' })

    const rowsWhere = dbChainMockFns.where.mock.calls[1][0] as MockCondition
    expect(rowsWhere.conditions).toHaveLength(2)
  })

  it('clamps the requested limit to the server-side cap', async () => {
    mockChildrenLookup([])

    await listSurfacedBackgroundWork(executor, 'ws-1', { limit: 5000 })

    expect(dbChainMockFns.limit).toHaveBeenCalledWith(101)
  })

  it('looks up live forks of the workspace for the child-keyed clause', async () => {
    mockChildrenLookup([])
    await listSurfacedBackgroundWork(executor, 'ws-1')

    const childrenWhere = dbChainMockFns.where.mock.calls[0][0] as MockCondition
    expect(childrenWhere).toEqual({
      type: 'and',
      conditions: [
        { type: 'eq', left: 'forkedFromWorkspaceId', right: 'ws-1' },
        { type: 'isNull', column: 'archivedAt' },
      ],
    })
  })

  it('matches rows keyed to the workspace, to it as fork child, and to it as edge partner', async () => {
    mockChildrenLookup([])
    await listSurfacedBackgroundWork(executor, 'ws-1')

    const rowsWhere = dbChainMockFns.where.mock.calls[1][0] as MockCondition
    expect(rowsWhere.type).toBe('and')
    expect(rowsWhere.conditions).toHaveLength(2)
    const [involves, statuses] = rowsWhere.conditions as [MockCondition, MockCondition]

    expect(involves.type).toBe('or')
    const orConditions = involves.conditions as unknown as [
      MockCondition,
      MockSqlFragment,
      MockSqlFragment,
    ]
    expect(orConditions).toHaveLength(3)

    expect(orConditions[0]).toEqual({ type: 'eq', left: 'workspaceId', right: 'ws-1' })

    const childIdClause = orConditions[1]
    expect(childIdClause.strings.join('?')).toContain("->> 'childWorkspaceId' =")
    expect(childIdClause.values).toEqual(['metadata', 'ws-1'])

    const otherIdClause = orConditions[2]
    expect(otherIdClause.strings.join('?')).toContain("->> 'otherWorkspaceId' =")
    expect(otherIdClause.values).toEqual(['metadata', 'ws-1'])

    expect(statuses).toEqual({
      type: 'inArray',
      column: 'status',
      values: ['pending', 'processing', 'completed', 'completed_with_warnings', 'failed'],
    })
  })

  it('also matches sync/rollback rows keyed to the forks of the workspace (pre-otherWorkspaceId history)', async () => {
    mockChildrenLookup(['fork-1', 'fork-2'])
    await listSurfacedBackgroundWork(executor, 'ws-1')

    const rowsWhere = dbChainMockFns.where.mock.calls[1][0] as MockCondition
    const involves = (rowsWhere.conditions as MockCondition[])[0]
    expect(involves.conditions).toHaveLength(4)

    const childKeyedClause = (involves.conditions as MockCondition[])[3]
    expect(childKeyedClause).toEqual({
      type: 'and',
      conditions: [
        { type: 'inArray', column: 'workspaceId', values: ['fork-1', 'fork-2'] },
        { type: 'inArray', column: 'kind', values: ['fork_sync', 'fork_rollback'] },
      ],
    })
  })

  it('omits the child-keyed clause when the workspace has no forks', async () => {
    mockChildrenLookup([])
    await listSurfacedBackgroundWork(executor, 'ws-1')

    const rowsWhere = dbChainMockFns.where.mock.calls[1][0] as MockCondition
    const involves = (rowsWhere.conditions as MockCondition[])[0]
    expect(involves.conditions).toHaveLength(3)
  })
})
