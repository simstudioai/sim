/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { sql as drizzleSql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBuildFilterClause,
  mockBuildPredicateClause,
  mockBuildSortClause,
  mockEscapeLikePattern,
} = vi.hoisted(() => ({
  mockBuildFilterClause: vi.fn(() => ({ type: 'filter' })),
  mockBuildPredicateClause: vi.fn(() => ({ type: 'predicate' })),
  mockBuildSortClause: vi.fn(() => ({ type: 'sort' })),
  mockEscapeLikePattern: vi.fn((value: string) => value),
}))

vi.mock('@/lib/table/sql', () => ({
  buildFilterClause: mockBuildFilterClause,
  buildPredicateClause: mockBuildPredicateClause,
  buildSortClause: mockBuildSortClause,
  escapeLikePattern: mockEscapeLikePattern,
}))

vi.mock('drizzle-orm', () => {
  const operator = (type: string) =>
    vi.fn((...values: unknown[]) => ({ type, values, left: values[0], right: values[1] }))
  const expression = () => ({
    type: 'sql',
    mapWith: vi.fn(() => expression()),
    as: vi.fn(() => ({ type: 'sql' })),
  })
  const sql = vi.fn(expression)

  return {
    and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
    count: operator('count'),
    desc: operator('desc'),
    eq: operator('eq'),
    inArray: operator('inArray'),
    isNull: operator('isNull'),
    lt: operator('lt'),
    max: operator('max'),
    or: vi.fn((...conditions: unknown[]) => ({ type: 'or', conditions })),
    sql,
  }
})

import {
  findMemoryTableRowMatches,
  getMemoryTableDefinition,
  queryMemoryTableRows,
} from '@/lib/virtual-tables/memory-virtual-table.server'

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z')
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z')

describe('Memory virtual table', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('builds the synthetic definition from workspace metadata and a bounded aggregate', async () => {
    queueTableRows(schemaMock.workspace, [
      {
        id: 'workspace-1',
        ownerId: 'user-1',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ])
    queueTableRows(schemaMock.memory, [
      { rowCount: 2, lastMemoryUpdatedAt: new Date('2026-01-03T00:00:00.000Z') },
    ])

    const definition = await getMemoryTableDefinition('workspace-1')

    expect(definition).toMatchObject({
      id: 'system_memory_workspace-1',
      workspaceId: 'workspace-1',
      rowCount: 2,
      name: 'Memory',
    })
  })

  it('returns null when the workspace does not exist', async () => {
    queueTableRows(schemaMock.workspace, [])
    queueTableRows(schemaMock.memory, [])

    await expect(getMemoryTableDefinition('workspace-missing')).resolves.toBeNull()
  })

  it('casts JSON object keys so Postgres can infer bound parameter types', async () => {
    queueTableRows(schemaMock.memory, [])

    await queryMemoryTableRows({ workspaceId: 'workspace-1', includeTotal: false })

    const jsonObjectCall = vi
      .mocked(drizzleSql)
      .mock.calls.find(([strings]) => Array.from(strings).join('').includes('jsonb_build_object'))
    expect(jsonObjectCall).toBeDefined()
    const [strings, ...values] = jsonObjectCall!
    expect(
      Array.from(strings)
        .join('')
        .match(/::text/g)
    ).toHaveLength(6)
    expect([values[0], values[2], values[4], values[6], values[8], values[10]]).toEqual([
      'id',
      'conversation_id',
      'transcript',
      'message_count',
      'created_at',
      'updated_at',
    ])
  })

  it('serializes filterable timestamps with the same UTC ISO format returned by the API', async () => {
    queueTableRows(schemaMock.memory, [])

    await queryMemoryTableRows({ workspaceId: 'workspace-1', includeTotal: false })

    const timestampCalls = vi
      .mocked(drizzleSql)
      .mock.calls.filter(([strings]) => Array.from(strings).join('').includes('to_char'))
    expect(timestampCalls).toHaveLength(2)
    for (const [strings] of timestampCalls) {
      expect(Array.from(strings).join('')).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    }
  })

  it.each([
    { filter: { transcript: { $contains: 'hello' } } },
    { sort: { transcript: 'asc' as const } },
  ])('rejects transcript filtering and sorting before reading Memory rows', async (options) => {
    await expect(queryMemoryTableRows({ workspaceId: 'workspace-1', ...options })).rejects.toThrow(
      'Transcript filtering and sorting are not supported for this table'
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('filters metadata with nested predicates and counts the filtered view', async () => {
    queueTableRows(schemaMock.memory, [])
    queueTableRows(schemaMock.memory, [{ value: 0 }])

    await queryMemoryTableRows({
      workspaceId: 'workspace-1',
      predicate: {
        all: [
          { field: 'conversation_id', op: 'contains', value: 'customer' },
          { field: 'message_count', op: 'gte', value: 2 },
        ],
      },
      includeTotal: true,
    })

    expect(mockBuildPredicateClause).toHaveBeenCalledWith(
      {
        all: [
          { field: 'conversation_id', op: 'contains', value: 'customer' },
          { field: 'message_count', op: 'gte', value: 2 },
        ],
      },
      'memory_rows',
      expect.any(Array)
    )
    const candidateConditions = flattenMockConditions(dbChainMockFns.where.mock.calls[0]?.[0])
    const countConditions = flattenMockConditions(dbChainMockFns.where.mock.calls[1]?.[0])
    expect(candidateConditions).toContainEqual({ type: 'predicate' })
    expect(countConditions).toContainEqual({ type: 'predicate' })
  })

  it('sorts metadata with a deterministic tie-breaker and disables keyset pagination', async () => {
    queueTableRows(schemaMock.memory, [
      {
        id: 'memory-1',
        key: 'conversation-1',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        data: [{ role: 'user', content: 'Hello' }],
        messageCount: 2,
        rowBytes: 100,
      },
      {
        id: 'memory-2',
        key: 'conversation-2',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        data: [{ role: 'user', content: 'Second' }],
        messageCount: 1,
        rowBytes: 100,
      },
    ])
    queueTableRows(schemaMock.memory, [
      { id: 'memory-1', data: [{ role: 'user', content: 'Hello' }] },
      { id: 'memory-2', data: [{ role: 'user', content: 'Second' }] },
    ])
    const result = await queryMemoryTableRows({
      workspaceId: 'workspace-1',
      sort: { message_count: 'asc' },
      limit: 1,
      includeTotal: false,
    })

    expect(dbChainMockFns.orderBy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sort' }),
      expect.objectContaining({ type: 'desc', left: 'id' })
    )
    expect(mockBuildSortClause).toHaveBeenCalledWith(
      { message_count: 'asc' },
      'memory_rows',
      expect.any(Array)
    )
    expect(result.keysetValid).toBe(false)
  })

  it('returns complete transcripts directly from a limited page', async () => {
    queueTableRows(schemaMock.memory, [
      {
        id: 'memory-2',
        key: 'conversation-2',
        createdAt: CREATED_AT,
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        data: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
        messageCount: 2,
        rowBytes: 200,
      },
      {
        id: 'memory-1',
        key: 'conversation-1',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        data: [{ role: 'user', content: 'First' }],
        messageCount: 1,
        rowBytes: 100,
      },
    ])
    queueTableRows(schemaMock.memory, [{ value: 3 }])
    queueTableRows(schemaMock.memory, [
      {
        id: 'memory-2',
        data: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
      },
      { id: 'memory-1', data: [{ role: 'user', content: 'First' }] },
    ])
    const result = await queryMemoryTableRows({
      workspaceId: 'workspace-1',
      limit: 2,
      offset: 0,
      includeTotal: true,
    })

    expect(result).toMatchObject({
      totalCount: 3,
      keysetValid: true,
    })
    expect(result.rows.map((row) => row.data)).toEqual([
      {
        id: 'memory-2',
        conversation_id: 'conversation-2',
        transcript: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
        message_count: 2,
        created_at: CREATED_AT.toISOString(),
        updated_at: '2026-01-03T00:00:00.000Z',
      },
      {
        id: 'memory-1',
        conversation_id: 'conversation-1',
        transcript: [{ role: 'user', content: 'First' }],
        message_count: 1,
        created_at: CREATED_AT.toISOString(),
        updated_at: UPDATED_AT.toISOString(),
      },
    ])

    const conditions = flattenMockConditions(dbChainMockFns.where.mock.calls[0]?.[0])
    expect(conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'eq', left: 'workspaceId', right: 'workspace-1' }),
        expect.objectContaining({ type: 'isNull', left: 'deletedAt' }),
      ])
    )
  })

  it('cuts a page before complete transcripts exceed the query byte budget', async () => {
    const first = {
      id: 'memory-2',
      key: 'conversation-2',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      data: [{ role: 'user', content: 'first' }],
      messageCount: 1,
      rowBytes: 5 * 1024 * 1024 - 100,
    }
    const witness = {
      id: 'memory-1',
      key: 'conversation-1',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      data: [{ role: 'user', content: 'second' }],
      messageCount: 1,
      rowBytes: 200,
    }
    queueTableRows(schemaMock.memory, [first, witness])
    queueTableRows(schemaMock.memory, [{ id: first.id, data: first.data }])

    const result = await queryMemoryTableRows({
      workspaceId: 'workspace-1',
      limit: 1000,
      includeTotal: false,
    })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.id).toBe(first.id)
    expect(result.hasMore).toBe(true)
  })

  it('still returns one transcript that alone exceeds the query byte budget', async () => {
    const oversized = {
      id: 'memory-1',
      key: 'conversation-1',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      data: [{ role: 'user', content: 'oversized' }],
      messageCount: 1,
      rowBytes: 5 * 1024 * 1024 + 1,
    }
    queueTableRows(schemaMock.memory, [oversized])
    queueTableRows(schemaMock.memory, [{ id: oversized.id, data: oversized.data }])

    const result = await queryMemoryTableRows({
      workspaceId: 'workspace-1',
      limit: 1000,
      includeTotal: false,
    })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.id).toBe(oversized.id)
    expect(result.hasMore).toBe(false)
  })

  it('finds matching cells in one storage query and preserves filtered sort ordinals', async () => {
    dbChainMockFns.execute.mockResolvedValueOnce([
      { ordinal: '4', id: 'memory-1', column_name: 'transcript' },
      { ordinal: 7, id: 'memory-2', column_name: 'conversation_id' },
    ])

    await expect(
      findMemoryTableRowMatches({
        workspaceId: 'workspace-1',
        q: '50%_off',
        filter: { conversation_id: { $contains: 'customer' } },
        sort: { updated_at: 'asc' },
      })
    ).resolves.toEqual({
      matches: [
        { ordinal: 4, rowId: 'memory-1', column: 'transcript' },
        { ordinal: 7, rowId: 'memory-2', column: 'conversation_id' },
      ],
      truncated: false,
    })

    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(1)
    expect(mockEscapeLikePattern).toHaveBeenCalledWith('50%_off')
    expect(mockBuildFilterClause).toHaveBeenCalledWith(
      { conversation_id: { $contains: 'customer' } },
      'memory_rows',
      expect.any(Array)
    )
    expect(mockBuildSortClause).toHaveBeenCalledWith(
      { updated_at: 'asc' },
      'memory_rows',
      expect.any(Array)
    )
    const findSqlCall = vi
      .mocked(drizzleSql)
      .mock.calls.find(([strings]) => Array.from(strings).join('').includes('jsonb_each_text'))
    expect(findSqlCall).toBeDefined()
  })

  it('caps storage matches and reports truncation', async () => {
    dbChainMockFns.execute.mockResolvedValueOnce(
      Array.from({ length: 1001 }, (_, index) => ({
        ordinal: index,
        id: `memory-${index}`,
        column_name: 'transcript',
      }))
    )

    const result = await findMemoryTableRowMatches({ workspaceId: 'workspace-1', q: 'hello' })

    expect(result).toMatchObject({ truncated: true })
    expect(result.matches).toHaveLength(1000)
  })

  it('returns an empty page', async () => {
    queueTableRows(schemaMock.memory, [])

    await expect(
      queryMemoryTableRows({
        workspaceId: 'workspace-1',
        limit: 100,
        offset: 0,
        includeTotal: false,
      })
    ).resolves.toEqual({
      rows: [],
      totalCount: null,
      keysetValid: true,
      hasMore: false,
    })

    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
  })

  it('supports an initial offset and a subsequent keyset page', async () => {
    const candidate = {
      id: 'memory-1',
      key: 'conversation-1',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      data: [{ role: 'user', content: 'Hello' }],
      messageCount: 1,
      rowBytes: 100,
    }
    queueTableRows(schemaMock.memory, [candidate])
    queueTableRows(schemaMock.memory, [{ id: candidate.id, data: candidate.data }])

    const offsetPage = await queryMemoryTableRows({
      workspaceId: 'workspace-1',
      limit: 1,
      offset: 5,
      includeTotal: false,
    })

    expect(offsetPage.rows[0]?.position).toBe(5)
    expect(dbChainMockFns.offset).toHaveBeenCalledWith(5)

    queueTableRows(schemaMock.memory, [candidate])
    queueTableRows(schemaMock.memory, [{ id: candidate.id, data: candidate.data }])

    const keysetWhereCall = dbChainMockFns.where.mock.calls.length
    await expect(
      queryMemoryTableRows({
        workspaceId: 'workspace-1',
        limit: 1,
        offset: 0,
        after: { orderKey: '2026-01-03T00:00:00.000Z', id: 'memory-2' },
        includeTotal: false,
      })
    ).resolves.toMatchObject({ rows: [expect.objectContaining({ id: 'memory-1' })] })

    const conditions = flattenMockConditions(dbChainMockFns.where.mock.calls[keysetWhereCall]?.[0])
    const keyset = conditions.find((condition) => condition.type === 'or')
    expect(keyset).toEqual({
      type: 'or',
      conditions: [
        expect.objectContaining({
          type: 'lt',
          left: 'updatedAt',
          right: new Date('2026-01-03T00:00:00.000Z'),
        }),
        {
          type: 'and',
          conditions: [
            expect.objectContaining({
              type: 'eq',
              left: 'updatedAt',
              right: new Date('2026-01-03T00:00:00.000Z'),
            }),
            expect.objectContaining({ type: 'lt', left: 'id', right: 'memory-2' }),
          ],
        },
      ],
    })
  })

  it('rejects a cursor combined with a positive offset before querying', async () => {
    await expect(
      queryMemoryTableRows({
        workspaceId: 'workspace-1',
        limit: 100,
        offset: 5,
        after: { orderKey: UPDATED_AT.toISOString(), id: 'memory-1' },
        includeTotal: false,
      })
    ).rejects.toThrow('cannot combine a cursor and offset')

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('rejects an invalid keyset cursor before querying the database', async () => {
    await expect(
      queryMemoryTableRows({
        workspaceId: 'workspace-1',
        limit: 100,
        offset: 0,
        after: { orderKey: 'not-a-date', id: 'memory-1' },
        includeTotal: false,
      })
    ).rejects.toThrow('Invalid memory table cursor')

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
