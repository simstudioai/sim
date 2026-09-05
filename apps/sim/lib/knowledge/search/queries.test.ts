/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_ACCESS_TOKENS } from '@/lib/knowledge/access/types'
import { buildTagFilterCondition } from '@/lib/knowledge/documents/tag-filter'
import {
  executeKeywordSearch,
  getStructuredTagFilters,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
  type SearchParams,
} from '@/lib/knowledge/search/queries'
import type { StructuredFilter } from '@/lib/knowledge/types'

/**
 * The builder only reads `embeddingTable[tagSlot]`, so a slot-to-name map stands
 * in for the real table and makes each rendered parameter readable.
 */
const embeddingTable = {
  tag1: 'tag1',
  number1: 'number1',
  date1: 'date1',
  boolean1: 'boolean1',
}

/**
 * The global `drizzle-orm` mock renders `sql` fragments to a `?`-placeholder
 * string via `toSQL()`, so we can assert the exact predicate each filter builds.
 */
function render(condition: unknown) {
  return (condition as { toSQL: () => { sql: string; params: unknown[] } }).toSQL()
}

function renderOne(filters: StructuredFilter[]) {
  const conditions = getStructuredTagFilters(filters, embeddingTable)
  expect(conditions).toHaveLength(1)
  return render(conditions[0])
}

describe('getStructuredTagFilters', () => {
  describe('agreement with the value the gate validated', () => {
    it('compiles a number the gate read as 0 rather than dropping the filter', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'number1', fieldType: 'number', operator: 'eq', value: '' },
      ])
      expect(sql).toBe('? = ?')
      expect(params).toEqual(['number1', 0])
    })

    it('reads a number in the same base the gate validated', () => {
      const { params } = renderOne([
        { tagSlot: 'number1', fieldType: 'number', operator: 'eq', value: '0x10' },
      ])
      expect(params).toEqual(['number1', 16])
    })

    it('reads a boolean case-insensitively instead of inverting it', () => {
      const { params } = renderOne([
        { tagSlot: 'boolean1', fieldType: 'boolean', operator: 'eq', value: 'TRUE' },
      ])
      expect(params).toEqual(['boolean1', true])
    })

    it('trims a date the gate trimmed rather than dropping the filter', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'date1', fieldType: 'date', operator: 'eq', value: ' 2026-08-13' },
      ])
      expect(sql).toBe('?::date = ?::date')
      expect(params).toEqual(['date1', '2026-08-13'])
    })

    it('escapes LIKE metacharacters so a typed % is not a wildcard', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'tag1', fieldType: 'text', operator: 'contains', value: '50%off' },
      ])
      expect(sql).toBe("LOWER(?) LIKE LOWER(?) ESCAPE '\\'")
      expect(params).toEqual(['tag1', '%50\\%off%'])
    })

    it('escapes LIKE metacharacters for every text operator that uses LIKE', () => {
      for (const operator of ['not_contains', 'starts_with', 'ends_with']) {
        const { sql, params } = renderOne([
          { tagSlot: 'tag1', fieldType: 'text', operator, value: 'a_b' },
        ])
        expect(sql).toContain("ESCAPE '\\'")
        expect(params[1]).toContain('a\\_b')
      }
    })
  })

  describe('a filter that cannot compile is reported, never skipped', () => {
    it('raises instead of returning no predicate at all', () => {
      expect(() =>
        getStructuredTagFilters(
          [{ tagSlot: 'not_a_slot', fieldType: 'text', operator: 'eq', value: 'x' }],
          embeddingTable
        )
      ).toThrow(/Tag filter on slot "not_a_slot" could not be applied/)
    })

    it('raises rather than silently widening a multi-filter search', () => {
      expect(() =>
        getStructuredTagFilters(
          [
            { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'ok' },
            { tagSlot: 'not_a_slot', fieldType: 'text', operator: 'eq', value: 'x' },
          ],
          embeddingTable
        )
      ).toThrow(/could not be applied/)
    })
  })

  describe('a correct filter still compiles to the predicate it always did', () => {
    it('text eq', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'Billing' },
      ])
      expect(sql).toBe('LOWER(?) = LOWER(?)')
      expect(params).toEqual(['tag1', 'Billing'])
    })

    it('number gte', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'number1', fieldType: 'number', operator: 'gte', value: '42' },
      ])
      expect(sql).toBe('? >= ?')
      expect(params).toEqual(['number1', 42])
    })

    it('number between', () => {
      const { sql, params } = renderOne([
        {
          tagSlot: 'number1',
          fieldType: 'number',
          operator: 'between',
          value: '1',
          valueTo: '9',
        },
      ])
      expect(sql).toBe('? >= ? AND ? <= ?')
      expect(params).toEqual(['number1', 1, 'number1', 9])
    })

    it('date between', () => {
      const { sql, params } = renderOne([
        {
          tagSlot: 'date1',
          fieldType: 'date',
          operator: 'between',
          value: '2026-01-01',
          valueTo: '2026-12-31',
        },
      ])
      expect(sql).toBe('?::date >= ?::date AND ?::date <= ?::date')
      expect(params).toEqual(['date1', '2026-01-01', 'date1', '2026-12-31'])
    })

    it('boolean neq', () => {
      const { sql, params } = renderOne([
        { tagSlot: 'boolean1', fieldType: 'boolean', operator: 'neq', value: 'false' },
      ])
      expect(sql).toBe('? != ?')
      expect(params).toEqual(['boolean1', false])
    })
  })

  /**
   * The callers spread the returned conditions into `and(...)`, so one condition
   * per filter is what makes the whole array conjunctive. Grouping same-slot
   * filters into a single OR'd condition made search answer an impossible
   * predicate with a full page while the document list, which ANDs the same
   * filters, answered with nothing.
   */
  describe('every filter is a conjunct, including two naming the same tag', () => {
    it('emits one condition per filter for two filters on the same slot', () => {
      const conditions = getStructuredTagFilters(
        [
          { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'a' },
          { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'b' },
        ],
        embeddingTable
      )
      expect(conditions).toHaveLength(2)
      expect(render(conditions[0]).params).toEqual(['tag1', 'a'])
      expect(render(conditions[1]).params).toEqual(['tag1', 'b'])
    })

    it('keeps an impossible same-tag range as two conditions rather than a union', () => {
      const conditions = getStructuredTagFilters(
        [
          { tagSlot: 'number1', fieldType: 'number', operator: 'gte', value: '9' },
          { tagSlot: 'number1', fieldType: 'number', operator: 'lte', value: '2' },
        ],
        embeddingTable
      )
      expect(conditions).toHaveLength(2)
      expect(render(conditions[0]).sql).toBe('? >= ?')
      expect(render(conditions[1]).sql).toBe('? <= ?')
      expect(conditions.every((condition) => !render(condition).sql.includes('OR'))).toBe(true)
    })

    it('still emits one condition per filter across different slots', () => {
      const conditions = getStructuredTagFilters(
        [
          { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'a' },
          { tagSlot: 'number1', fieldType: 'number', operator: 'gte', value: '9' },
          { tagSlot: 'boolean1', fieldType: 'boolean', operator: 'eq', value: 'true' },
        ],
        embeddingTable
      )
      expect(conditions).toHaveLength(3)
    })
  })

  /**
   * The document list builds one predicate per filter and pushes each into a
   * single `and(...)`. Search must yield the same number of conjuncts for the
   * same filters, or the two surfaces answer different questions over one tag
   * vocabulary.
   */
  describe('agreement with the document-list surface', () => {
    it('produces the same number of conjuncts as the document-list builder', () => {
      const filters: StructuredFilter[] = [
        { tagSlot: 'number1', fieldType: 'number', operator: 'gte', value: '9' },
        { tagSlot: 'number1', fieldType: 'number', operator: 'lte', value: '2' },
      ]

      const listConditions = filters.map((filter) =>
        buildTagFilterCondition({
          tagSlot: filter.tagSlot,
          fieldType: 'number',
          operator: filter.operator,
          value: filter.value,
        })
      )

      expect(listConditions.every((condition) => condition !== undefined)).toBe(true)
      expect(getStructuredTagFilters(filters, embeddingTable)).toHaveLength(listConditions.length)
    })
  })
})

describe('vector scan settings', () => {
  const params: SearchParams = {
    knowledgeBaseIds: ['kb-small'],
    topK: 2,
    access: { kind: 'workspace', tokens: WORKSPACE_ACCESS_TOKENS },
    queryVector: { vector: '[0.1,0.2]', dimensions: 1536 },
    distanceThreshold: 0.8,
  }

  beforeEach(() => {
    resetDbChainMock()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tunes a small workspace search before querying its KB scope, preserving distance ordering', async () => {
    queueTableRows(schemaMock.embedding, [
      { id: 'far', distance: 0.2 },
      { id: 'near', distance: 0.1 },
    ])
    const rows = await handleVectorOnlySearch(params)
    expect(rows.map((row) => row.id)).toEqual(['near', 'far'])
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.execute).toHaveBeenCalledOnce()
    expect(render(dbChainMockFns.execute.mock.calls[0][0])).toEqual({
      sql: "SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true), set_config('hnsw.max_scan_tuples', ?, true)",
      params: ['20000'],
    })
    expect(dbChainMockFns.execute.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.select.mock.invocationCallOrder[0]
    )
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls[0][0],
        (node) =>
          node.type === 'inArray' &&
          node.column === schemaMock.embedding.knowledgeBaseId &&
          Array.isArray(node.values) &&
          node.values.includes('kb-small')
      )
    ).toBe(true)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(2)
  })

  it('shares one local configuration across all KB vector legs and trims their sorted merge', async () => {
    const knowledgeBaseIds = ['kb-1', 'kb-2', 'kb-3', 'kb-4', 'kb-5']
    for (let index = 0; index < knowledgeBaseIds.length; index++)
      queueTableRows(schemaMock.embedding, [{ id: `row-${index}`, distance: (5 - index) / 10 }])
    const rows = await handleVectorOnlySearch({ ...params, knowledgeBaseIds })
    expect(rows.map((row) => row.id)).toEqual(['row-4', 'row-3'])
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.execute).toHaveBeenCalledOnce()
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(5)
    for (const kbId of knowledgeBaseIds)
      expect(
        dbChainMockFns.where.mock.calls.some(([condition]) =>
          hasMockCondition(
            condition,
            (node) =>
              node.type === 'eq' &&
              node.left === schemaMock.embedding.knowledgeBaseId &&
              node.right === kbId
          )
        )
      ).toBe(true)
  })

  it('tunes tag vector queries while keeping tag-only reads outside a vector transaction', async () => {
    const filtered: SearchParams = {
      ...params,
      structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'release' }],
    }
    queueTableRows(schemaMock.embedding, [
      { id: 'far', distance: 0.2 },
      { id: 'near', distance: 0.1 },
    ])
    expect((await handleTagAndVectorSearch(filtered)).map((row) => row.id)).toEqual(['near', 'far'])
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(
      hasMockCondition(dbChainMockFns.where.mock.calls[0][0], (node) => {
        if (typeof node.toSQL !== 'function') return false
        const condition = render(node)
        return (
          condition.sql === 'LOWER(?) = LOWER(?)' &&
          condition.params[0] === schemaMock.embedding.tag1 &&
          condition.params[1] === 'release'
        )
      })
    ).toBe(true)
    resetDbChainMock()
    await handleTagOnlySearch(filtered)
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })

  it('retries unsupported settings after the cooldown without changing the query on fallback', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(0))
    dbChainMockFns.execute.mockRejectedValueOnce(
      new Error('Failed settings query', { cause: { code: '42704' } })
    )
    queueTableRows(schemaMock.embedding, [{ id: 'fallback', distance: 0.1 }])
    expect((await handleVectorOnlySearch(params)).map((row) => row.id)).toEqual(['fallback'])
    expect(dbChainMockFns.execute).toHaveBeenCalledOnce()
    expect(dbChainMockFns.select).toHaveBeenCalledOnce()
    await handleVectorOnlySearch(params)
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1)
    await handleVectorOnlySearch(params)
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(2)
  })

  it('propagates an unrelated settings failure without issuing a query or disabling later tuning', async () => {
    const failure = { code: '08006', message: 'Connection lost' }
    dbChainMockFns.execute.mockRejectedValueOnce(failure)
    await expect(handleVectorOnlySearch(params)).rejects.toBe(failure)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    await handleVectorOnlySearch(params)
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(2)
  })

  it('does not retry a query 42704 or classify it as unsupported scan settings', async () => {
    const failure = { code: '42704', message: 'Query object is missing' }
    dbChainMockFns.limit.mockRejectedValueOnce(failure)
    await expect(handleVectorOnlySearch(params)).rejects.toBe(failure)
    expect(dbChainMockFns.select).toHaveBeenCalledOnce()
    await handleVectorOnlySearch(params)
    expect(dbChainMockFns.execute).toHaveBeenCalledTimes(2)
  })
})

describe('workspace search filters before ranking', () => {
  const params: SearchParams = {
    knowledgeBaseIds: ['index'],
    topK: 2,
    access: { kind: 'workspace', tokens: WORKSPACE_ACCESS_TOKENS },
    queryVector: { vector: '[0.1,0.2]', dimensions: 1536 },
    distanceThreshold: 0.8,
    filters: {
      documentIds: ['selected-doc'],
      source: 'upload',
      modifiedAfter: '2026-09-01T00:00:00Z',
    },
  }
  beforeEach(() => resetDbChainMock())

  function expectScopeOnEveryQuery() {
    expect(dbChainMockFns.where).toHaveBeenCalled()
    for (const [condition] of dbChainMockFns.where.mock.calls) {
      expect(
        hasMockCondition(
          condition,
          (node) =>
            node.type === 'inArray' &&
            node.column === schemaMock.document.id &&
            Array.isArray(node.values) &&
            node.values.includes('selected-doc')
        )
      ).toBe(true)
      expect(
        hasMockCondition(
          condition,
          (node) => node.type === 'isNull' && node.column === schemaMock.document.connectorId
        )
      ).toBe(true)
      expect(
        hasMockCondition(
          condition,
          (node) =>
            node.type === 'gte' &&
            node.left === schemaMock.document.sourceModifiedAt &&
            node.right instanceof Date &&
            node.right.toISOString() === '2026-09-01T00:00:00.000Z'
        )
      ).toBe(true)
    }
  }

  it.each([handleVectorOnlySearch, handleTagOnlySearch, handleTagAndVectorSearch])(
    'applies the full document scope to vector and tag searches',
    async (search) => {
      await search({
        ...params,
        structuredFilters: [
          { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'launch' },
        ],
      })
      expectScopeOnEveryQuery()
    }
  )

  it('rechecks the same scope while hydrating ranked keyword matches', async () => {
    queueTableRows(schemaMock.embedding, [{ id: 'chunk', keywordRank: 1 }])
    queueTableRows(schemaMock.embedding, [{ id: 'chunk', distance: 0.1 }])
    await executeKeywordSearch({ ...params, query: 'launch' })
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(2)
    expectScopeOnEveryQuery()
  })
})
