import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  resetEnvFlagsMock,
  schemaMock,
  setEnvFlags,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveTinKeywordQuery } = vi.hoisted(() => ({
  mockResolveTinKeywordQuery: vi.fn<() => Promise<string | null>>(async () => null),
}))

vi.mock('@/lib/sim-search/indexed/retrieval/tin-keyword', () => ({
  resolveTinKeywordQuery: mockResolveTinKeywordQuery,
}))

import type { KnowledgeAccessProvider, UserAccessScope } from '@/lib/knowledge/access/types'
import { SearchBudget } from '@/lib/knowledge/search/budget'
import type { KeywordSearchParams, SearchParams } from '@/lib/knowledge/search/candidates'
import { retrieveKnowledgeSearch } from '@/lib/knowledge/search/queries'
import type { SearchAccessPlan } from '@/lib/sim-search/indexed/retrieval/access-plan'
import { executeIndexedKeywordSearch } from '@/lib/sim-search/indexed/retrieval/keyword'
import { selectIndexedTagResults } from '@/lib/sim-search/indexed/retrieval/legs'
import {
  forgetSearchReach,
  type IndexedRetrievalContext,
  isSearchFiltered,
  PERMITTED_EXACT_DOCUMENT_LIMIT,
  type PermittedDocuments,
  resolvePermittedDocuments,
  resolveReach,
} from '@/lib/sim-search/indexed/retrieval/permitted'
import { forgetProjectionFilled } from '@/lib/sim-search/indexed/retrieval/projection-fill'
import { forgetIndexedVectorSources } from '@/lib/sim-search/indexed/retrieval/source-vector-indexes'
import { selectIndexedVectorResults } from '@/lib/sim-search/indexed/retrieval/vector'

/**
 * The projection-fill memo outlives a test; every case starts without one. Shared retrieval runs
 * these legs only while indexed organization search is on.
 */
beforeEach(() => {
  forgetProjectionFilled()
  setEnvFlags({ isLiveEnterpriseSearchEnabled: false })
})
afterEach(resetEnvFlagsMock)

/** A plan that admits every source and resolves no membership: what a test leaves unsaid. */
const openPlan = (): SearchAccessPlan => ({
  connectors: { workspace: [], admin: [], members: [], liveProofRequired: [] },
  observers: { confirmed: [], observed: [] },
  memberSources: [],
  connectorTypes: new Map(),
  uploads: true,
})

type Resolved = Partial<Omit<IndexedRetrievalContext, 'accessPlan'>> & {
  accessPlan?: Omit<SearchAccessPlan, 'connectors'> & {
    connectors: Omit<SearchAccessPlan['connectors'], 'liveProofRequired'> & {
      liveProofRequired?: readonly string[]
    }
  }
}

/** The caller's resolved state, split from the leg's own parameters. */
function context(
  { accessPlan, permitted, liveSourceAccess }: Resolved,
  params: SearchParams
): IndexedRetrievalContext {
  return {
    access: params.access as UserAccessScope,
    filtered: isSearchFiltered(params.filters),
    accessPlan: accessPlan
      ? {
          ...accessPlan,
          connectors: { liveProofRequired: [], ...accessPlan.connectors },
        }
      : openPlan(),
    permitted,
    liveSourceAccess,
  }
}

const vectorSearch = ({
  accessPlan,
  permitted,
  liveSourceAccess,
  ...params
}: SearchParams & Resolved) =>
  selectIndexedVectorResults(params, context({ accessPlan, permitted, liveSourceAccess }, params))

const tagSearch = ({
  accessPlan,
  permitted,
  liveSourceAccess,
  ...params
}: SearchParams & Resolved) =>
  selectIndexedTagResults(params, context({ accessPlan, permitted, liveSourceAccess }, params))

const keywordSearch = ({
  accessPlan,
  permitted,
  liveSourceAccess,
  ...params
}: KeywordSearchParams & Resolved) =>
  executeIndexedKeywordSearch(params, context({ accessPlan, permitted, liveSourceAccess }, params))

/**
 * The global `drizzle-orm` mock renders `sql` fragments to a `?`-placeholder
 * string via `toSQL()`, so we can assert the exact predicate each statement builds.
 */
function render(condition: unknown) {
  return (condition as { toSQL: () => { sql: string; params: unknown[] } }).toSQL()
}

/** The permitted-documents probe: the reach count and the saturation sentinel, never a slice. */
function isProbeStatement(sql: string) {
  return sql.includes('AS saturated') && !sql.includes('readable_chunks')
}

/** A graph walk decided on the row it visits. */
function isWalk(sql: string) {
  return sql.includes('on-row visibility') && !sql.includes('ranked_tin_chunks')
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

const bounded = (
  ...documents: Array<{ id: string; connectorId: string | null }>
): PermittedDocuments => ({ kind: 'bounded', documents })

describe('search-index legs rank identifiers before verification', () => {
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
    topK: 1,
    access: identity,
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

  it.each(['vector', 'tag-vector', 'tags', 'keyword'] as const)(
    '%s ranks identifiers before verification and loads content under the full predicate',
    async (mode) => {
      const candidates = [candidate('selected', 'allowed-source')]
      if (mode === 'vector' || mode === 'tag-vector') {
        exactPages.push([{ id: 'selected' }])
        queueRerank(candidates)
      }
      if (mode === 'keyword') keywordPages.push(candidates)
      if (mode === 'tags') queueTableRows(schemaMock.embedding, candidates)
      queueTableRows(schemaMock.embedding, [{ id: 'selected', content: 'verified result' }])
      const permitted = bounded({ id: 'doc-selected', connectorId: 'allowed-source' })
      const rows =
        mode === 'vector'
          ? await vectorSearch({ ...params, structuredFilters: undefined, permitted })
          : mode === 'tag-vector'
            ? await vectorSearch({ ...params, permitted })
            : mode === 'tags'
              ? await tagSearch(params)
              : await keywordSearch({
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
    await keywordSearch({ ...params, query: 'release', queryVector: params.queryVector! })
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
})

describe('permitted-document planner', () => {
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
    topK: 1,
    access: reader,
    queryVector: { vector: '[0.1,0.2]', dimensions: 1536, model: 'text-embedding-3-small' },
    distanceThreshold: 1,
  }
  const hit = (id: string, connectorId: string | null) => ({
    id,
    documentId: `doc-${id}`,
    connectorId,
    distance: 0.1,
  })
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
    const results = await vectorSearch({
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
    await vectorSearch({
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
    await vectorSearch({
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
    await vectorSearch({
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
    await vectorSearch({
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
    await keywordSearch({
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
    const keyword = (overrides: Partial<Parameters<typeof keywordSearch>[0]> = {}) =>
      keywordSearch({
        ...params,
        topK: 1,
        query: 'release',
        queryVector: params.queryVector!,
        permitted: unbounded,
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
      expect(mockResolveTinKeywordQuery).toHaveBeenCalledWith('release', 'english', undefined)
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
      await keywordSearch({
        ...params,
        query: 'release',
        queryVector: params.queryVector!,
        permitted: bounded(),
      })
    ).toEqual([])
    expect(dbChainMockFns.execute).not.toHaveBeenCalled()
  })

  it('reads a user scope through its reachable documents and reports saturation', async () => {
    probeRows = [{ id: 'doc-a', connectorId: null, saturated: false }]
    await resolvePermittedDocuments({
      knowledgeBaseIds: ['org-index'],
      access: { ...reader, tokens: ['u:reachable-documents@example.com'] },
      accessPlan: openPlan(),
      filtered: false,
    })
    const user = statements().find((query) => isProbeStatement(query.sql))!
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
  })

  it.each([
    [[{ id: null, connectorId: null, saturated: true }], 'unbounded'],
    [[{ id: 'doc-a', connectorId: null, saturated: false }], 'bounded'],
  ] as const)('resolves %j as %s', async (rows, kind) => {
    probeRows = [...rows]
    const permitted = await resolvePermittedDocuments({
      knowledgeBaseIds: ['org-index'],
      access: { ...reader, tokens: [`u:resolves-${kind}@example.com`] },
      accessPlan: openPlan(),
      filtered: false,
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
      resolvePermittedDocuments({
        knowledgeBaseIds,
        access,
        accessPlan: openPlan(),
        filtered: false,
      })
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
          accessPlan: openPlan(),
          filtered: false,
        })
      ).toEqual({ kind: 'unbounded', broad: true })
      expect(reachCounts()).toHaveLength(1)
      /** The next search probes and counts again rather than trusting a reach that was never measured. */
      await resolvePermittedDocuments({
        knowledgeBaseIds: ['org-index'],
        access: scope('timed-saturated'),
        budget: budget(),
        accessPlan: openPlan(),
        filtered: false,
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
      accessPlan: openPlan(),
      filtered: false,
    })
    expect(permitted.kind).toBe('unbounded')
    expect(budget.timedOut).toBe(true)
  })

  const liveSearch = {
    knowledgeBaseIds: ['org-index'],
    indexedRetrieval: true,
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
    topK: 1,
    access: reader,
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
      filtered: true,
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
})
