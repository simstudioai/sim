import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveTinKeywordQuery } = vi.hoisted(() => ({
  mockResolveTinKeywordQuery: vi.fn<() => Promise<string | null>>(async () => null),
}))

vi.mock('@/lib/knowledge/search/tin-keyword', () => ({
  resolveTinKeywordQuery: mockResolveTinKeywordQuery,
}))

import {
  type KnowledgeAccessProvider,
  type UserAccessScope,
  WORKSPACE_ACCESS_TOKENS,
} from '@/lib/knowledge/access/types'
import { SearchBudget, type SearchExecutor } from '@/lib/knowledge/search/budget'
import type { SearchStage } from '@/lib/knowledge/search/diagnostics'
import {
  executeKeywordSearch,
  forgetProjectionFilled,
  forgetSearchReach,
  fuseByReciprocalRank,
  getStructuredTagFilters,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
  PERMITTED_EXACT_DOCUMENT_LIMIT,
  type PermittedDocuments,
  resolvePermittedDocuments,
  resolveReach,
  retrieveKnowledgeSearch,
  type SearchParams,
  type SearchResult,
  VECTOR_PROBE_DOCUMENT_LIMIT,
  vectorCandidatePoolLimit,
  visibleDocumentsQuery,
} from '@/lib/knowledge/search/queries'
import { RRF_K } from '@/lib/knowledge/search/recency'
import { forgetIndexedVectorSources } from '@/lib/knowledge/search/source-vector-indexes'
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

/** The projection-fill memo outlives a test; every case starts without one. */
beforeEach(() => forgetProjectionFilled())

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
/** The permitted-documents probe: the reach count and the saturation sentinel, never a slice. */
function isProbeStatement(sql: string) {
  return sql.includes('AS saturated') && !sql.includes('readable_chunks')
}

/** A graph walk: visibility joined per visited row, or decided on the row it visits. */
function isWalk(sql: string) {
  return sql.includes('AS visible') || sql.includes('on-row visibility')
}

/** `+ 0` is what keeps the exact ranking off the ANN index, so it also identifies the statement. */
function isExactRanking(sql: string) {
  return sql.includes(') + 0 LIMIT')
}

/** The page read: a slice of the pool's identities, from the projection and its documents. */
function isPageStatement(sql: string) {
  return (
    sql.includes('AS "connectorId"') && sql.includes('= ANY(') && !sql.includes('ranked_tin_chunks')
  )
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
  })

  /**
   * The callers spread the returned conditions into `and(...)`, so one condition
   * per filter is what makes the whole array conjunctive. Grouping same-slot
   * filters into a single OR'd condition made search answer an impossible
   * predicate with a full page while the document list, which ANDs the same
   * filters, answered with nothing.
   */
  describe('every filter is a conjunct, including two naming the same tag', () => {
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
      distance: 0.1,
    },
    {
      id: 'far',
      documentId: 'far-doc',
      connectorId: null,
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
      /** The fixtures model the page read, which only an unfilled projection makes. */
      if (statement.includes('AS unfilled')) return [{ unfilled: true }]
      if (statement.includes('hnsw.iterative_scan')) {
        if (failSettings) throw failSettings
        return []
      }
      if (statement.includes('AS visible')) {
        if (failCandidates) throw failCandidates
        return traversedRows
      }
      if (isPageStatement(statement)) return ranked
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

  it('keeps an underfilled traversal when the permitted set is too large to rank exactly', async () => {
    traversedRows = ranked
    probeRows = new Array(VECTOR_PROBE_DOCUMENT_LIMIT + 1).fill({ id: 'doc' })
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await handleVectorOnlySearch(params)).map((row) => row.id)).toEqual(['near', 'far'])
    expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(0)
  })

  it('spends only its own share of the leg on a probe that runs long', async () => {
    const budget = new SearchBudget('vector', performance.now() + 8000)
    traversedRows = ranked
    exactRows = ranked
    const execute = dbChainMockFns.execute.getMockImplementation()!
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query).sql
      /** The fixtures model the page read, which only an unfilled projection makes. */
      if (statement.includes('AS unfilled')) return [{ unfilled: true }]
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

  it('walks for a pool sized to the page, and scores the page on the original vectors', async () => {
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    await handleVectorOnlySearch(params)
    const walk = statements().find((query) => isWalk(query.sql))!
    /** The page is the walk's order, so the walk ends at a page's worth of candidates, not a rerank's. */
    expect(walk.params).toContain(200)
    expect(walk.params).not.toContain(1600)
    /** The hydrated page is scored on the original vector; the threshold stays on the projection. */
    const fields = JSON.stringify(dbChainMockFns.select.mock.calls[0][0])
    expect(fields).toContain(String(schemaMock.embedding.embedding))
    expect(JSON.stringify(dbChainMockFns.where.mock.calls)).toContain(
      String(schemaMock.embeddingSearch.vector512)
    )
    expect(JSON.stringify(dbChainMockFns.leftJoin.mock.calls)).toContain('embeddingSearch')
    /** The source card's name, URL and connector type ride on the same read; no second pass. */
    expect(fields).toContain(String(schemaMock.document.filename))
    expect(fields).toContain(String(schemaMock.knowledgeConnector.connectorType))
    expect(JSON.stringify(dbChainMockFns.leftJoin.mock.calls)).toContain('knowledgeConnector')
  })

  it('passes over a slice whose documents went away instead of ending the pool there', async () => {
    const execute = dbChainMockFns.execute.getMockImplementation()!
    let pages = 0
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query)
      /** The first slice's documents are gone; the next slice still has the readable rows. */
      if (isPageStatement(statement.sql)) return pages++ === 0 ? [] : ranked
      return execute(query)
    })
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await handleVectorOnlySearch(params)).map((row) => row.id)).toEqual(['near', 'far'])
    expect(pages).toBe(2)
    expect(statements().filter((query) => isWalk(query.sql))).toHaveLength(1)
  })

  it('sizes the pool to the pages asked for, doubling a pool the pages outran', () => {
    expect(vectorCandidatePoolLimit(20, undefined)).toBe(200)
    expect(vectorCandidatePoolLimit(150, undefined)).toBe(300)
    expect(vectorCandidatePoolLimit(210, 200)).toBe(420)
    expect(vectorCandidatePoolLimit(5000, 1600)).toBe(1600)
  })

  it('uses compact candidates for a large KB and applies full workspace access before its limit', async () => {
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await handleVectorOnlySearch(params)).map((row) => row.id)).toEqual(['near', 'far'])
    const candidate = statements().find((query) => isWalk(query.sql))!
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
    /** The page is the ranking's own order; nothing rescores it against the original vectors. */
    const page = statements().find((query) => isPageStatement(query.sql))!
    expect(page.sql).not.toContain('MATERIALIZED')
    expect(JSON.stringify(page)).not.toContain(String(schemaMock.embedding.embedding))
    expect(JSON.stringify(page)).toContain('candidate-0')
    expect(JSON.stringify(page)).not.toContain('probe-')
    expect(getForConnectors).not.toHaveBeenCalled()
  })

  it('fills a single result from the same candidate page when its nearest row loses access', async () => {
    const execute = dbChainMockFns.execute.getMockImplementation()!
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query)
      if (statement.sql.includes('AS unfilled')) return [{ unfilled: true }]
      if (isPageStatement(statement.sql)) {
        queueTableRows(
          schemaMock.embedding,
          ranked.filter((row) => row.id !== 'near')
        )
        return ranked
      }
      return execute(query)
    })

    const rows = await handleVectorOnlySearch({ ...params, topK: 1 })

    expect(rows.map((row) => row.id)).toEqual(['far'])
    expect(statements().filter((query) => isWalk(query.sql))).toHaveLength(1)
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
    const candidate = statements().find((query) => isWalk(query.sql))!
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
    const candidateQueries = statements().filter((query) => isWalk(query.sql))
    expect(candidateQueries).toHaveLength(1)
    for (const id of knowledgeBaseIds) expect(JSON.stringify(candidateQueries[0])).toContain(id)
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })

  it.each(['vector.candidate_search', 'vector.page', 'vector.sql'] as const)(
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
      if (stage === 'vector.page') vi.spyOn(performance, 'now').mockReturnValue(80)
      return result
    })
    queueTableRows(schemaMock.embedding, ranked)
    await handleVectorOnlySearch({ ...params, budget: new SearchBudget('vector', 100) })
    expect(
      statements()
        .filter((query) => query.sql.includes('statement_timeout'))
        .map((query) => query.params[0])
    ).toEqual(['100', '40', '20'])
  })

  it('does not convert an unexpected candidate failure into partial retrieval', async () => {
    failCandidates = new Error('Connection lost', { cause: { code: '08006' } })
    await expect(
      retrieveKnowledgeSearch({ ...params, query: 'fixture policy', searchMode: 'vector' })
    ).rejects.toBe(failCandidates)
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
  beforeEach(() => {
    resetDbChainMock()
  })

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
})

describe('hydration follows ranked candidates', () => {
  const identity: UserAccessScope = {
    kind: 'user',
    userId: 'reader',
    tokens: ['org', 's:github-repositories:-:42'],
  }
  const candidate = (id: string, connectorId: string) => ({
    id,
    documentId: `doc-${id}`,
    connectorId,
    distance: 0.1,
  })
  const provider: KnowledgeAccessProvider = {
    get: async () => identity,
    getForConnectors: async () => identity,
    getForDocuments: async () => identity,
    liveSourceConnectorCondition: async () => null,
  }
  const params: SearchParams = {
    knowledgeBaseIds: ['org-index'],
    searchIndexOnly: true,
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
      /** The fixtures model the page read, which only an unfilled projection makes. */
      if (statement.includes('AS unfilled')) return [{ unfilled: true }]
      if (statement.includes('AS visible')) return candidatePages.shift() ?? []
      if (isPageStatement(statement)) return rerankPages.shift() ?? []
      if (statement.includes('WITH matched_keyword_chunks')) return keywordPages.shift() ?? []
      if (isExactRanking(statement)) return exactPages.shift() ?? []
      if (isProbeStatement(statement)) return probePages.shift() ?? []
      return []
    })
  })

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
    const pageQuery = dbChainMockFns.execute.mock.calls.find(([query]) =>
      isPageStatement(render(query).sql)
    )![0]
    expect(JSON.stringify(pageQuery)).not.toContain(String(schemaMock.embedding.embedding))
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
      dbChainMockFns.execute.mock.calls.filter(([query]) => isPageStatement(render(query).sql))
    ).toHaveLength(2)
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
      dbChainMockFns.execute.mock.calls.filter(([query]) => isPageStatement(render(query).sql))
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
      if (mode === 'keyword') {
        const ranking = render(dbChainMockFns.execute.mock.calls[0][0]).sql
        expect(ranking).toContain('matched_keyword_chunks AS MATERIALIZED')
        expect(ranking).toContain('ORDER BY keyword_rank DESC, matched_keyword_chunks.id')
        expect(ranking).not.toContain('<=>')
        expect(ranking).not.toContain('"content"')
      } else if (mode === 'tags') {
        expect(Object.keys(dbChainMockFns.select.mock.calls[0][0]).sort()).toEqual(
          ['id', 'documentId', 'connectorId'].sort()
        )
      } else {
        const ranking = statements().find((query) => isExactRanking(query.sql))!
        /** The identities are one nested fragment; the mock renders it into the parameters. */
        expect(JSON.stringify(ranking)).toContain('connectorId')
        expect(ranking.sql).not.toContain('"content"')
      }
      const rankingOrder =
        mode === 'tags'
          ? dbChainMockFns.select.mock.invocationCallOrder[0]
          : dbChainMockFns.execute.mock.invocationCallOrder[0]
      expect(rankingOrder).toBeLessThan(dbChainMockFns.select.mock.invocationCallOrder.at(-1)!)
      const fullPredicate = dbChainMockFns.where.mock.calls.at(-1)![0]
      expect(JSON.stringify(fullPredicate)).toContain('acl')
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

  it.each([undefined, 'gmail'])(
    'propagates caller cancellation before ranking with source %s',
    async (source) => {
      const cancellation = new AbortController()
      cancellation.abort(new Error('Search cancelled'))
      queueTableRows(schemaMock.embedding, [candidate('selected', 'allowed-source')])
      await expect(
        handleTagOnlySearch({ ...params, filters: { source }, signal: cancellation.signal })
      ).rejects.toThrow('Search cancelled')
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
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
    searchIndexOnly: true,
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
    distance: 0.1,
  })
  const bounded = (
    ...documents: Array<{ id: string; connectorId: string | null }>
  ): PermittedDocuments => ({ kind: 'bounded', documents })

  let probeRows: Array<{ id: string | null; connectorId: string | null; saturated: boolean }>
  let exactRows: Array<{ id: string }>
  let traversedRows: Array<{ id: string; distance?: number }>
  let rerankRows: Array<ReturnType<typeof hit>>
  let indexedSourceRows: Array<{ name: string; connectorId: string }>
  let sourceExactRows: Array<{ id: string; distance: number }>

  beforeEach(() => {
    resetDbChainMock()
    probeRows = []
    exactRows = []
    traversedRows = []
    rerankRows = []
    sourceExactRows = []
    indexedSourceRows = []
    forgetIndexedVectorSources()
    forgetSearchReach()
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query).sql
      /** The fixtures model the page read, which only an unfilled projection makes. */
      if (statement.includes('AS unfilled')) return [{ unfilled: true }]
      if (statement.includes('pg_index')) return indexedSourceRows
      if (isWalk(statement)) return traversedRows
      if (isPageStatement(statement)) return rerankRows
      if (statement.includes('WITH readable_chunks')) return sourceExactRows
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

  it('walks the whole graph once for a caller whose reach is broad', async () => {
    const eligibility = { workspace: [], admin: ['other-src'], members: ['member-src'] }
    indexedSourceRows = [{ name: 'idx', connectorId: 'member-src' }]
    /** A full pool: the walk found as many readable neighbours as it was asked for. */
    traversedRows = Array.from({ length: 400 }, (_, i) => ({ id: `walked-${i}`, distance: 0.2 }))
    rerankRows = [hit('walked-0', 'member-src')]
    queueTableRows(schemaMock.embedding, rerankRows)
    await handleVectorOnlySearch({
      ...params,
      permitted: { kind: 'unbounded', broad: true },
      accessPlan: {
        connectors: eligibility,
        observers: { confirmed: [{ id: 'm-1', connectorId: 'member-src' }], observed: [] },
        memberSources: ['member-src'],
        connectorTypes: new Map(),
        uploads: true,
      },
    })
    /** One walk over every source, scoped to the bases alone — no source is singled out. */
    const walks = statements().filter((query) => isWalk(query.sql))
    expect(walks).toHaveLength(1)
    expect(JSON.stringify(walks[0])).not.toContain('"right":"member-src"')
    expect(statements().some((query) => query.sql.includes('WITH readable_chunks'))).toBe(false)
  })

  it('walks an indexed source a bounded caller is a member of instead of ranking it exactly', async () => {
    const eligibility = { workspace: [], admin: ['small-src'], members: ['member-src'] }
    indexedSourceRows = [{ name: 'idx', connectorId: 'member-src' }]
    sourceExactRows = [{ id: 'small-hit', distance: 0.3, saturated: false }]
    traversedRows = [{ id: 'walked-hit', distance: 0.2 }]
    rerankRows = [hit('walked-hit', 'member-src'), hit('small-hit', 'small-src')]
    queueTableRows(schemaMock.embedding, rerankRows)
    await handleVectorOnlySearch({
      ...params,
      topK: 2,
      permitted: bounded(
        { id: 'doc-a', connectorId: 'member-src' },
        { id: 'doc-b', connectorId: 'small-src' }
      ),
      accessPlan: {
        connectors: eligibility,
        observers: { confirmed: [{ id: 'm-1', connectorId: 'member-src' }], observed: [] },
        memberSources: ['member-src'],
        connectorTypes: new Map(),
        uploads: true,
      },
    })
    const walks = statements().filter((query) => isWalk(query.sql))
    expect(walks).toHaveLength(1)
    expect(JSON.stringify(walks[0])).toContain('"right":"member-src"')
    expect(statements().some((q) => isExactRanking(q.sql))).toBe(false)
  })

  it('walks the sliced sources when more documents are readable than one ranking may enumerate', async () => {
    const eligibility = { workspace: [], admin: ['sliced-src'], members: [] }
    /** The slice enumerates in no order, so a saturated one would rank an arbitrary subset. */
    sourceExactRows = [{ id: 'arbitrary-hit', distance: 0.4, saturated: true }]
    traversedRows = [{ id: 'walked-hit', distance: 0.2 }]
    rerankRows = [hit('walked-hit', 'sliced-src')]
    queueTableRows(schemaMock.embedding, rerankRows)
    await handleVectorOnlySearch({
      ...params,
      permitted: { kind: 'unbounded', broad: false },
      accessPlan: {
        connectors: eligibility,
        observers: { confirmed: [], observed: [] },
        memberSources: [],
        connectorTypes: new Map(),
        uploads: true,
      },
    })
    const walks = statements().filter((query) => isWalk(query.sql))
    expect(walks).toHaveLength(1)
    expect(JSON.stringify(walks[0])).toContain('sliced-src')
    const reranked = JSON.stringify(statements().find((query) => isPageStatement(query.sql)))
    expect(reranked).toContain('walked-hit')
    expect(reranked).not.toContain('arbitrary-hit')
  })

  it('ranks uploaded documents even when every connector source is walked', async () => {
    const eligibility = { workspace: [], admin: [], members: ['member-src'] }
    indexedSourceRows = [{ name: 'idx', connectorId: 'member-src' }]
    sourceExactRows = [{ id: 'upload-hit', distance: 0.05, saturated: false }]
    traversedRows = [{ id: 'walked-hit', distance: 0.2 }]
    rerankRows = [hit('upload-hit', null), hit('walked-hit', 'member-src')]
    queueTableRows(schemaMock.embedding, rerankRows)
    await handleVectorOnlySearch({
      ...params,
      topK: 2,
      permitted: { kind: 'unbounded', broad: false },
      accessPlan: {
        connectors: eligibility,
        observers: { confirmed: [{ id: 'm-1', connectorId: 'member-src' }], observed: [] },
        memberSources: ['member-src'],
        connectorTypes: new Map(),
        uploads: true,
      },
    })
    /** Uploads carry no connector, so their slice runs even with no sliced source beside them. */
    const exact = statements().filter((query) => query.sql.includes('WITH readable_chunks'))
    expect(exact).toHaveLength(1)
    expect(JSON.stringify(statements().find((q) => isPageStatement(q.sql)))).toContain('upload-hit')
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

  describe('Tin keyword ranking for an unbounded caller', () => {
    const unbounded: PermittedDocuments = { kind: 'unbounded' }
    const keyword = (overrides: Partial<Parameters<typeof executeKeywordSearch>[0]> = {}) =>
      executeKeywordSearch({
        ...params,
        topK: 1,
        query: 'release',
        queryVector: params.queryVector!,
        permitted: unbounded,
        searchIndexOnly: true,
        ...overrides,
      })
    const tinStatements = () =>
      statements().filter((query) => query.sql.includes('ranked_tin_chunks'))
    const ginStatements = () =>
      statements().filter((query) => query.sql.includes('WITH matched_keyword_chunks'))
    let tinPages: Array<{ ranked: number; candidates: ReturnType<typeof hit>[] }>

    beforeEach(() => {
      mockResolveTinKeywordQuery.mockReset()
      mockResolveTinKeywordQuery.mockResolvedValue('"releas"')
      tinPages = []
      dbChainMockFns.execute.mockImplementation(async (query) =>
        render(query).sql.includes('ranked_tin_chunks')
          ? [tinPages.shift() ?? { ranked: 0, candidates: [] }]
          : []
      )
    })

    it('ranks with Tin and checks access only on the top of that ranking', async () => {
      tinPages = [{ ranked: 1500, candidates: [hit('a', null)] }]
      queueTableRows(schemaMock.embedding, [{ ...hit('a', null), content: 'release notes' }])
      const results = await keyword()
      expect(results.map((row) => row.id)).toEqual(['a'])
      expect(mockResolveTinKeywordQuery).toHaveBeenCalledWith(
        true,
        'release',
        'english',
        params.budget
      )
      expect(ginStatements()).toHaveLength(0)
      expect(JSON.stringify(tinStatements()[0])).toContain('2000')
      /** `==>` binds tighter than `||`, so the concatenated query must be parenthesized. */
      expect(tinStatements()[0].sql).toContain('==> (?)')
    })

    it('decides a row the fill has not reached on its document while the fill runs', async () => {
      tinPages.push({
        ranked: 1,
        candidates: [{ id: 'a', documentId: 'doc-a', connectorId: 'src-a' }],
      })
      const execute = dbChainMockFns.execute.getMockImplementation()!
      dbChainMockFns.execute.mockImplementation(async (query) =>
        render(query).sql.includes('AS unfilled') ? [{ unfilled: true }] : execute(query)
      )
      await keyword({
        accessPlan: {
          connectors: { workspace: [], admin: ['src-a'], members: [] },
          observers: { confirmed: [], observed: [] },
          memberSources: [],
          connectorTypes: new Map(),
          uploads: true,
        },
      })
      const statement = JSON.stringify(tinStatements()[0])
      /** A row the fill has not reached (`acl IS NULL`), or a marked document's row, is decided on its document. */
      expect(statement).toContain(' IS NULL OR ')
      expect(statement).toContain('knowledgeProjectionDirty.documentId')
      expect(statement).toContain('EXISTS (')
      expect(statement).toContain('ranked_tin_chunks.document_id')
    })

    it('widens the window for a broad resolved scope whose first page came back short', async () => {
      tinPages = [
        { ranked: 2000, candidates: [] },
        { ranked: 4000, candidates: [hit('b', 'src-a')] },
      ]
      queueTableRows(schemaMock.embedding, [{ ...hit('b', 'src-a'), content: 'release notes' }])
      const results = await keyword({
        permitted: { kind: 'unbounded', broad: true },
        accessPlan: {
          connectors: { workspace: [], admin: ['src-a'], members: [] },
          observers: { confirmed: [], observed: [] },
          memberSources: [],
          connectorTypes: new Map(),
          uploads: true,
        },
      })
      expect(results.map((row) => row.id)).toEqual(['b'])
      const windows = tinStatements().map((query) => JSON.stringify(query))
      expect(windows).toHaveLength(2)
      expect(windows[0]).toContain('2000')
      expect(windows[1]).toContain('10000')
    })

    it('hydrates an oversized keyword page in slices and stops at the results it needs', async () => {
      const ranked = Array.from({ length: 1000 }, (_, i) => hit(`k-${i}`, 'src-a'))
      tinPages = [{ ranked: 20_000, candidates: ranked }]
      /** The first slice — as many candidates as results are wanted — fills the page of results. */
      queueTableRows(
        schemaMock.embedding,
        ranked.slice(0, 20).map((row) => ({ ...row, content: 'release notes' }))
      )
      const results = await keyword({
        topK: 20,
        permitted: { kind: 'unbounded', broad: false },
        accessPlan: {
          connectors: { workspace: [], admin: ['src-a'], members: [] },
          observers: { confirmed: [], observed: [] },
          memberSources: [],
          connectorTypes: new Map(),
          uploads: true,
        },
      })
      expect(results).toHaveLength(20)
      expect(tinStatements()).toHaveLength(1)
      /** One hydration, of one slice — never the whole page. */
      const hydrations = dbChainMockFns.where.mock.calls.filter(([condition]) =>
        hasMockCondition(
          condition,
          (node) => node.type === 'inArray' && node.column === schemaMock.embedding.id
        )
      )
      expect(hydrations).toHaveLength(1)
      expect(
        hasMockCondition(
          hydrations[0][0],
          (node) =>
            node.type === 'inArray' &&
            node.column === schemaMock.embedding.id &&
            Array.isArray(node.values) &&
            node.values.length === 20
        )
      ).toBe(true)
    })

    describe('a bounded set past the exact-ranking size', () => {
      const large = Array.from({ length: PERMITTED_EXACT_DOCUMENT_LIMIT }, (_, index) => ({
        id: `doc-${index}`,
        connectorId: 'src-a',
      }))
      const accessPlan = {
        connectors: { workspace: [], admin: ['src-a'], members: [], liveProofRequired: [] },
        observers: { confirmed: [], observed: [] },
        memberSources: [],
        connectorTypes: new Map(),
        uploads: true,
      }

      it('ranks with Tin as a narrow reader, decided on the row', async () => {
        tinPages = [{ ranked: 1500, candidates: [hit('a', 'src-a')] }]
        queueTableRows(schemaMock.embedding, [{ ...hit('a', 'src-a'), content: 'release notes' }])
        const results = await keyword({
          permitted: { kind: 'bounded', documents: large },
          accessPlan,
        })
        expect(results.map((row) => row.id)).toEqual(['a'])
        expect(mockResolveTinKeywordQuery).toHaveBeenCalledTimes(1)
        expect(tinStatements()).toHaveLength(1)
        expect(JSON.stringify(tinStatements()[0])).toContain('2000')
        expect(JSON.stringify(tinStatements()[0])).not.toContain('doc-4999')
        expect(ginStatements()).toHaveLength(0)
      })

      it('leaves a later page short rather than resuming a different ranking at its offset', async () => {
        /** The first page fills from Tin; hydration keeps half, so a second page is asked for. */
        const first = Array.from({ length: 40 }, (_, index) => hit(`t-${index}`, 'src-a'))
        tinPages = [
          { ranked: 2000, candidates: first },
          { ranked: 2000, candidates: [] },
          { ranked: 20_000, candidates: [] },
        ]
        queueTableRows(
          schemaMock.embedding,
          first.slice(0, 20).map((row) => ({ ...row, content: 'release notes' }))
        )
        const results = await keyword({
          topK: 40,
          permitted: { kind: 'bounded', documents: large },
          accessPlan,
        })
        expect(results).toHaveLength(20)
        expect(tinStatements()).toHaveLength(3)
        expect(ginStatements()).toHaveLength(0)
      })
    })

    it('keeps GIN ranking when Tin is not ready or cannot express the query', async () => {
      mockResolveTinKeywordQuery.mockResolvedValue(null)
      await keyword()
      expect(tinStatements()).toHaveLength(0)
      expect(ginStatements()).toHaveLength(1)
    })
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
      access: { ...reader, tokens: [`u:resolves-${kind}@example.com`] },
    })
    expect(permitted.kind).toBe(kind)
    if (permitted.kind === 'bounded')
      expect(permitted.documents).toEqual([{ id: 'doc-a', connectorId: null }])
  })

  describe('saturated reach', () => {
    const scope = (name: string): UserAccessScope => ({
      ...reader,
      tokens: [`u:${name}@example.com`],
    })
    const resolve = (access: UserAccessScope, knowledgeBaseIds = ['org-index']) =>
      resolvePermittedDocuments({ knowledgeBaseIds, access })
    const probes = () => statements().filter((query) => isProbeStatement(query.sql)).length

    it('counts a saturated reach against the broad bound once, and remembers the answer', async () => {
      /** The index holds a million documents; the bound is a quarter of them. */
      const counts = { index: 1_000_000, reached: 250_000 }
      dbChainMockFns.execute.mockImplementation(async (query) => {
        const statement = render(query).sql
        if (isProbeStatement(statement)) return [{ id: null, connectorId: null, saturated: true }]
        if (statement.includes(') reached')) return [{ n: counts.reached }]
        if (statement.includes('EXPLAIN'))
          return [{ 'QUERY PLAN': [{ Plan: { 'Plan Rows': counts.index } }] }]
        return []
      })
      const reachCounts = () => statements().filter((query) => query.sql.includes(') reached'))
      const broad = await resolve(scope('broad-reach'))
      expect(broad).toEqual({ kind: 'unbounded', broad: true })
      expect(reachCounts()).toHaveLength(1)
      expect(JSON.stringify(reachCounts()[0])).toContain('250000')
      await resolve(scope('broad-reach'))
      expect(reachCounts()).toHaveLength(1)
      counts.reached = 120_000
      const narrow = await resolve(scope('narrow-reach'))
      expect(narrow).toEqual({ kind: 'unbounded', broad: false })
      expect(reachCounts()).toHaveLength(2)
    })

    it('does not remember a saturated reach whose count ran out of time', async () => {
      dbChainMockFns.execute.mockImplementation(async (query) => {
        const statement = render(query).sql
        if (isProbeStatement(statement)) return [{ id: null, connectorId: null, saturated: true }]
        if (statement.includes('EXPLAIN'))
          return [{ 'QUERY PLAN': [{ Plan: { 'Plan Rows': 1_000_000 } }] }]
        if (statement.includes(') reached'))
          throw Object.assign(new Error('canceling statement due to statement timeout'), {
            code: '57014',
          })
        return []
      })
      const reachCounts = () => statements().filter((query) => query.sql.includes(') reached'))
      const budget = () => new SearchBudget('vector', performance.now() + 10_000)
      expect(
        await resolvePermittedDocuments({
          knowledgeBaseIds: ['org-index'],
          access: scope('timed-saturated'),
          budget: budget(),
        })
      ).toEqual({ kind: 'unbounded', broad: true })
      expect(reachCounts()).toHaveLength(1)
      /** The next search probes and counts again rather than trusting a reach that was never measured. */
      await resolvePermittedDocuments({
        knowledgeBaseIds: ['org-index'],
        access: scope('timed-saturated'),
        budget: budget(),
      })
      expect(probes()).toBe(2)
      expect(reachCounts()).toHaveLength(2)
    })

    it('does not read an unanalyzed index as a reach of nothing', async () => {
      /** The planner knows no rows yet, so the bound is zero and the count looked at nothing. */
      dbChainMockFns.execute.mockImplementation(async (query) => {
        const statement = render(query).sql
        if (statement.includes('EXPLAIN')) return [{ 'QUERY PLAN': [{ Plan: { 'Plan Rows': 0 } }] }]
        if (statement.includes(') reached')) return [{ n: 0 }]
        return []
      })
      await expect(
        resolveReach(
          ['org-index'],
          scope('unanalyzed'),
          new SearchBudget('vector', performance.now() + 10_000),
          {
            connectors: { workspace: [], admin: [], members: [], liveProofRequired: [] },
            observers: { confirmed: [], observed: [] },
            memberSources: [],
            connectorTypes: new Map(),
            uploads: true,
          }
        )
      ).resolves.toEqual({ kind: 'unbounded', broad: true })
    })

    it('is remembered per set of bases and tokens', async () => {
      probeRows = [{ id: null, connectorId: null, saturated: true }]
      await resolve(scope('per-key'))
      probeRows = [{ id: 'doc-a', connectorId: null, saturated: false }]
      expect((await resolve(scope('per-key'), ['other-index'])).kind).toBe('bounded')
      expect((await resolve(scope('per-key-other'))).kind).toBe('bounded')
      expect(probes()).toBe(3)
    })
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

  const liveSearch = {
    knowledgeBaseIds: ['org-index'],
    searchIndexOnly: true,
    topK: 1,
    searchMode: 'hybrid' as const,
    query: 'release',
    queryVector: params.queryVector!,
  }

  it('never asks a source for live grants when the scope reads none', async () => {
    const getForConnectors = vi.fn<KnowledgeAccessProvider['getForConnectors']>(async () => reader)
    await retrieveKnowledgeSearch({
      ...liveSearch,
      access: reader,
      accessProvider: { ...provider, getForConnectors },
    })
    expect(getForConnectors).not.toHaveBeenCalled()
  })

  it('rebuilds the pool without a gated source the caller turns out not to hold', async () => {
    queueTableRows(schemaMock.knowledgeConnector, [
      {
        id: 'gated-src',
        accessMode: 'admin',
        connectorType: 'confluence',
        githubRepository: false,
      },
    ])
    /**
     * The first pool is filled by the gated source alone; only a pool built without it — the
     * exclusion carries the source id into the walk — reaches the accessible candidate. The
     * projection is filled, so the walk carries each candidate's source and no page is read.
     */
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query).sql
      if (statement.includes('AS unfilled')) return [{ unfilled: false }]
      const rebuilt = JSON.stringify(query).includes('/* excluded sources */')
      if (isWalk(statement))
        return Array.from({ length: 400 }, (_, i) =>
          i === 0
            ? rebuilt
              ? hit('b', 'other-src')
              : hit('a', 'gated-src')
            : hit(`w-${i}`, rebuilt ? 'other-src' : 'gated-src')
        )
      return []
    })
    queueTableRows(schemaMock.embedding, [])
    queueTableRows(schemaMock.embedding, [hit('b', 'other-src')])
    /** No grants come back, so the gated source is denied. */
    const getForConnectors = vi.fn<KnowledgeAccessProvider['getForConnectors']>(async () => reader)
    const result = await retrieveKnowledgeSearch({
      ...liveSearch,
      searchMode: 'vector',
      access: reader,
      accessProvider: { ...provider, getForConnectors },
    })
    expect(getForConnectors).toHaveBeenCalledOnce()
    expect(result.rows.map((row) => row.id)).toEqual(['b'])
    const walks = statements().filter((query) => isWalk(query.sql))
    expect(walks).toHaveLength(2)
    expect(JSON.stringify(walks[0])).not.toContain('/* excluded sources */')
    expect(JSON.stringify(walks[1])).toContain('/* excluded sources */')
    expect(JSON.stringify(walks[1])).toContain('OR NOT (')
    expect(statements().some((query) => isPageStatement(query.sql))).toBe(false)
  })

  it.each([false, true])(
    'excludes a denied source through its documents (searchIndexOnly=%s)',
    async (searchIndexOnly) => {
      queueTableRows(schemaMock.knowledgeConnector, [
        {
          id: 'gated-src',
          accessMode: 'admin',
          connectorType: 'confluence',
          githubRepository: false,
        },
      ])
      dbChainMockFns.execute.mockImplementation(async (query) => {
        const statement = render(query).sql
        /** The fill has not reached every row, so a denied source cannot be read off the row. */
        if (statement.includes('AS unfilled')) return [{ unfilled: true }]
        /** The mock renders nested fragments as parameters, so the marker is found in the whole query. */
        const rebuilt = JSON.stringify(query).includes('/* excluded sources */')
        if (isPageStatement(statement))
          return JSON.stringify(render(query).params).includes('"b"')
            ? [hit('b', 'other-src')]
            : [hit('a', 'gated-src')]
        if (isWalk(statement))
          return Array.from({ length: 400 }, (_, i) => ({
            id: i === 0 ? (rebuilt ? 'b' : 'a') : `w-${i}`,
            distance: 0.1,
          }))
        return []
      })
      queueTableRows(schemaMock.embedding, [])
      queueTableRows(schemaMock.embedding, [hit('b', 'other-src')])
      const getForConnectors = vi.fn<KnowledgeAccessProvider['getForConnectors']>(
        async () => reader
      )
      const result = await retrieveKnowledgeSearch({
        ...liveSearch,
        searchIndexOnly,
        searchMode: 'vector',
        access: reader,
        accessProvider: { ...provider, getForConnectors },
      })
      expect(result.rows.map((row) => row.id)).toEqual(['b'])
      expect(statements().filter((query) => query.sql.includes('AS unfilled'))).toHaveLength(
        searchIndexOnly ? 1 : 0
      )
      const walks = statements().filter((query) => isWalk(query.sql))
      expect(walks).toHaveLength(2)
      expect(JSON.stringify(walks[0])).not.toContain('/* excluded sources */')
      expect(JSON.stringify(walks[1])).toContain('NOT EXISTS (SELECT 1 FROM')
      expect(JSON.stringify(walks[1])).toContain('/* excluded sources */')
    }
  )
})

describe('filters on a resolved scope', () => {
  const reader: UserAccessScope = {
    kind: 'user',
    userId: 'reader',
    tokens: ['u:reader@example.com'],
  }
  const provider: KnowledgeAccessProvider = {
    get: async () => reader,
    getForConnectors: async () => reader,
    getForDocuments: async () => reader,
    liveSourceConnectorCondition: async () => null,
  }
  const params: SearchParams = {
    knowledgeBaseIds: ['org-index'],
    searchIndexOnly: true,
    topK: 1,
    access: reader,
    accessProvider: provider,
    queryVector: { vector: '[0.1,0.2]', dimensions: 1536, model: 'text-embedding-3-small' },
    distanceThreshold: 1,
  }
  const plan = (sources: string[] = ['src-a']) => ({
    connectors: { workspace: [], admin: sources, members: [], liveProofRequired: [] },
    observers: { confirmed: [], observed: [] },
    memberSources: [],
    connectorTypes: new Map(sources.map((id) => [id, 'slack'])),
    uploads: true,
  })
  const hit = (id: string, connectorId: string | null) => ({
    id,
    documentId: `doc-${id}`,
    connectorId,
    distance: 0.1,
  })
  let probeRows: Array<{ id: string | null; connectorId: string | null; saturated: boolean }>
  let traversedRows: Array<{ id: string; distance?: number }>
  let rerankRows: Array<ReturnType<typeof hit>>
  let exactRows: Array<{ id: string }>
  let indexedSourceRows: Array<{ name: string; connectorId: string }>

  beforeEach(() => {
    resetDbChainMock()
    forgetIndexedVectorSources()
    forgetSearchReach()
    probeRows = []
    traversedRows = []
    rerankRows = []
    exactRows = []
    indexedSourceRows = []
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query).sql
      /** The fixtures model the page read, which only an unfilled projection makes. */
      if (statement.includes('AS unfilled')) return [{ unfilled: true }]
      if (statement.includes('EXPLAIN'))
        return [{ 'QUERY PLAN': [{ Plan: { 'Plan Rows': 1_000_000 } }] }]
      if (statement.includes('pg_index')) return indexedSourceRows
      if (isExactRanking(statement)) return exactRows
      if (statement.includes(') reached')) return [{ n: 250_000 }]
      if (isProbeStatement(statement)) return probeRows
      if (isWalk(statement)) return traversedRows
      if (isPageStatement(statement)) return rerankRows
      if (statement.includes('ranked_tin_chunks')) return [{ ranked: 0, candidates: [] }]
      return []
    })
  })

  it('enumerates the documents a date filter admits even when the reach is remembered', async () => {
    probeRows = [{ id: 'doc-recent', connectorId: 'src-a', saturated: false }]
    const budget = () => new SearchBudget('vector', performance.now() + 10_000)
    await resolveReach(['org-index'], reader, budget(), plan())
    const permitted = await resolvePermittedDocuments({
      knowledgeBaseIds: ['org-index'],
      access: reader,
      filters: { modifiedAfter: '2026-09-13T00:00:00.000Z' },
      budget: budget(),
      accessPlan: plan(),
    })
    expect(permitted).toEqual({
      kind: 'bounded',
      documents: [{ id: 'doc-recent', connectorId: 'src-a' }],
    })
    const probes = statements().filter((query) => query.sql.includes('AS saturated'))
    expect(probes).toHaveLength(1)
    /** Filter first, over the date index: never the reach count that reports a broad reader saturated. */
    expect(probes[0].sql).not.toContain('WITH reach')
    /** An index-driven probe earns its own budget: a window at the document limit fits inside it. */
    const deadlines = statements().filter((query) => query.sql.includes('statement_timeout'))
    expect(deadlines.at(-1)?.params[0]).toBe('1500')
    expect(JSON.stringify(probes[0])).toContain('"type":"gte"')
  })

  describe('a bounded set past the exact-ranking size', () => {
    const large = Array.from({ length: PERMITTED_EXACT_DOCUMENT_LIMIT }, (_, index) => ({
      id: `doc-${index}`,
      connectorId: 'src-a',
    }))
    const walked = Array.from({ length: 200 }, (_, index) => hit(`w-${index}`, 'src-a'))
    const search = (documents: typeof large) =>
      handleVectorOnlySearch({
        ...params,
        permitted: { kind: 'bounded', documents },
        accessPlan: plan(),
      })
    beforeEach(() => {
      const execute = dbChainMockFns.execute.getMockImplementation()!
      dbChainMockFns.execute.mockImplementation(async (query) => {
        /** The projection is filled, so a walk decides readability on the row. */
        if (render(query).sql.includes('AS unfilled')) return [{ unfilled: false }]
        return execute(query)
      })
    })

    it('walks the graph on the row instead of ranking every chunk of the set', async () => {
      traversedRows = walked
      queueTableRows(schemaMock.embedding, [walked[0]])
      expect((await search(large)).map((row) => row.id)).toEqual(['w-0'])
      const walks = statements().filter((query) => isWalk(query.sql))
      expect(walks).toHaveLength(1)
      expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(0)
      /** Readability rides on the row through the plan; the set's identifiers never cross the wire. */
      expect(JSON.stringify(walks[0])).not.toContain('doc-4999')
      expect(JSON.stringify(walks[0])).toContain('src-a')
    })
  })

  it("estimates a filter under the leg's deadline and walks when the estimate runs out of time", async () => {
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query).sql
      /** The fixtures model the page read, which only an unfilled projection makes. */
      if (statement.includes('AS unfilled')) return [{ unfilled: true }]
      if (statement.includes('EXPLAIN') && JSON.stringify(render(query)).includes('"type":"gte"'))
        throw Object.assign(new Error('canceling statement due to statement timeout'), {
          code: '57014',
        })
      if (statement.includes('EXPLAIN'))
        return [{ 'QUERY PLAN': [{ Plan: { 'Plan Rows': 1_000_000 } }] }]
      if (statement.includes(') reached')) return [{ n: 250_000 }]
      if (isWalk(statement)) return traversedRows
      if (isPageStatement(statement)) return rerankRows
      return []
    })
    const result = await retrieveKnowledgeSearch({
      ...params,
      accessProvider: provider,
      searchMode: 'vector',
      query: 'release',
      filters: { modifiedAfter: '2026-09-13T00:00:00.000Z' },
    })
    /** The estimate ran inside a deadline statement; its own timeout chose the walk and cost the leg nothing. */
    const estimateAt = statements().findIndex((query) =>
      JSON.stringify(query).includes('"type":"gte"')
    )
    expect(estimateAt).toBeGreaterThan(0)
    expect(statements()[estimateAt - 1].sql).toContain('statement_timeout')
    expect(statements().filter((query) => query.sql.includes('AS saturated'))).toHaveLength(0)
    expect(statements().filter((query) => isWalk(query.sql))).toHaveLength(1)
    expect(result.retrieval.status).toBe('complete')
  })

  it('keeps the default scan while the projection still holds unfilled rows', async () => {
    traversedRows = [{ id: 'a' }]
    rerankRows = [hit('a', 'src-a')]
    queueTableRows(schemaMock.embedding, rerankRows)
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query).sql
      /** The fixtures model the page read, which only an unfilled projection makes. */
      if (statement.includes('AS unfilled')) return [{ unfilled: true }]
      if (isWalk(statement)) return traversedRows
      if (isPageStatement(statement)) return rerankRows
      return []
    })
    await handleVectorOnlySearch({
      ...params,
      permitted: { kind: 'unbounded', broad: true },
      accessPlan: plan(),
    })
    /** An unfilled row is decided through its document, so the walk keeps the cap sized for that. */
    const caps = statements()
      .filter((query) => query.sql.includes('hnsw.max_scan_tuples'))
      .map((query) => query.params.find((param) => param === '20000' || param === '100000'))
    expect(caps.at(-1)).toBe('20000')
  })
})

/** A retrieval row with only the fields fusion reads; the tag slots are irrelevant here. */
function searchRow(id: string, distance: number): SearchResult {
  return {
    id,
    content: id,
    documentId: `doc-${id}`,
    chunkIndex: 0,
    tag1: null,
    tag2: null,
    tag3: null,
    tag4: null,
    tag5: null,
    tag6: null,
    tag7: null,
    number1: null,
    number2: null,
    number3: null,
    number4: null,
    number5: null,
    date1: null,
    date2: null,
    boolean1: null,
    boolean2: null,
    boolean3: null,
    distance,
    knowledgeBaseId: 'kb-1',
    sourceModifiedAt: null,
  }
}

describe('fuseByReciprocalRank exposes the ordering key', () => {
  it('stamps each row with the fused score it is ordered by and a 1-based rank, leaving similarity alone', () => {
    const lexical = [searchRow('a', 0.5), searchRow('b', 0.2)]
    const vector = [searchRow('b', 0.2), searchRow('c', 0.1)]

    const fused = fuseByReciprocalRank([lexical, vector], 3)

    expect(fused.map((row) => row.id)).toEqual(['b', 'a', 'c'])
    expect(fused.map((row) => row.rank)).toEqual([1, 2, 3])
    expect(fused[0].rankScore).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1), 12)
    expect(fused[1].rankScore).toBeCloseTo(1 / (RRF_K + 1), 12)
    expect(fused[2].rankScore).toBeCloseTo(1 / (RRF_K + 2), 12)
    /** The order follows rankScore, which the cosine distance alone would not explain: c is the nearest chunk yet ranks last. */
    expect(fused.map((row) => row.rankScore)).toEqual(
      [...fused.map((row) => row.rankScore)].sort((x, y) => (y ?? 0) - (x ?? 0))
    )
    expect(fused.map((row) => row.distance)).toEqual([0.2, 0.5, 0.1])
  })
})
