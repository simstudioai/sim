/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type KnowledgeAccessProvider,
  type UserAccessScope,
  WORKSPACE_ACCESS_TOKENS,
} from '@/lib/knowledge/access/types'
import { buildTagFilterCondition } from '@/lib/knowledge/documents/tag-filter'
import {
  SearchBudget,
  SearchDeadlineError,
  type SearchExecutor,
} from '@/lib/knowledge/search/budget'
import type { SearchStage } from '@/lib/knowledge/search/diagnostics'
import {
  executeKeywordSearch,
  getStructuredTagFilters,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
  type PermittedDocuments,
  resolvePermittedDocuments,
  retrieveKnowledgeSearch,
  type SearchParams,
  VECTOR_PROBE_DOCUMENT_LIMIT,
  visibleDocumentsQuery,
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

describe('retrieval leg budgets', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([undefined, 3000])(
    'applies vector budget %s without shortening keyword or tag retrieval',
    async (vectorBudgetMs) => {
      resetDbChainMock()
      vi.spyOn(performance, 'now').mockReturnValue(1000)
      const remaining = SearchBudget.prototype.remaining
      const deadlines = new Map<string, number>()
      vi.spyOn(SearchBudget.prototype, 'remaining').mockImplementation(function (
        this: SearchBudget
      ) {
        /** Capped steps like the permitted-document probe carry the leg with a shorter deadline. */
        deadlines.set(this.leg, Math.max(deadlines.get(this.leg) ?? 0, this.deadline))
        return remaining.call(this)
      })
      const access: UserAccessScope = {
        kind: 'user',
        userId: 'user-1',
        tokens: WORKSPACE_ACCESS_TOKENS,
      }
      const params = {
        knowledgeBaseIds: ['knowledge-1'],
        topK: 10,
        access,
        accessProvider: {
          get: async () => access,
          getForConnectors: async () => access,
          getForDocuments: async () => access,
          liveSourceConnectorCondition: async () => null,
        },
        searchMode: 'hybrid' as const,
        vectorBudgetMs,
      }
      await retrieveKnowledgeSearch({
        ...params,
        query: 'release',
        queryVector: { vector: '[1,0]', dimensions: 1536, model: 'text-embedding-3-small' },
      })
      await retrieveKnowledgeSearch({
        ...params,
        structuredFilters: [
          { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'release' },
        ],
      })
      expect(Object.fromEntries(deadlines)).toEqual({
        vector: 1000 + (vectorBudgetMs ?? 8000),
        keyword: 9000,
        tags: 9000,
      })
    }
  )
})

/**
 * The global `drizzle-orm` mock renders `sql` fragments to a `?`-placeholder
 * string via `toSQL()`, so we can assert the exact predicate each filter builds.
 */
function render(condition: unknown) {
  return (condition as { toSQL: () => { sql: string; params: unknown[] } }).toSQL()
}

/** The permitted-document probe is the only statement that reports whether it saturated. */
function isProbeStatement(sql: string) {
  return sql.includes('AS saturated')
}

/** `+ 0` is what keeps the exact ranking off the ANN index, so it also identifies the statement. */
function isExactRanking(sql: string) {
  return sql.includes(') + 0 LIMIT')
}

const statements = () => dbChainMockFns.execute.mock.calls.map(([query]) => render(query))

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

describe('workspace-scoped vector retrieval', () => {
  const access = { kind: 'workspace' as const, tokens: WORKSPACE_ACCESS_TOKENS }
  const getForConnectors = vi.fn<KnowledgeAccessProvider['getForConnectors']>()
  const params: SearchParams = {
    knowledgeBaseIds: ['kb-small'],
    topK: 2,
    access,
    accessProvider: {
      get: async () => access,
      getForConnectors,
      getForDocuments: async () => access,
      liveSourceConnectorCondition: async () => null,
    },
    queryVector: { vector: '[0.1,0.2]', dimensions: 1536, model: 'text-embedding-3-small' },
    distanceThreshold: 1,
  }
  const probe = Array.from({ length: 400 }, (_, index) => ({ id: `probe-${index}` }))
  const candidates = Array.from({ length: 400 }, (_, index) => ({
    id: `candidate-${index}`,
    initial_count: 400,
  }))
  const ranked = [
    {
      id: 'near',
      documentId: 'near-doc',
      connectorId: null,
      liveAuthorizationSource: false,
      distance: 0.1,
    },
    {
      id: 'far',
      documentId: 'far-doc',
      connectorId: null,
      liveAuthorizationSource: false,
      distance: 0.2,
    },
  ]
  let probeRows: Array<{ id: string }>
  let traversedRows: Array<{ id: string; initial_count?: number }>
  let exactRows: Array<{ id: string }>
  let failSettings: unknown
  let failCandidates: unknown

  beforeEach(() => {
    resetDbChainMock()
    getForConnectors.mockReset()
    probeRows = probe
    traversedRows = candidates
    exactRows = probe
    failSettings = undefined
    failCandidates = undefined
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query).sql
      if (statement.includes('hnsw.iterative_scan')) {
        if (failSettings) throw failSettings
        return []
      }
      if (statement.includes('AS visible')) {
        if (failCandidates) throw failCandidates
        return traversedRows
      }
      if (statement.includes('WITH scored_search_candidates')) return ranked
      if (isExactRanking(statement)) return exactRows
      if (isProbeStatement(statement)) return probeRows
      return []
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([handleVectorOnlySearch, handleTagAndVectorSearch])(
    'does not acquire a connection or start SQL after the KB retrieval deadline',
    async (search) => {
      const budget = new SearchBudget('vector', performance.now() - 1)
      expect(
        await search({
          ...params,
          budget,
          structuredFilters: [
            { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'release' },
          ],
        })
      ).toEqual([])
      expect(budget.timedOut).toBe(true)
      expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
      expect(dbChainMockFns.execute).not.toHaveBeenCalled()
    }
  )

  it('rescues an underfilled traversal by ranking the permitted set exactly', async () => {
    traversedRows = ranked
    probeRows = [{ id: 'near-doc' }, { id: 'far-doc' }]
    exactRows = ranked
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await handleVectorOnlySearch(params)).map((row) => row.id)).toEqual(['near', 'far'])
    const exact = statements().find((query) => isExactRanking(query.sql))!
    expect(exact.sql).not.toContain('CROSS JOIN LATERAL')
    expect(JSON.stringify(exact)).toContain('near-doc')
    const probeStatement = statements().find((query) => isProbeStatement(query.sql))!
    expect(probeStatement.sql).not.toContain('<=>')
    expect(probeStatement.params).toContain(VECTOR_PROBE_DOCUMENT_LIMIT + 1)
    expect(JSON.stringify(probeStatement)).toContain('required_clause')
    expect(getForConnectors).not.toHaveBeenCalled()
  })

  it('counts only chunks the search can return when a tag filter decides a document', async () => {
    traversedRows = ranked
    probeRows = [{ id: 'near-doc' }]
    exactRows = ranked
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    await handleTagAndVectorSearch({
      ...params,
      structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'common' }],
    })
    /**
     * A document whose only tagged chunk is disabled contributes no candidate, so admitting it
     * would spend the probe's document bound on a document the ranking then discards.
     */
    const probe = JSON.stringify(statements().find((query) => isProbeStatement(query.sql))!)
    expect(probe).toContain(String(schemaMock.embedding.tag1))
    expect(probe).toContain(`"left":"${schemaMock.embedding.enabled}","right":true`)
  })

  it('keeps the tuple budget an order of magnitude above the beam so the scan can iterate', async () => {
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    await handleVectorOnlySearch(params)
    const settings = statements().find((query) => query.sql.includes('hnsw.iterative_scan'))!
    const [maxScanTuples, efSearch] = settings.params as string[]
    /**
     * `max_scan_tuples` excludes the first beam, so a budget at or below `ef_search` is spent
     * before `ResumeScanItems` can widen anything and the scan never iterates (pgvector#912).
     */
    expect(Number(maxScanTuples)).toBeGreaterThanOrEqual(Number(efSearch) * 10)
    /** A beam is uninterruptible, so its width is also this leg's cancellation floor. */
    expect(Number(efSearch)).toBeLessThanOrEqual(400)
  })

  it('leaves a filled traversal alone instead of probing for an exact ranking', async () => {
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await handleVectorOnlySearch(params)).map((row) => row.id)).toEqual(['near', 'far'])
    expect(statements().filter((query) => isProbeStatement(query.sql))).toHaveLength(0)
    expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(0)
  })

  it('keeps an underfilled traversal when the permitted set is too large to rank exactly', async () => {
    traversedRows = ranked
    probeRows = new Array(VECTOR_PROBE_DOCUMENT_LIMIT + 1).fill({ id: 'doc' })
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await handleVectorOnlySearch(params)).map((row) => row.id)).toEqual(['near', 'far'])
    expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(0)
  })

  it('finishes a scope the probe finds nothing in without ranking anything', async () => {
    traversedRows = []
    probeRows = []
    expect(await handleVectorOnlySearch(params)).toEqual([])
    expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(0)
    expect(
      statements().filter((query) => query.sql.includes('WITH scored_search_candidates'))
    ).toHaveLength(0)
    expect(getForConnectors).not.toHaveBeenCalled()
  })

  it('spends only its own share of the leg on a probe that runs long', async () => {
    const budget = new SearchBudget('vector', performance.now() + 8000)
    traversedRows = ranked
    exactRows = ranked
    const execute = dbChainMockFns.execute.getMockImplementation()!
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query).sql
      if (isProbeStatement(statement))
        throw new Error('canceling statement due to statement timeout', {
          cause: { code: '57014' },
        })
      return execute(query)
    })
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await handleVectorOnlySearch({ ...params, budget })).map((row) => row.id)).toEqual([
      'near',
      'far',
    ])
    expect(budget.timedOut).toBe(false)
    expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(0)
  })

  it('uses compact candidates for a large KB and applies full workspace access before its limit', async () => {
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await handleVectorOnlySearch(params)).map((row) => row.id)).toEqual(['near', 'far'])
    const candidate = statements().find((query) => query.sql.includes('AS visible'))!
    expect(candidate.sql).toContain('CROSS JOIN LATERAL')
    expect(candidate.sql).toContain('LIMIT 1')
    const serialized = JSON.stringify(candidate)
    expect(serialized).toContain('subvector')
    expect(serialized).toContain('required_clause')
    expect(serialized).toContain('credential')
    expect(serialized).toContain('aclVerifiedAt')
    expect(serialized).toContain('accessRewritePending')
    expect(serialized).toContain('organizationSearchIntegration')
    expect(serialized).toContain(String(schemaMock.embeddingSearch.vector512))
    expect(candidate.params).not.toContain(schemaMock.embedding.embedding)
    const rerank = statements().find((query) =>
      query.sql.includes('WITH scored_search_candidates')
    )!
    expect(rerank.sql).toContain('MATERIALIZED')
    expect(JSON.stringify(rerank)).toContain(String(schemaMock.embedding.embedding))
    expect(JSON.stringify(rerank)).toContain('candidate-399')
    expect(JSON.stringify(rerank)).not.toContain('probe-399')
    expect(getForConnectors).not.toHaveBeenCalled()
  })

  it('keeps workspace-authorized sources eligible when hydration needs another page', async () => {
    const initial = Array.from({ length: 20 }, (_, index) => ({
      ...ranked[0],
      id: `initial-${index}`,
      distance: index / 100,
      connectorId: 'workspace-source',
      liveAuthorizationSource: true,
    }))
    const next = { ...initial[1], id: 'next', distance: 0.3 }
    queueTableRows(schemaMock.embedding, initial)
    queueTableRows(schemaMock.embedding, [initial[0]])
    queueTableRows(schemaMock.embedding, [next])
    queueTableRows(schemaMock.embedding, [next])
    const rows = await handleVectorOnlySearch({
      ...params,
      filters: { documentIds: ['near-doc', 'far-doc'] },
    })
    expect(rows.map((row) => row.id)).toEqual(['initial-0', 'next'])
    expect(dbChainMockFns.offset.mock.calls.map(([offset]) => offset)).toEqual([0, 20])
    expect(JSON.stringify(dbChainMockFns.where.mock.calls)).not.toContain('workspace-source')
    expect(getForConnectors).not.toHaveBeenCalled()
  })

  it('fills a single result from the same candidate page when its nearest row loses access', async () => {
    const execute = dbChainMockFns.execute.getMockImplementation()!
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query)
      if (statement.sql.includes('WITH scored_search_candidates')) {
        const limit = Number(statement.params.at(-2))
        const offset = Number(statement.params.at(-1))
        const page = ranked.slice(offset, offset + limit)
        queueTableRows(
          schemaMock.embedding,
          page.filter((row) => row.id !== 'near')
        )
        return page
      }
      return execute(query)
    })

    const rows = await handleVectorOnlySearch({ ...params, topK: 1 })

    expect(rows.map((row) => row.id)).toEqual(['far'])
    expect(statements().filter((query) => query.sql.includes('AS visible'))).toHaveLength(1)
    expect(getForConnectors).not.toHaveBeenCalled()
  })

  it('does not turn a broad tag filter into exhaustive full-vector ranking', async () => {
    queueTableRows(schemaMock.embedding, ranked)
    const rows = await handleTagAndVectorSearch({
      ...params,
      structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'common' }],
    })
    expect(rows.map((row) => row.id)).toEqual(['near', 'far'])
    expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(0)
    const candidate = statements().find((query) => query.sql.includes('AS visible'))!
    expect(JSON.stringify(candidate)).toContain('common')
    expect(JSON.stringify(candidate)).toContain(String(schemaMock.embedding.tag1))
    expect(JSON.stringify(dbChainMockFns.where.mock.calls.at(-1)![0])).toContain('common')
    expect(getForConnectors).not.toHaveBeenCalled()
  })

  it('ranks all selected KBs together instead of capping how many results one KB can contribute', async () => {
    const knowledgeBaseIds = ['kb-1', 'kb-2', 'kb-3', 'kb-4', 'kb-5']
    queueTableRows(
      schemaMock.embedding,
      ranked.map((row) => ({ ...row, knowledgeBaseId: 'kb-1' }))
    )
    const rows = await handleVectorOnlySearch({ ...params, knowledgeBaseIds })
    expect(rows.map((row) => row.id)).toEqual(['near', 'far'])
    expect(rows.every((row) => row.knowledgeBaseId === 'kb-1')).toBe(true)
    const candidateQueries = statements().filter((query) => query.sql.includes('AS visible'))
    expect(candidateQueries).toHaveLength(1)
    for (const id of knowledgeBaseIds) expect(JSON.stringify(candidateQueries[0])).toContain(id)
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })

  it.each(['vector.candidate_search', 'vector.rerank', 'vector.sql'] as const)(
    'reports a %s timeout as partial, not a complete empty search',
    async (failedStage) => {
      const query = SearchBudget.prototype.query
      vi.spyOn(SearchBudget.prototype, 'query').mockImplementation(function <T>(
        this: SearchBudget,
        stage: SearchStage,
        run: (executor: SearchExecutor) => PromiseLike<T>
      ) {
        if (stage === failedStage)
          return Promise.reject(new Error('Statement canceled', { cause: { code: '57014' } }))
        return query.call(this, stage, run) as Promise<T>
      })
      expect(
        await retrieveKnowledgeSearch({ ...params, query: 'fixture policy', searchMode: 'vector' })
      ).toEqual({
        rows: [],
        retrieval: { status: 'partial', timedOutLegs: ['vector'] },
      })
    }
  )

  it('shares the remaining deadline across candidate selection, reranking and hydration', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const query = SearchBudget.prototype.query
    vi.spyOn(SearchBudget.prototype, 'query').mockImplementation(async function <T>(
      this: SearchBudget,
      stage: SearchStage,
      run: (executor: SearchExecutor) => PromiseLike<T>
    ) {
      const result = await (query.bind(this) as SearchBudget['query'])(stage, run)
      if (stage === 'vector.candidate_search') vi.spyOn(performance, 'now').mockReturnValue(60)
      if (stage === 'vector.rerank') vi.spyOn(performance, 'now').mockReturnValue(80)
      return result
    })
    queueTableRows(schemaMock.embedding, ranked)
    await handleVectorOnlySearch({ ...params, budget: new SearchBudget('vector', 100) })
    expect(
      statements()
        .filter((query) => query.sql.includes('statement_timeout'))
        .map((query) => query.params[0])
    ).toEqual(['100', '100', '40', '20'])
  })

  it('does not convert an unexpected candidate failure into partial retrieval', async () => {
    failCandidates = new Error('Connection lost', { cause: { code: '08006' } })
    await expect(
      retrieveKnowledgeSearch({ ...params, query: 'fixture policy', searchMode: 'vector' })
    ).rejects.toBe(failCandidates)
  })

  it('does not treat a missing query object as unsupported scan settings', async () => {
    failCandidates = new Error('Query object is missing', { cause: { code: '42704' } })
    await expect(handleVectorOnlySearch(params)).rejects.toBe(failCandidates)
    failCandidates = undefined
    queueTableRows(schemaMock.embedding, ranked)
    await handleVectorOnlySearch(params)
    expect(statements().filter((query) => query.sql.includes('hnsw.iterative_scan'))).toHaveLength(
      2
    )
  })

  it('retries unsupported settings after cooldown without changing the candidate query', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(0))
    failSettings = new Error('Failed settings query', { cause: { code: '42704' } })
    queueTableRows(schemaMock.embedding, ranked)
    await handleVectorOnlySearch(params)
    queueTableRows(schemaMock.embedding, ranked)
    await handleVectorOnlySearch(params)
    expect(statements().filter((query) => query.sql.includes('hnsw.iterative_scan'))).toHaveLength(
      1
    )
    const queries = statements().filter((query) => query.sql.includes('AS visible'))
    expect(queries).toHaveLength(2)
    expect(JSON.stringify(queries[0])).toBe(JSON.stringify(queries[1]))
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1)
    failSettings = undefined
    queueTableRows(schemaMock.embedding, ranked)
    await handleVectorOnlySearch(params)
    expect(statements().filter((query) => query.sql.includes('hnsw.iterative_scan'))).toHaveLength(
      2
    )
  })

  it('reports incomplete retrieval for 18 expired pool waiters without starting their SQL later', async () => {
    vi.useFakeTimers()
    const release: Array<() => void> = []
    const transactions: Array<Promise<unknown>> = []
    vi.spyOn(db, 'transaction').mockImplementation((callback) => {
      const transaction = new Promise<void>((resolve) => release.push(resolve)).then(() =>
        callback(db as never)
      )
      transactions.push(transaction)
      return transaction as ReturnType<typeof db.transaction>
    })
    const pending = Promise.all(
      Array.from({ length: 18 }, (_, index) =>
        retrieveKnowledgeSearch({
          ...params,
          knowledgeBaseIds: [`kb-${index}`],
          query: 'fixture policy',
          searchMode: 'vector',
          vectorBudgetMs: 50,
        })
      )
    )
    await vi.advanceTimersByTimeAsync(60)
    const results = await pending
    expect(results).toHaveLength(18)
    for (const result of results) {
      expect(result).toEqual({
        rows: [],
        retrieval: { status: 'partial', timedOutLegs: ['vector'] },
      })
    }
    for (const resume of release) resume()
    const settled = await Promise.allSettled(transactions)
    expect(settled).toHaveLength(18)
    for (const transaction of settled) {
      expect(transaction.status).toBe('rejected')
      if (transaction.status === 'rejected')
        expect(transaction.reason).toBeInstanceOf(SearchDeadlineError)
    }
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })
})

describe('workspace search filters before ranking', () => {
  const params: SearchParams = {
    knowledgeBaseIds: ['index'],
    topK: 2,
    access: { kind: 'workspace', tokens: WORKSPACE_ACCESS_TOKENS },
    queryVector: { vector: '[0.1,0.2]', dimensions: 1536, model: 'text-embedding-3-small' },
    distanceThreshold: 0.8,
    filters: {
      documentIds: ['selected-doc'],
      source: 'upload',
      modifiedAfter: '2026-09-01T00:00:00Z',
    },
  }
  beforeEach(() => resetDbChainMock())

  function expectScopeOnEveryQuery() {
    const queries = dbChainMockFns.where.mock.calls
    expect(queries.length).toBeGreaterThan(0)
    for (const [condition] of queries) {
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
      queueTableRows(schemaMock.embedding, [{ id: 'candidate' }])
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

describe('live repository authorization follows ranked candidates', () => {
  const identity: UserAccessScope = {
    kind: 'user',
    userId: 'reader',
    tokens: ['org', 's:github-repositories:-:42'],
  }
  const allowed: UserAccessScope = {
    ...identity,
    githubInstallationGrants: [
      {
        connectorId: 'allowed-source',
        contentCredentialId: 'installation-credential',
        readerCredentialId: 'reader-credential',
        repositoryId: '101',
        readerSubjectToken: 's:github-repositories:-:42',
      },
    ],
  }
  const candidate = (id: string, connectorId: string) => ({
    id,
    documentId: `doc-${id}`,
    connectorId,
    liveAuthorizationSource: true,
    distance: 0.1,
  })
  const getForConnectors = vi.fn<KnowledgeAccessProvider['getForConnectors']>()
  const provider: KnowledgeAccessProvider = {
    get: async () => identity,
    getForConnectors,
    getForDocuments: async () => allowed,
    liveSourceConnectorCondition: async () => null,
  }
  const params: SearchParams = {
    knowledgeBaseIds: ['org-index'],
    topK: 1,
    access: identity,
    accessProvider: provider,
    queryVector: { vector: '[0.1,0.2]', dimensions: 1536, model: 'text-embedding-3-small' },
    distanceThreshold: 0.8,
    structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'release' }],
  }

  const probePages: Array<Array<{ id: string }>> = []
  const exactPages: Array<Array<{ id: string }>> = []
  const candidatePages: Array<Array<{ id: string; initial_count: number }>> = []
  const rerankPages: Array<Array<ReturnType<typeof candidate>>> = []
  const keywordPages: Array<Array<ReturnType<typeof candidate>>> = []
  function queueRerank(rows: Array<ReturnType<typeof candidate>>) {
    rerankPages.push(rows)
  }
  function queueCandidates(rows: Array<{ id: string }>, initialCount = rows.length) {
    candidatePages.push(rows.map(({ id }) => ({ id, initial_count: initialCount })))
  }

  beforeEach(() => {
    resetDbChainMock()
    probePages.length = 0
    exactPages.length = 0
    candidatePages.length = 0
    rerankPages.length = 0
    keywordPages.length = 0
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query).sql
      if (statement.includes('AS visible')) return candidatePages.shift() ?? []
      if (statement.includes('WITH scored_search_candidates')) return rerankPages.shift() ?? []
      if (statement.includes('WITH matched_keyword_chunks')) return keywordPages.shift() ?? []
      if (isExactRanking(statement)) return exactPages.shift() ?? []
      if (isProbeStatement(statement)) return probePages.shift() ?? []
      return []
    })
    getForConnectors.mockReset().mockResolvedValue(allowed)
  })

  afterEach(() => vi.useRealTimers())

  it('bounds broad vector ranking before metadata and reorders relaxed candidates before trimming', async () => {
    probePages.push(
      Array.from({ length: 400 }, (_, index) => candidate(`probe-${index}`, 'allowed-source'))
    )
    queueCandidates(Array.from({ length: 400 }, (_, index) => ({ id: `candidate-${index}` })))
    queueRerank([
      { ...candidate('far', 'allowed-source'), distance: 0.3 },
      { ...candidate('near', 'allowed-source'), distance: 0.1 },
      ...Array.from({ length: 18 }, (_, index) => candidate(`other-${index}`, 'allowed-source')),
    ])
    queueTableRows(schemaMock.embedding, [
      { id: 'far', content: 'Far authorized passage', distance: 0.3 },
      { id: 'near', content: 'Near authorized passage', distance: 0.1 },
    ])
    const rows = await handleVectorOnlySearch({
      ...params,
      structuredFilters: undefined,
      topK: 1,
    })
    expect(rows.map((row) => row.id)).toEqual(['near'])
    const candidateQuery = dbChainMockFns.execute.mock.calls.find(([query]) =>
      render(query).sql.includes('AS visible')
    )![0]
    expect(render(candidateQuery).sql).toContain('CROSS JOIN LATERAL')
    expect(render(candidateQuery).sql).toContain('LIMIT 1')
    expect(JSON.stringify(candidateQuery)).toContain('required_clause')
    expect(JSON.stringify(candidateQuery)).toContain('subvector')
    const rankQuery = dbChainMockFns.execute.mock.calls.find(([query]) =>
      render(query).sql.includes('WITH scored_search_candidates')
    )![0]
    expect(render(rankQuery).sql).toContain('MATERIALIZED')
    expect(getForConnectors).toHaveBeenCalledExactlyOnceWith(['allowed-source'], undefined)
    expect(JSON.stringify(dbChainMockFns.where.mock.calls.at(-1)![0])).toContain(
      'github_read_grant'
    )
  })

  it('finishes a scope the probe finds nothing in without ranking or calling providers', async () => {
    probePages.push([])
    expect(await handleVectorOnlySearch({ ...params, structuredFilters: undefined })).toEqual([])
    const probe = statements().find((query) => isProbeStatement(query.sql))!
    expect(probe.params).toContain(VECTOR_PROBE_DOCUMENT_LIMIT + 1)
    expect(probe.sql).not.toContain('<=>')
    expect(JSON.stringify(probe)).toContain('required_clause')
    expect(
      statements().filter((query) => query.sql.includes('WITH scored_search_candidates'))
    ).toHaveLength(0)
    expect(getForConnectors).not.toHaveBeenCalled()
  })

  it('ranks the permitted set exactly when the traversal comes back underfilled', async () => {
    probePages.push([{ id: 'doc-selected' }])
    exactPages.push([{ id: 'selected' }])
    queueRerank([candidate('selected', 'allowed-source')])
    queueTableRows(schemaMock.embedding, [
      { id: 'selected', content: 'Verified small scope', distance: 0.1 },
    ])
    expect(await handleVectorOnlySearch({ ...params, structuredFilters: undefined })).toEqual([
      { id: 'selected', content: 'Verified small scope', distance: 0.1 },
    ])
    const exact = statements().find((query) => isExactRanking(query.sql))!
    expect(exact.sql).not.toContain('CROSS JOIN LATERAL')
    expect(JSON.stringify(exact)).toContain('doc-selected')
    expect(getForConnectors).toHaveBeenCalledExactlyOnceWith(['allowed-source'], undefined)
  })

  it.each([1, 200, 399])(
    'ranks a permitted set of %s documents exactly without repeating the traversal',
    async (count) => {
      probePages.push(Array.from({ length: count }, (_, index) => ({ id: `doc-${index}` })))
      exactPages.push([{ id: 'chunk-0' }])
      queueRerank([candidate('chunk-0', 'allowed-source')])
      queueTableRows(schemaMock.embedding, [
        { id: 'chunk-0', content: 'Authorized passage', distance: 0.1 },
      ])
      const rows = await handleVectorOnlySearch({ ...params, structuredFilters: undefined })
      expect(rows.map((row) => row.id)).toEqual(['chunk-0'])
      expect(statements().filter((query) => query.sql.includes('AS visible'))).toHaveLength(1)
      expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(1)
    }
  )

  it('keeps an underfilled traversal when the permitted set is past the probe bound', async () => {
    queueCandidates([{ id: 'selected' }], 1)
    probePages.push(
      Array.from({ length: VECTOR_PROBE_DOCUMENT_LIMIT + 1 }, (_, index) => ({
        id: `doc-${index}`,
      }))
    )
    queueRerank([candidate('selected', 'allowed-source')])
    queueTableRows(schemaMock.embedding, [
      { id: 'selected', content: 'Verified fallback', distance: 0.1 },
    ])
    expect(await handleVectorOnlySearch({ ...params, structuredFilters: undefined })).toEqual([
      { id: 'selected', content: 'Verified fallback', distance: 0.1 },
    ])
    const candidateQuery = statements().find((query) => query.sql.includes('AS visible'))!
    /** Widening the scan on underfill is what made this leg exceed its budget on a large corpus. */
    expect(candidateQuery.sql).not.toContain('UNION ALL')
    expect(candidateQuery.sql).not.toContain('filtered_scores')
    expect(candidateQuery.sql).toContain('CROSS JOIN LATERAL')
    expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(0)
    expect(JSON.stringify(dbChainMockFns.where.mock.calls.at(-1)![0])).toContain(
      'github_read_grant'
    )
  })

  it('advances past candidate pages that hydrate no current readable content', async () => {
    const probe = Array.from({ length: 400 }, (_, index) => ({ id: `probe-${index}` }))
    const identities = Array.from({ length: 400 }, (_, index) => ({ id: `candidate-${index}` }))
    probePages.push(probe)
    queueCandidates(identities)
    queueRerank(
      Array.from({ length: 20 }, (_, index) => candidate(`candidate-${index}`, 'allowed-source'))
    )
    queueTableRows(schemaMock.embedding, [])
    probePages.push(probe)
    queueCandidates(identities)
    queueRerank([candidate('selected', 'allowed-source')])
    queueTableRows(schemaMock.embedding, [
      { id: 'selected', content: 'Current readable content', distance: 0.1 },
    ])
    const rows = await handleVectorOnlySearch({ ...params, structuredFilters: undefined })
    expect(rows.map((row) => row.id)).toEqual(['selected'])
    expect(
      dbChainMockFns.execute.mock.calls.filter(([query]) =>
        render(query).sql.includes('WITH scored_search_candidates')
      )
    ).toHaveLength(2)
    expect(getForConnectors).toHaveBeenCalledTimes(2)
  })

  it('sorts hydrated candidates across pages by their original-vector distance', async () => {
    const probe = Array.from({ length: 400 }, (_, index) =>
      candidate(`probe-${index}`, 'allowed-source')
    )
    probePages.push(probe)
    queueCandidates(Array.from({ length: 400 }, (_, index) => ({ id: `candidate-${index}` })))
    queueRerank([
      { ...candidate('far', 'allowed-source'), distance: 0.7 },
      ...Array.from({ length: 19 }, (_, index) => candidate(`hidden-${index}`, 'allowed-source')),
    ])
    queueTableRows(schemaMock.embedding, [{ id: 'far', content: 'Far result', distance: 0.7 }])
    probePages.push(probe)
    queueCandidates(Array.from({ length: 400 }, (_, index) => ({ id: `candidate-${index}` })))
    queueRerank([
      candidate('near', 'allowed-source'),
      candidate('nearer', 'allowed-source'),
      candidate('far', 'allowed-source'),
    ])
    queueTableRows(schemaMock.embedding, [
      { id: 'near', content: 'Near result', distance: 0.2 },
      { id: 'nearer', content: 'Nearest result', distance: 0.1 },
    ])

    const rows = await handleVectorOnlySearch({
      ...params,
      topK: 2,
      structuredFilters: undefined,
    })

    expect(rows.map((row) => row.id)).toEqual(['nearer', 'near'])
    expect(
      dbChainMockFns.execute.mock.calls.filter(([query]) =>
        render(query).sql.includes('WITH scored_search_candidates')
      )
    ).toHaveLength(2)
    expect(
      hasMockCondition(
        dbChainMockFns.where.mock.calls.at(-1)![0],
        (node) =>
          node.type === 'inArray' &&
          node.column === schemaMock.embedding.id &&
          Array.isArray(node.values) &&
          node.values.length === 2 &&
          !node.values.includes('far')
      )
    ).toBe(true)
  })

  it.each(['vector', 'tag-vector', 'tags', 'keyword'] as const)(
    '%s ranks identifiers before verification and loads content under the full predicate',
    async (mode) => {
      const candidates = [candidate('selected', 'allowed-source')]
      if (mode === 'vector' || mode === 'tag-vector') {
        probePages.push([{ id: 'doc-selected' }])
        exactPages.push([{ id: 'selected' }])
        queueRerank(candidates)
      }
      if (mode === 'keyword') keywordPages.push(candidates)
      if (mode === 'tags') queueTableRows(schemaMock.embedding, candidates)
      queueTableRows(schemaMock.embedding, [{ id: 'selected', content: 'verified result' }])
      const rows =
        mode === 'vector'
          ? await handleVectorOnlySearch(params)
          : mode === 'tag-vector'
            ? await handleTagAndVectorSearch(params)
            : mode === 'tags'
              ? await handleTagOnlySearch(params)
              : await executeKeywordSearch({
                  ...params,
                  query: 'release',
                  queryVector: params.queryVector!,
                })
      expect(rows).toEqual([{ id: 'selected', content: 'verified result' }])
      expect(getForConnectors).toHaveBeenCalledWith(['allowed-source'], undefined)
      if (mode === 'keyword') {
        const ranking = render(dbChainMockFns.execute.mock.calls[0][0]).sql
        expect(ranking).toContain('matched_keyword_chunks AS MATERIALIZED')
        expect(ranking).toContain('ORDER BY keyword_rank DESC, matched_keyword_chunks.id')
        expect(ranking).not.toContain('<=>')
        expect(ranking).not.toContain('"content"')
      } else if (mode === 'tags') {
        expect(Object.keys(dbChainMockFns.select.mock.calls[0][0]).sort()).toEqual(
          ['id', 'documentId', 'connectorId', 'liveAuthorizationSource'].sort()
        )
      } else {
        const ranking = statements().find((query) => isExactRanking(query.sql))!
        expect(ranking.sql).toContain('AS id FROM')
        expect(ranking.sql).not.toContain('"content"')
      }
      const rankingOrder =
        mode === 'tags'
          ? dbChainMockFns.select.mock.invocationCallOrder[0]
          : dbChainMockFns.execute.mock.invocationCallOrder[0]
      expect(rankingOrder).toBeLessThan(getForConnectors.mock.invocationCallOrder[0])
      expect(getForConnectors.mock.invocationCallOrder[0]).toBeLessThan(
        dbChainMockFns.select.mock.invocationCallOrder.at(-1)!
      )
      const fullPredicate = dbChainMockFns.where.mock.calls.at(-1)![0]
      const serializedPredicate = JSON.stringify(fullPredicate)
      expect(serializedPredicate).toContain('github_read_grant')
      expect(serializedPredicate).toContain('allowed-source')
      expect(serializedPredicate).toContain('reader-credential')
      expect(
        hasMockCondition(
          fullPredicate,
          (node) =>
            node.type === 'inArray' &&
            node.column === schemaMock.embedding.id &&
            Array.isArray(node.values) &&
            node.values.length === 1 &&
            node.values[0] === 'selected'
        )
      ).toBe(true)
    }
  )

  it.each(['vector', 'tag-vector', 'tags', 'keyword'] as const)(
    '%s skips discovery for an explicit non-GitHub source and retains full hydration',
    async (mode) => {
      getForConnectors.mockResolvedValue(identity)
      const candidates = [{ ...candidate('gmail', 'gmail-source'), installationSource: false }]
      if (mode === 'vector' || mode === 'tag-vector') {
        probePages.push([{ id: 'doc-gmail' }])
        exactPages.push([{ id: 'gmail' }])
        queueRerank(candidates)
      }
      if (mode === 'keyword') keywordPages.push(candidates)
      if (mode === 'tags') queueTableRows(schemaMock.embedding, candidates)
      const hydrated = [{ id: 'gmail', content: 'current permitted content' }]
      queueTableRows(schemaMock.embedding, hydrated)
      const searchParams = { ...params, filters: { source: 'gmail' } }
      const rows =
        mode === 'vector'
          ? await handleVectorOnlySearch(searchParams)
          : mode === 'tag-vector'
            ? await handleTagAndVectorSearch(searchParams)
            : mode === 'tags'
              ? await handleTagOnlySearch(searchParams)
              : await executeKeywordSearch({
                  ...searchParams,
                  query: 'release',
                  queryVector: searchParams.queryVector!,
                })

      expect(rows).toEqual(hydrated)
      expect(getForConnectors).toHaveBeenCalledExactlyOnceWith([], undefined)
      for (const [condition] of dbChainMockFns.where.mock.calls) {
        expect(JSON.stringify(condition)).toContain('gmail')
      }
      if (mode === 'keyword') {
        expect(JSON.stringify(dbChainMockFns.execute.mock.calls[0][0])).toContain('gmail')
      }
      const hydration = JSON.stringify(dbChainMockFns.where.mock.calls.at(-1)![0])
      expect(hydration).toContain('acl')
      expect(hydration).toContain('knowledgeConnectorMember')
      /** Vector ranking is raw SQL throughout; only hydration reads through the query builder. */
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(mode === 'tags' ? 2 : 1)
    }
  )

  it.each([undefined, '', 'github'])(
    'retains discovery for classic GitHub when source is %s',
    async (source) => {
      queueTableRows(schemaMock.embedding, [
        { ...candidate('selected', 'allowed-source'), installationSource: false },
        { ...candidate('second', 'allowed-source'), installationSource: false },
      ])
      queueTableRows(schemaMock.embedding, [{ id: 'selected', content: 'verified result' }])

      expect(await handleTagOnlySearch({ ...params, filters: { source } })).toEqual([
        { id: 'selected', content: 'verified result' },
      ])
      expect(getForConnectors).toHaveBeenCalledExactlyOnceWith(['allowed-source'], undefined)
      expect(JSON.stringify(dbChainMockFns.where.mock.calls[1][0])).toContain('github_read_grant')
    }
  )

  it('retains every connector in unfiltered mixed pages', async () => {
    queueTableRows(schemaMock.embedding, [
      { ...candidate('gmail', 'gmail-source'), installationSource: false },
      { ...candidate('classic', 'classic-source'), installationSource: false },
      candidate('selected', 'allowed-source'),
      candidate('selected-second-chunk', 'allowed-source'),
      { ...candidate('upload', 'unused'), connectorId: null, installationSource: false },
    ])
    queueTableRows(schemaMock.embedding, [{ id: 'selected', content: 'verified result' }])

    expect(await handleTagOnlySearch(params)).toEqual([
      { id: 'selected', content: 'verified result' },
    ])
    expect(getForConnectors).toHaveBeenCalledExactlyOnceWith(
      ['gmail-source', 'classic-source', 'allowed-source'],
      undefined
    )
  })

  it('refills after a denied repository instead of letting its matches consume the result limit', async () => {
    getForConnectors.mockResolvedValueOnce(identity)
    queueTableRows(schemaMock.embedding, [candidate('denied', 'revoked-source')])
    queueTableRows(schemaMock.embedding, [])
    queueTableRows(schemaMock.embedding, [candidate('selected', 'allowed-source')])
    queueTableRows(schemaMock.embedding, [{ id: 'selected', content: 'verified result' }])
    const rows = await handleTagOnlySearch(params)
    expect(rows).toEqual([{ id: 'selected', content: 'verified result' }])
    expect(getForConnectors.mock.calls.map(([ids]) => ids)).toEqual([
      ['revoked-source'],
      ['allowed-source'],
    ])
    expect(dbChainMockFns.offset.mock.calls).toEqual([[0], [0]])
    const refillPredicate = JSON.stringify(dbChainMockFns.where.mock.calls[2][0])
    expect(refillPredicate).toContain('NOT')
    expect(refillPredicate).toContain('revoked-source')
  })

  it('matches keyword chunks before the visibility predicate and ranks only what survives it', async () => {
    keywordPages.push([candidate('selected', 'allowed-source')])
    queueTableRows(schemaMock.embedding, [{ id: 'selected', content: 'verified result' }])
    await executeKeywordSearch({ ...params, query: 'release', queryVector: params.queryVector! })
    const ranking = render(dbChainMockFns.execute.mock.calls[0][0]).sql
    const matched = ranking.indexOf('matched_keyword_chunks AS MATERIALIZED')
    const visible = ranking.indexOf('visible_keyword_documents AS MATERIALIZED')
    expect(matched).toBeGreaterThanOrEqual(0)
    expect(visible).toBeGreaterThan(matched)
    expect(ranking.slice(matched, visible)).not.toContain('keyword_rank')
    expect(ranking.slice(visible)).toContain('FROM matched_keyword_chunks INNER JOIN')
    /** The predicate fragments are parameterized, so the restriction is read off the query tree. */
    const fragments = JSON.stringify(dbChainMockFns.execute.mock.calls[0][0])
    expect(fragments).toContain('= ANY (ARRAY(SELECT document_id FROM matched_keyword_chunks))')
  })

  it('drops an excluded source from the bounded permitted set on refill', async () => {
    getForConnectors.mockResolvedValueOnce(identity)
    keywordPages.push(
      [candidate('denied', 'revoked-source')],
      [candidate('selected', 'allowed-source')]
    )
    queueTableRows(schemaMock.embedding, [])
    queueTableRows(schemaMock.embedding, [{ id: 'selected', content: 'verified result' }])
    await executeKeywordSearch({
      ...params,
      query: 'release',
      queryVector: params.queryVector!,
      permitted: {
        kind: 'bounded',
        documents: [
          { id: 'doc-denied', connectorId: 'revoked-source' },
          { id: 'doc-selected', connectorId: 'allowed-source' },
          { id: 'doc-uploaded', connectorId: null },
        ],
      },
    })
    const [first, refill] = dbChainMockFns.execute.mock.calls.map(([query]) =>
      JSON.stringify(query)
    )
    expect(first).toContain('doc-denied')
    expect(refill).not.toContain('doc-denied')
    expect(refill).toContain('doc-selected')
    expect(refill).toContain('doc-uploaded')
  })

  it('recomputes keyword candidates after excluding a revoked source and rechecks content access', async () => {
    getForConnectors.mockResolvedValueOnce(identity)
    keywordPages.push(
      [candidate('denied', 'revoked-source')],
      [candidate('selected', 'allowed-source')]
    )
    queueTableRows(schemaMock.embedding, [])
    queueTableRows(schemaMock.embedding, [{ id: 'selected', content: 'verified result' }])
    expect(
      await executeKeywordSearch({ ...params, query: 'release', queryVector: params.queryVector! })
    ).toEqual([{ id: 'selected', content: 'verified result' }])
    expect(getForConnectors.mock.calls.map(([ids]) => ids)).toEqual([
      ['revoked-source'],
      ['allowed-source'],
    ])
    const refill = JSON.stringify(dbChainMockFns.execute.mock.calls[1][0])
    expect(refill).toContain('revoked-source')
    expect(refill).toContain('NOT')
    expect(JSON.stringify(dbChainMockFns.where.mock.calls.at(-1)![0])).toContain(
      'github_read_grant'
    )
  })

  it.each([undefined, 'confluence'])(
    'refills a denied Confluence site under its exact reader proof with source filter %s',
    async (source) => {
      getForConnectors.mockResolvedValueOnce(identity).mockResolvedValueOnce({
        ...identity,
        confluenceSiteGrants: [
          {
            connectorId: 'allowed-site',
            contentCredentialId: 'crawler',
            readerCredentialId: 'confluence-reader',
            readerSubjectToken: 's:confluence:-:alice',
            domain: 'company.atlassian.net',
            cloudId: 'cloud-1',
          },
        ],
      })
      queueTableRows(schemaMock.embedding, [candidate('denied', 'revoked-site')])
      queueTableRows(schemaMock.embedding, [])
      queueTableRows(schemaMock.embedding, [candidate('selected', 'allowed-site')])
      queueTableRows(schemaMock.embedding, [
        { id: 'selected', content: 'authorized Confluence page' },
      ])
      expect(await handleTagOnlySearch({ ...params, filters: { source } })).toEqual([
        { id: 'selected', content: 'authorized Confluence page' },
      ])
      expect(getForConnectors.mock.calls.map(([ids]) => ids)).toEqual([
        ['revoked-site'],
        ['allowed-site'],
      ])
      expect(dbChainMockFns.offset.mock.calls).toEqual([[0], [0]])
      expect(JSON.stringify(dbChainMockFns.where.mock.calls[2][0])).toContain('revoked-site')
      const readPredicate = JSON.stringify(dbChainMockFns.where.mock.calls[3][0])
      expect(readPredicate).toContain('confluence_read_grant')
      expect(readPredicate).toContain('confluence-reader')
      expect(readPredicate).toContain('company.atlassian.net')
    }
  )
  it('retains a completed authorized result when the next candidate page exhausts its deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(10000))
    getForConnectors.mockImplementation(async () => {
      vi.setSystemTime(new Date(19000))
      return allowed
    })
    queueTableRows(schemaMock.embedding, [
      candidate('selected', 'allowed-source'),
      candidate('slow', 'slow-source'),
    ])
    queueTableRows(schemaMock.embedding, [{ id: 'selected', content: 'verified result' }])
    expect(await handleTagOnlySearch({ ...params, topK: 2 })).toEqual([
      { id: 'selected', content: 'verified result' },
    ])
    expect(getForConnectors).toHaveBeenCalledOnce()
  })

  it.each([undefined, 'gmail'])(
    'propagates caller cancellation before hydration with source %s',
    async (source) => {
      const cancellation = new AbortController()
      getForConnectors.mockImplementation(async () => {
        cancellation.abort(new Error('Search cancelled'))
        return allowed
      })
      queueTableRows(schemaMock.embedding, [candidate('selected', 'allowed-source')])
      await expect(
        handleTagOnlySearch({ ...params, filters: { source }, signal: cancellation.signal })
      ).rejects.toThrow('Search cancelled')
      expect(getForConnectors).toHaveBeenCalledExactlyOnceWith(
        source ? [] : ['allowed-source'],
        cancellation.signal
      )
      expect(dbChainMockFns.select).toHaveBeenCalledOnce()
    }
  )
})

describe('permitted-document planner', () => {
  const reader: UserAccessScope = {
    kind: 'user',
    userId: 'reader',
    tokens: ['u:reader@example.com'],
  }
  const workspace = { kind: 'workspace' as const, tokens: WORKSPACE_ACCESS_TOKENS }
  const provider: KnowledgeAccessProvider = {
    get: async () => reader,
    getForConnectors: async () => reader,
    getForDocuments: async () => reader,
    liveSourceConnectorCondition: async () => null,
  }
  const params: SearchParams = {
    knowledgeBaseIds: ['org-index'],
    topK: 1,
    access: reader,
    accessProvider: provider,
    queryVector: { vector: '[0.1,0.2]', dimensions: 1536, model: 'text-embedding-3-small' },
    distanceThreshold: 1,
  }
  const hit = (id: string, connectorId: string | null) => ({
    id,
    documentId: `doc-${id}`,
    connectorId,
    liveAuthorizationSource: false,
    distance: 0.1,
  })
  const bounded = (
    ...documents: Array<{ id: string; connectorId: string | null }>
  ): PermittedDocuments => ({ kind: 'bounded', documents })

  let probeRows: Array<{ id: string | null; connectorId: string | null; saturated: boolean }>
  let exactRows: Array<{ id: string }>
  let traversedRows: Array<{ id: string }>
  let rerankRows: Array<ReturnType<typeof hit>>

  beforeEach(() => {
    resetDbChainMock()
    probeRows = []
    exactRows = []
    traversedRows = []
    rerankRows = []
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query).sql
      if (statement.includes('AS visible')) return traversedRows
      if (statement.includes('WITH scored_search_candidates')) return rerankRows
      if (isExactRanking(statement)) return exactRows
      if (isProbeStatement(statement)) return probeRows
      return []
    })
  })

  it('ranks a bounded permitted set exactly without walking the graph', async () => {
    exactRows = [{ id: 'a' }]
    rerankRows = [hit('a', null)]
    queueTableRows(schemaMock.embedding, [hit('a', null)])
    const results = await handleVectorOnlySearch({
      ...params,
      permitted: bounded({ id: 'doc-a', connectorId: null }, { id: 'doc-b', connectorId: 'src' }),
    })
    expect(results.map((row) => row.id)).toEqual(['a'])
    const sqls = statements().map((query) => query.sql)
    expect(sqls.some((sql) => sql.includes('hnsw.iterative_scan'))).toBe(false)
    expect(sqls.some((sql) => sql.includes('AS visible'))).toBe(false)
    expect(sqls.some(isProbeStatement)).toBe(false)
    const exact = JSON.stringify(statements().find((query) => isExactRanking(query.sql)))
    expect(exact).toContain('doc-a')
    expect(exact).toContain('doc-b')
  })

  it('ranks nothing when the bounded permitted set is empty', async () => {
    expect(await handleVectorOnlySearch({ ...params, permitted: bounded() })).toEqual([])
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })

  it('does not probe again after an underfilled walk of an unbounded permitted set', async () => {
    traversedRows = [{ id: 'a' }]
    rerankRows = [hit('a', null)]
    queueTableRows(schemaMock.embedding, [hit('a', null)])
    await handleVectorOnlySearch({ ...params, permitted: { kind: 'unbounded' } })
    const sqls = statements().map((query) => query.sql)
    expect(sqls.some((sql) => sql.includes('AS visible'))).toBe(true)
    expect(sqls.some(isProbeStatement)).toBe(false)
    expect(sqls.some(isExactRanking)).toBe(false)
  })

  it('confines keyword matching to the bounded permitted set', async () => {
    await executeKeywordSearch({
      ...params,
      topK: 1,
      query: 'release',
      queryVector: params.queryVector!,
      permitted: bounded({ id: 'doc-a', connectorId: null }),
    })
    const keyword = statements().find((query) => query.sql.includes('WITH matched_keyword_chunks'))!
    /** The mock renders the whole WHERE as one parameter, so the restriction shows up in it. */
    expect(JSON.stringify(keyword)).toContain('doc-a')
  })

  it('skips keyword SQL entirely when nothing is permitted', async () => {
    expect(
      await executeKeywordSearch({
        ...params,
        query: 'release',
        queryVector: params.queryVector!,
        permitted: bounded(),
      })
    ).toEqual([])
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })

  it('reads a user scope through its reachable documents and reports saturation', () => {
    const user = render(visibleDocumentsQuery(['org-index'], [], reader))
    const userSql = user.sql
    expect(userSql).toContain('WITH reach AS MATERIALIZED')
    expect(userSql).toContain('reachable AS MATERIALIZED')
    expect(userSql).toContain('FROM reachable AS')
    expect(userSql).toContain('AS saturated')
    /**
     * Baseline tokens reach every tenant's org-wide, public, and uploaded documents, so both the
     * count and the rows are confined to the requested bases, outside the fence around the index.
     */
    const [reach, reachable] = userSql.split('reachable AS MATERIALIZED')
    for (const cte of [reach, reachable.split('FROM reachable AS')[0]]) {
      expect(cte).toMatch(/OFFSET 0\s*\) AS \?\s*WHERE \?/)
    }
    expect(JSON.stringify(user.params)).toContain('org-index')
    const workspaceSql = render(visibleDocumentsQuery(['org-index'], [], workspace)).sql
    expect(workspaceSql).not.toContain('reachable')
    expect(workspaceSql).toContain('AS saturated')
  })

  it.each([
    [[{ id: null, connectorId: null, saturated: true }], 'unbounded'],
    [[{ id: 'doc-a', connectorId: null, saturated: false }], 'bounded'],
  ] as const)('resolves %j as %s', async (rows, kind) => {
    probeRows = [...rows]
    const permitted = await resolvePermittedDocuments({
      knowledgeBaseIds: ['org-index'],
      access: reader,
    })
    expect(permitted.kind).toBe(kind)
    if (permitted.kind === 'bounded')
      expect(permitted.documents).toEqual([{ id: 'doc-a', connectorId: null }])
  })

  it('reports an exhausted vector budget as unbounded instead of failing both legs', async () => {
    const budget = new SearchBudget('vector', performance.now() - 1)
    const permitted = await resolvePermittedDocuments({
      knowledgeBaseIds: ['org-index'],
      access: reader,
      budget,
    })
    expect(permitted.kind).toBe('unbounded')
    expect(budget.timedOut).toBe(true)
  })

  it('resolves the permitted set once, before both legs, for live user scopes only', async () => {
    const search = {
      knowledgeBaseIds: ['org-index'],
      topK: 1,
      searchMode: 'hybrid' as const,
      query: 'release',
      queryVector: params.queryVector!,
    }
    await retrieveKnowledgeSearch({ ...search, access: reader, accessProvider: provider })
    /** Budgeted statements open with their transaction's `set_config`; the SQL that follows is ordered. */
    const userSqls = statements()
      .map((query) => query.sql)
      .filter((sql) => !sql.includes('set_config'))
    expect(isProbeStatement(userSqls[0])).toBe(true)
    expect(userSqls.filter(isProbeStatement)).toHaveLength(1)

    resetDbChainMock()
    dbChainMockFns.execute.mockImplementation(async () => [])
    await retrieveKnowledgeSearch({
      ...search,
      access: reader,
      accessProvider: provider,
      filters: { documentIds: ['doc-a'] },
    })
    expect(statements().some((query) => isProbeStatement(query.sql))).toBe(false)
  })
})
