import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import {
  type KnowledgeAccessProvider,
  type UserAccessScope,
  WORKSPACE_ACCESS_TOKENS,
} from '@/lib/knowledge/access/types'
import { SearchBudget, type SearchExecutor } from '@/lib/knowledge/search/budget'
import {
  type SearchParams,
  type SearchResult,
  VECTOR_PROBE_DOCUMENT_LIMIT,
} from '@/lib/knowledge/search/candidates'
import type { SearchStage } from '@/lib/knowledge/search/diagnostics'
import {
  forgetSaturatedReads,
  fuseByReciprocalRank,
  handleTagOnlySearch,
  handleVectorSearch,
  retrieveKnowledgeSearch,
} from '@/lib/knowledge/search/queries'
import { RRF_K } from '@/lib/knowledge/search/recency'
import { getStructuredTagFilters } from '@/lib/knowledge/search/tag-filters'
import { vectorCandidatePoolLimit } from '@/lib/knowledge/search/vector-leg'
import type { StructuredFilter } from '@/lib/knowledge/types'

/** A leg under the caller's ordinary document predicate: a search holding no live-proof source. */
const readOf = (params: SearchParams) => ({
  rankCondition: knowledgeAccessCondition(params.access),
  signedIn: params.access.kind === 'user',
})
const vectorSearch = (params: SearchParams) => handleVectorSearch(params, readOf(params))
const tagSearch = (params: SearchParams) => handleTagOnlySearch(params, readOf(params))

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

describe('many-base tag and keyword legs rank globally', () => {
  const knowledgeBaseIds = ['kb-1', 'kb-2', 'kb-3', 'kb-4', 'kb-5']
  const queryVector = {
    vector: '[1,0]',
    dimensions: 1536 as const,
    model: 'text-embedding-3-small',
  }
  const tags: StructuredFilter[] = [
    { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'release' },
  ]
  const reader: UserAccessScope = {
    kind: 'user',
    userId: 'reader',
    tokens: WORKSPACE_ACCESS_TOKENS,
  }
  const accessProvider: KnowledgeAccessProvider = {
    get: async () => reader,
    getForConnectors: async () => reader,
    getForDocuments: async () => reader,
    liveSourceConnectorCondition: async () => null,
  }
  beforeEach(() => {
    resetDbChainMock()
  })

  it.each([
    [
      'a keyword deadline',
      new Error('Statement canceled', { cause: { code: '57014' } }),
      'partial',
    ],
    [
      'any other keyword failure',
      new Error('Connection lost', { cause: { code: '08006' } }),
      'fail',
    ],
  ] as const)('answers %s with %s', async (_label, failure, outcome) => {
    const query = SearchBudget.prototype.query
    vi.spyOn(SearchBudget.prototype, 'query').mockImplementation(function <T>(
      this: SearchBudget,
      stage: SearchStage,
      run: (executor: SearchExecutor) => PromiseLike<T>
    ) {
      if (stage === 'keyword.sql') return Promise.reject(failure)
      return query.call(this, stage, run) as Promise<T>
    })
    const search = retrieveKnowledgeSearch({
      knowledgeBaseIds: ['kb-1'],
      topK: 10,
      access: reader,
      accessProvider,
      searchMode: 'hybrid',
      query: 'release',
      queryVector,
    })
    if (outcome === 'fail') {
      await expect(search).rejects.toBe(failure)
      return
    }
    expect((await search).retrieval).toEqual({ status: 'partial', timedOutLegs: ['keyword'] })
  })
})

/**
 * The global `drizzle-orm` mock renders `sql` fragments to a `?`-placeholder
 * string via `toSQL()`, so we can assert the exact predicate each filter builds.
 */
function render(condition: unknown) {
  return (condition as { toSQL: () => { sql: string; params: unknown[] } }).toSQL()
}

/** The readable-document probe is the only statement that reports whether it saturated. */
function isProbeStatement(sql: string) {
  return sql.includes('AS saturated')
}

/** A graph walk: visibility joined per visited row on its document. */
function isWalk(sql: string) {
  return sql.includes('AS visible')
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
  const params: SearchParams = {
    knowledgeBaseIds: ['kb-small'],
    topK: 2,
    access,
    queryVector: { vector: '[0.1,0.2]', dimensions: 1536, model: 'text-embedding-3-small' },
    distanceThreshold: 1,
  }
  const probe = Array.from({ length: 400 }, (_, index) => ({ id: `probe-${index}` }))
  const candidates = Array.from({ length: 400 }, (_, index) => ({
    id: `candidate-${index}`,
    documentId: `candidate-doc-${index}`,
    connectorId: null,
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
  let traversedRows: Array<{ id: string }>
  let exactRows: Array<{ id: string }>
  let failCandidates: unknown

  beforeEach(() => {
    resetDbChainMock()
    forgetSaturatedReads()
    probeRows = probe
    /** A full pool: the walk found as many readable neighbours as it was asked for. */
    traversedRows = [...ranked, ...candidates]
    exactRows = probe
    failCandidates = undefined
    dbChainMockFns.execute.mockImplementation(async (query) => {
      const statement = render(query).sql
      if (statement.includes('hnsw.iterative_scan')) return []
      if (isWalk(statement)) {
        if (failCandidates) throw failCandidates
        return traversedRows
      }
      if (isExactRanking(statement)) return exactRows
      if (isProbeStatement(statement)) return probeRows
      return []
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not acquire a connection or start SQL after the KB retrieval deadline', async () => {
    const budget = new SearchBudget('vector', performance.now() - 1)
    expect(
      await vectorSearch({
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
  })

  it('rescues an underfilled traversal by ranking the readable set exactly', async () => {
    traversedRows = ranked
    probeRows = [{ id: 'near-doc' }, { id: 'far-doc' }]
    exactRows = ranked
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await vectorSearch(params)).map((row) => row.id)).toEqual(['near', 'far'])
    const exact = statements().find((query) => isExactRanking(query.sql))!
    expect(exact.sql).not.toContain('CROSS JOIN LATERAL')
    expect(JSON.stringify(exact)).toContain('near-doc')
    const probeStatement = statements().find((query) => isProbeStatement(query.sql))!
    expect(probeStatement.sql).not.toContain('<=>')
    expect(probeStatement.sql).not.toContain('WITH reach')
    expect(probeStatement.params).toContain(VECTOR_PROBE_DOCUMENT_LIMIT + 1)
    expect(JSON.stringify(probeStatement)).toContain('required_clause')
  })

  it('counts only chunks the search can return when a tag filter decides a document', async () => {
    traversedRows = ranked
    probeRows = [{ id: 'near-doc' }]
    exactRows = ranked
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    await vectorSearch({
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

  it('keeps an underfilled traversal when the readable set is too large to rank exactly, and does not probe it again', async () => {
    traversedRows = ranked
    probeRows = new Array(VECTOR_PROBE_DOCUMENT_LIMIT + 1).fill({ id: 'doc' })
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await vectorSearch(params)).map((row) => row.id)).toEqual(['near', 'far'])
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await vectorSearch(params)).map((row) => row.id)).toEqual(['near', 'far'])
    expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(0)
    expect(statements().filter((query) => isProbeStatement(query.sql))).toHaveLength(1)
    /** A different reader's set is its own question. */
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    await vectorSearch({ ...params, knowledgeBaseIds: ['kb-other'] })
    expect(statements().filter((query) => isProbeStatement(query.sql))).toHaveLength(2)
  })

  it('spends only its own share of the leg on a probe that runs long', async () => {
    const budget = new SearchBudget('vector', performance.now() + 8000)
    traversedRows = ranked
    exactRows = ranked
    const execute = dbChainMockFns.execute.getMockImplementation()!
    dbChainMockFns.execute.mockImplementation(async (query) => {
      if (isProbeStatement(render(query).sql))
        throw new Error('canceling statement due to statement timeout', {
          cause: { code: '57014' },
        })
      return execute(query)
    })
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    expect((await vectorSearch({ ...params, budget })).map((row) => row.id)).toEqual([
      'near',
      'far',
    ])
    expect(budget.timedOut).toBe(false)
    expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(0)
  })

  it('walks for a pool sized to the page, and scores the page on the original vectors', async () => {
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    await vectorSearch(params)
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

  it('sizes the pool to the pages asked for, doubling a pool the pages outran', () => {
    expect(vectorCandidatePoolLimit(20, undefined)).toBe(200)
    expect(vectorCandidatePoolLimit(150, undefined)).toBe(300)
    expect(vectorCandidatePoolLimit(210, 200)).toBe(420)
    expect(vectorCandidatePoolLimit(5000, 1600)).toBe(1600)
  })

  it('applies full workspace access on the document before the walk counts a candidate', async () => {
    queueTableRows(schemaMock.embedding, [...ranked].reverse())
    await vectorSearch(params)
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
    /** Readability is the document's alone: nothing asks the projector's marks. */
    expect(serialized).not.toContain('knowledgeProjectionDirty')
    /** The walk carries each candidate's document, so its order is the page's with no page read. */
    expect(
      statements().filter(
        (query) => !isWalk(query.sql) && !JSON.stringify(query).includes('hnsw.iterative_scan')
      )
    ).toHaveLength(0)
    const hydrated = dbChainMockFns.where.mock.calls.at(-1)![0]
    expect(
      hasMockCondition(
        hydrated,
        (node) =>
          node.type === 'inArray' &&
          node.column === schemaMock.embedding.id &&
          Array.isArray(node.values) &&
          node.values[0] === 'near'
      )
    ).toBe(true)
  })

  it('fills a single result from the same pool when its nearest row loses access', async () => {
    /** The nearest row no longer hydrates under the full predicate; the next one in the pool does. */
    queueTableRows(schemaMock.embedding, [ranked[1]])
    const rows = await vectorSearch({ ...params, topK: 1 })
    expect(rows.map((row) => row.id)).toEqual(['far'])
    expect(statements().filter((query) => isWalk(query.sql))).toHaveLength(1)
  })

  it('does not turn a broad tag filter into exhaustive full-vector ranking', async () => {
    queueTableRows(schemaMock.embedding, ranked)
    const rows = await vectorSearch({
      ...params,
      structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'common' }],
    })
    expect(rows.map((row) => row.id)).toEqual(['near', 'far'])
    expect(statements().filter((query) => isExactRanking(query.sql))).toHaveLength(0)
    const candidate = statements().find((query) => isWalk(query.sql))!
    expect(JSON.stringify(candidate)).toContain('common')
    expect(JSON.stringify(candidate)).toContain(String(schemaMock.embedding.tag1))
    expect(JSON.stringify(dbChainMockFns.where.mock.calls.at(-1)![0])).toContain('common')
  })

  it('ranks all selected KBs together instead of capping how many results one KB can contribute', async () => {
    const knowledgeBaseIds = ['kb-1', 'kb-2', 'kb-3', 'kb-4', 'kb-5']
    queueTableRows(
      schemaMock.embedding,
      ranked.map((row) => ({ ...row, knowledgeBaseId: 'kb-1' }))
    )
    const rows = await vectorSearch({ ...params, knowledgeBaseIds })
    expect(rows.map((row) => row.id)).toEqual(['near', 'far'])
    expect(rows.every((row) => row.knowledgeBaseId === 'kb-1')).toBe(true)
    const candidateQueries = statements().filter((query) => isWalk(query.sql))
    expect(candidateQueries).toHaveLength(1)
    for (const id of knowledgeBaseIds) expect(JSON.stringify(candidateQueries[0])).toContain(id)
    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
  })

  it.each(['vector.candidate_search', 'vector.sql'] as const)(
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

  it('shares the remaining deadline across candidate selection and hydration', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const query = SearchBudget.prototype.query
    vi.spyOn(SearchBudget.prototype, 'query').mockImplementation(async function <T>(
      this: SearchBudget,
      stage: SearchStage,
      run: (executor: SearchExecutor) => PromiseLike<T>
    ) {
      const result = await (query.bind(this) as SearchBudget['query'])(stage, run)
      if (stage === 'vector.candidate_search') vi.spyOn(performance, 'now').mockReturnValue(60)
      return result
    })
    queueTableRows(schemaMock.embedding, ranked)
    await vectorSearch({ ...params, budget: new SearchBudget('vector', 100) })
    expect(
      statements()
        .filter((query) => query.sql.includes('statement_timeout'))
        .map((query) => query.params[0])
    ).toEqual(['100', '40'])
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

  it.each([vectorSearch, tagSearch])(
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

describe('document-decided pages follow ranked candidates', () => {
  const reader: UserAccessScope = {
    kind: 'user',
    userId: 'reader',
    tokens: ['pub', 'u:reader@example.com', 'ws'],
  }
  const params: SearchParams = {
    knowledgeBaseIds: ['kb'],
    topK: 1,
    access: reader,
    queryVector: { vector: '[0.1,0.2]', dimensions: 1536, model: 'text-embedding-3-small' },
    distanceThreshold: 0.8,
  }
  const walked = Array.from({ length: 400 }, (_, index) => ({
    id: `candidate-${index}`,
    documentId: `doc-${index}`,
    connectorId: null,
  }))
  const hydrations = () =>
    dbChainMockFns.where.mock.calls.filter(([condition]) =>
      hasMockCondition(
        condition,
        (node) => node.type === 'inArray' && node.column === schemaMock.embedding.id
      )
    )

  beforeEach(() => {
    resetDbChainMock()
    dbChainMockFns.execute.mockImplementation(async (query) =>
      isWalk(render(query).sql) ? walked : []
    )
  })

  it('advances past candidate slices that hydrate no current readable content', async () => {
    queueTableRows(schemaMock.embedding, [])
    queueTableRows(schemaMock.embedding, [
      { id: 'candidate-20', content: 'Current readable content', distance: 0.1 },
    ])
    const rows = await vectorSearch(params)
    expect(rows.map((row) => row.id)).toEqual(['candidate-20'])
    expect(statements().filter((query) => isWalk(query.sql))).toHaveLength(1)
    expect(hydrations()).toHaveLength(2)
  })

  it('sorts hydrated candidates across slices by their original-vector distance', async () => {
    queueTableRows(schemaMock.embedding, [{ id: 'candidate-0', content: 'Far', distance: 0.7 }])
    queueTableRows(schemaMock.embedding, [
      { id: 'candidate-20', content: 'Near', distance: 0.2 },
      { id: 'candidate-21', content: 'Nearest', distance: 0.1 },
    ])
    const rows = await vectorSearch({ ...params, topK: 2 })
    expect(rows.map((row) => row.id)).toEqual(['candidate-21', 'candidate-20'])
    /** A later slice never re-reads a candidate an earlier one already hydrated. */
    expect(
      hasMockCondition(
        hydrations().at(-1)![0],
        (node) =>
          node.type === 'inArray' &&
          node.column === schemaMock.embedding.id &&
          Array.isArray(node.values) &&
          !node.values.includes('candidate-0')
      )
    ).toBe(true)
  })

  it('asks a gated source for live proof only once one of its candidates is read', async () => {
    const getForConnectors = vi.fn(async () => reader)
    const accessProvider: KnowledgeAccessProvider = {
      get: async () => reader,
      getForConnectors,
      getForDocuments: async () => reader,
      liveSourceConnectorCondition: async () => sql`true`,
    }
    const search = () =>
      retrieveKnowledgeSearch({
        knowledgeBaseIds: ['kb'],
        topK: 1,
        access: reader,
        accessProvider,
        searchMode: 'vector',
        query: 'release',
        queryVector: params.queryVector,
      })
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'gated-source' }])
    queueTableRows(schemaMock.embedding, [{ id: 'candidate-0', content: 'Ungated', distance: 0.1 }])
    await search()
    expect(getForConnectors).not.toHaveBeenCalled()

    dbChainMockFns.execute.mockImplementation(async (query) =>
      isWalk(render(query).sql)
        ? walked.map((candidate, index) =>
            index === 0 ? { ...candidate, connectorId: 'gated-source' } : candidate
          )
        : []
    )
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'gated-source' }])
    queueTableRows(schemaMock.embedding, [{ id: 'candidate-0', content: 'Gated', distance: 0.1 }])
    await search()
    expect(getForConnectors).toHaveBeenCalledExactlyOnceWith(['gated-source'], undefined)
  })

  it.each([undefined, 'gmail'])(
    'propagates caller cancellation before ranking with source %s',
    async (source) => {
      const cancellation = new AbortController()
      cancellation.abort(new Error('Search cancelled'))
      await expect(
        tagSearch({
          ...params,
          structuredFilters: [
            { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'release' },
          ],
          filters: { source },
          signal: cancellation.signal,
        })
      ).rejects.toThrow('Search cancelled')
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    }
  )
})

/** A retrieval row with only the fields fusion reads; the tag slots are irrelevant here. */
function searchRow(id: string, distance = 0.1): SearchResult {
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

describe('fuseByReciprocalRank', () => {
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
    expect(fused.map((row) => row.distance)).toEqual([0.2, 0.5, 0.1])
  })

  it('ranks a row found by both legs above rows found by only one', () => {
    const shared = searchRow('shared')
    const vectorOnly = searchRow('vector-only')
    const keywordOnly = searchRow('keyword-only')

    const fused = fuseByReciprocalRank(
      [
        [vectorOnly, shared],
        [keywordOnly, shared],
      ],
      10
    )

    /** `shared` is credited to both legs, so the following tie is even and resolves to the earliest list. */
    expect(fused.map((r) => r.id)).toEqual(['shared', 'vector-only', 'keyword-only'])
  })

  it('dedupes by chunk id, keeping the first occurrence', () => {
    const fromVector = searchRow('chunk-1', 0.2)
    const fromKeyword = { ...searchRow('chunk-1', 0.9), content: 'stale copy' }

    const fused = fuseByReciprocalRank([[fromVector], [fromKeyword]], 10)

    expect(fused).toHaveLength(1)
    expect(fused[0].content).toBe('chunk-1')
    expect(fused[0].distance).toBe(0.2)
  })

  it('scores by reciprocal rank so a deep double hit beats a shallow single hit', () => {
    const deepShared = searchRow('deep-shared')
    const topSingle = searchRow('top-single')

    /** `deep-shared` sits at rank 2 in both legs, `top-single` at rank 1 in one leg only. */
    const fused = fuseByReciprocalRank(
      [
        [topSingle, deepShared],
        [searchRow('other'), deepShared],
      ],
      10
    )

    expect(fused[0].id).toBe('deep-shared')
  })

  it('does not let the first leg starve the second at small topK', () => {
    const lexicalOnly = searchRow('lexical-only')
    const vectorOnly = searchRow('vector-only')

    /**
     * Rank 1 in each leg scores identically. Ordering by score alone would
     * always emit the first list's row, so a `topK: 1` hybrid search would
     * return exactly what vector-only search already returned.
     */
    expect(fuseByReciprocalRank([[lexicalOnly], [vectorOnly]], 1).map((r) => r.id)).toEqual([
      'lexical-only',
    ])
    expect(fuseByReciprocalRank([[lexicalOnly], [vectorOnly]], 2).map((r) => r.id)).toEqual([
      'lexical-only',
      'vector-only',
    ])
  })

  it('interleaves tied ranks so neither leg monopolizes the head', () => {
    const legA = [searchRow('a1'), searchRow('a2'), searchRow('a3')]
    const legB = [searchRow('b1'), searchRow('b2'), searchRow('b3')]

    expect(fuseByReciprocalRank([legA, legB], 6).map((r) => r.id)).toEqual([
      'a1',
      'b1',
      'a2',
      'b2',
      'a3',
      'b3',
    ])
  })

  it('does not let a shared top hit evict the lexical-only row at topK 2', () => {
    const shared = searchRow('shared')
    const lexicalOnly = searchRow('lexical-only')
    const vectorOnly = searchRow('vector-only')

    /**
     * `shared` is rank 1 in both legs. Crediting it to only one leg would
     * leave the round-robin owing the other leg the remaining slot, evicting
     * the row that only the shared hit's leg could produce.
     */
    const fused = fuseByReciprocalRank(
      [
        [shared, lexicalOnly],
        [shared, vectorOnly],
      ],
      2
    )

    expect(fused.map((r) => r.id)).toEqual(['shared', 'lexical-only'])
  })
})
