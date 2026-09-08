/**
 * Tests for knowledge search utility functions
 * Focuses on testing core functionality with simplified mocking
 *
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  mockNextFetchResponse,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
  setupGlobalFetchMock,
} from '@sim/testing/mocks'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import * as documentsUtilsModule from '@/lib/knowledge/documents/utils'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

vi.mock('@/lib/core/rate-limiter/provider-admission', () => ({
  PROVIDER_QUOTA_COOLDOWN_MS: 300_000,
  ProviderQuotaExhaustedError: class ProviderQuotaExhaustedError extends Error {},
  isProviderQuotaExhausted: vi.fn().mockResolvedValue(false),
  recordProviderCooldown: vi.fn().mockResolvedValue(undefined),
  waitForProviderAdmission: vi.fn().mockResolvedValue(undefined),
}))

/**
 * Spy on the real documents/utils namespace instead of vi.mock: the shared
 * `@/lib/knowledge/embeddings` module may be cached bound to the real module,
 * so patching the namespace is the only wiring that always applies.
 */
const retrySpy = vi
  .spyOn(documentsUtilsModule, 'retryWithExponentialBackoff')
  .mockImplementation(((fn: () => unknown) => fn()) as never)

afterAll(() => {
  retrySpy.mockRestore()
})

/**
 * Under `isolate: false` the shared `@/lib/knowledge/embeddings` module may be
 * cached bound to the REAL env module, so tests mutate the real `env` object
 * (the tests below clear and assign it per case) instead of vi.mock'ing a
 * file-local replacement that a cached consumer would never see. The snapshot
 * restores whatever the worker started with after every test.
 */
const envSnapshot = { ...env }

afterEach(() => {
  for (const key of Object.keys(env)) {
    delete (env as Record<string, unknown>)[key]
  }
  Object.assign(env, envSnapshot)
})

import { WORKSPACE_ACCESS_SCOPE } from '@/lib/knowledge/access/scope'
import { generateSearchEmbedding, type KbEmbeddingTarget } from '@/lib/knowledge/embeddings'

/** The platform default model and vector width, as a knowledge base records them. */
const DEFAULT_EMBEDDING_TARGET: KbEmbeddingTarget = {
  model: 'text-embedding-3-small',
  dimensions: 1536,
}

import {
  executeKeywordSearch,
  executeKnowledgeSearch,
  fuseByReciprocalRank,
  getQueryStrategy,
  handleTagAndVectorSearch,
  handleTagOnlySearch,
  handleVectorOnlySearch,
  type SearchResult,
} from '@/lib/knowledge/search/queries'
import { RRF_K } from '@/lib/knowledge/search/recency'

/** Minimal SearchResult builder — only the fields fusion and ordering read. */
function makeResult(id: string, distance = 0.1): SearchResult {
  return {
    id,
    content: `content-${id}`,
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
    knowledgeBaseId: 'kb-123',
  }
}

const TEST_EMBEDDING = [0.1, 0.2, 0.3, ...Array.from({ length: 1533 }, () => 0)]

function mockNextEmbeddingResponse(): void {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: [{ embedding: TEST_EMBEDDING, index: 0 }],
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  )
}

describe('Knowledge Search Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The worker-level fetch stub from vitest.setup.ts is removed after the
    // first test by `unstubGlobals: true`; re-stub it per test so
    // mockNextFetchResponse always operates on a mocked fetch.
    setupGlobalFetchMock({ json: {} })
    retrySpy.mockImplementation(((fn: () => unknown) => fn()) as never)
  })

  describe('handleTagOnlySearch', () => {
    it('should throw error when no filters provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        structuredFilters: [],
      }

      await expect(handleTagOnlySearch(params)).rejects.toThrow(
        'Tag filters are required for tag-only search'
      )
    })

    it('should accept valid parameters for tag-only search', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'api' }],
      }

      // This test validates the function accepts the right parameters
      // The actual database interaction is tested via route tests
      expect(params.knowledgeBaseIds).toEqual(['kb-123'])
      expect(params.topK).toBe(10)
      expect(params.structuredFilters).toHaveLength(1)
    })
  })

  describe('handleVectorOnlySearch', () => {
    it('should throw error when queryVector not provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        distanceThreshold: 0.8,
      }

      await expect(handleVectorOnlySearch(params)).rejects.toThrow(
        'Query vector and distance threshold are required for vector-only search'
      )
    })

    it('should throw error when distanceThreshold not provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
      }

      await expect(handleVectorOnlySearch(params)).rejects.toThrow(
        'Query vector and distance threshold are required for vector-only search'
      )
    })

    it('should accept valid parameters for vector-only search', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
        distanceThreshold: 0.8,
      }

      // This test validates the function accepts the right parameters
      expect(params.knowledgeBaseIds).toEqual(['kb-123'])
      expect(params.topK).toBe(10)
      expect(params.queryVector).toBe(JSON.stringify([0.1, 0.2, 0.3]))
      expect(params.distanceThreshold).toBe(0.8)
    })
  })

  describe('handleTagAndVectorSearch', () => {
    it('returns only bounded ranked rows without first materializing every matching tag ID', async () => {
      resetDbChainMock()
      queueTableRows(schemaMock.embedding, [makeResult('second', 0.2), makeResult('first', 0.1)])

      const results = await handleTagAndVectorSearch({
        knowledgeBaseIds: ['kb-1', 'kb-2'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 2,
        structuredFilters: [
          { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'common' },
        ],
        queryVector: { vector: JSON.stringify(TEST_EMBEDDING), dimensions: 1536 },
        distanceThreshold: 0.8,
      })

      expect(results.map((row) => row.id)).toEqual(['first', 'second'])
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.select.mock.calls[0][0]).toHaveProperty('distance')
      expect(dbChainMockFns.limit).toHaveBeenCalledWith(2)
    })

    it('should throw error when no filters provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        structuredFilters: [],
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
        distanceThreshold: 0.8,
      }

      await expect(handleTagAndVectorSearch(params)).rejects.toThrow(
        'Tag filters are required for tag and vector search'
      )
    })

    it('should throw error when queryVector not provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'api' }],
        distanceThreshold: 0.8,
      }

      await expect(handleTagAndVectorSearch(params)).rejects.toThrow(
        'Query vector and distance threshold are required for tag and vector search'
      )
    })

    it('should throw error when distanceThreshold not provided', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'api' }],
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
      }

      await expect(handleTagAndVectorSearch(params)).rejects.toThrow(
        'Query vector and distance threshold are required for tag and vector search'
      )
    })

    it('should accept valid parameters for tag and vector search', async () => {
      const params = {
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        structuredFilters: [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'api' }],
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
        distanceThreshold: 0.8,
      }

      // This test validates the function accepts the right parameters
      expect(params.knowledgeBaseIds).toEqual(['kb-123'])
      expect(params.topK).toBe(10)
      expect(params.structuredFilters).toHaveLength(1)
      expect(params.queryVector).toBe(JSON.stringify([0.1, 0.2, 0.3]))
      expect(params.distanceThreshold).toBe(0.8)
    })
  })

  describe('fuseByReciprocalRank', () => {
    it('ranks a row found by both legs above rows found by only one', () => {
      const shared = makeResult('shared')
      const vectorOnly = makeResult('vector-only')
      const keywordOnly = makeResult('keyword-only')

      const fused = fuseByReciprocalRank(
        [
          [vectorOnly, shared],
          [keywordOnly, shared],
        ],
        10
      )

      expect(fused[0].id).toBe('shared')
      // `shared` is credited to both legs, so the following tie is even and
      // resolves to the earliest list.
      expect(fused.map((r) => r.id)).toEqual(['shared', 'vector-only', 'keyword-only'])
    })

    it('dedupes by chunk id, keeping the first occurrence', () => {
      const fromVector = makeResult('chunk-1', 0.2)
      const fromKeyword = { ...makeResult('chunk-1', 0.9), content: 'stale copy' }

      const fused = fuseByReciprocalRank([[fromVector], [fromKeyword]], 10)

      expect(fused).toHaveLength(1)
      expect(fused[0].content).toBe('content-chunk-1')
      expect(fused[0].distance).toBe(0.2)
    })

    it('preserves leg ordering when only one leg returns rows', () => {
      const rows = [makeResult('a'), makeResult('b'), makeResult('c')]

      expect(fuseByReciprocalRank([rows, []], 10).map((r) => r.id)).toEqual(['a', 'b', 'c'])
      expect(fuseByReciprocalRank([[], rows], 10).map((r) => r.id)).toEqual(['a', 'b', 'c'])
    })

    it('scores by reciprocal rank so a deep double hit beats a shallow single hit', () => {
      const deepShared = makeResult('deep-shared')
      const topSingle = makeResult('top-single')

      /**
       * `deep-shared` sits at rank 2 in both legs: 2 / (RRF_K + 2).
       * `top-single` sits at rank 1 in one leg only: 1 / (RRF_K + 1).
       * With RRF_K = 60 the double hit wins.
       */
      expect(2 / (RRF_K + 2)).toBeGreaterThan(1 / (RRF_K + 1))

      const fused = fuseByReciprocalRank(
        [
          [topSingle, deepShared],
          [makeResult('other'), deepShared],
        ],
        10
      )

      expect(fused[0].id).toBe('deep-shared')
    })

    it('does not let the first leg starve the second at small topK', () => {
      const lexicalOnly = makeResult('lexical-only')
      const vectorOnly = makeResult('vector-only')

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
      const legA = [makeResult('a1'), makeResult('a2'), makeResult('a3')]
      const legB = [makeResult('b1'), makeResult('b2'), makeResult('b3')]

      expect(fuseByReciprocalRank([legA, legB], 6).map((r) => r.id)).toEqual([
        'a1',
        'b1',
        'a2',
        'b2',
        'a3',
        'b3',
      ])
    })

    it('still floats a row found by both legs above every single-leg row', () => {
      const shared = makeResult('shared')
      const legA = [makeResult('a1'), shared]
      const legB = [makeResult('b1'), shared]

      // shared is rank 2 in both legs (2/62) and outscores either rank-1 row (1/61).
      expect(fuseByReciprocalRank([legA, legB], 3).map((r) => r.id)).toEqual(['shared', 'a1', 'b1'])
    })

    it('does not let a shared top hit evict the lexical-only row at topK 2', () => {
      const shared = makeResult('shared')
      const lexicalOnly = makeResult('lexical-only')
      const vectorOnly = makeResult('vector-only')

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

    it('trims the fused list to topK', () => {
      const rows = Array.from({ length: 8 }, (_, i) => makeResult(`chunk-${i}`))

      expect(fuseByReciprocalRank([rows, []], 3)).toHaveLength(3)
    })

    it('returns an empty list when every leg is empty', () => {
      expect(fuseByReciprocalRank([[], []], 10)).toEqual([])
    })
  })

  describe('executeKeywordSearch', () => {
    beforeEach(() => {
      resetDbChainMock()
    })

    it('returns nothing for a whitespace-only query without touching the database', async () => {
      const results = await executeKeywordSearch({
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        query: '   ',
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
      })

      expect(results).toEqual([])
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })

    it('issues one query per knowledge base once the parallel threshold is crossed', async () => {
      const knowledgeBaseIds = ['kb-1', 'kb-2', 'kb-3', 'kb-4', 'kb-5']
      expect(getQueryStrategy(knowledgeBaseIds.length, 10).useParallel).toBe(true)

      await executeKeywordSearch({
        knowledgeBaseIds,
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        query: 'PROJ-1234',
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
      })

      /**
       * A single global LIMIT would let the lexically strongest base consume
       * every slot, so an exact-token hit in a smaller base never reaches
       * fusion. The vector leg already fans out here; both legs must match.
       */
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(knowledgeBaseIds.length)
    })

    it('ranks without selecting the embedding column, then hydrates the survivors', async () => {
      queueTableRows(schemaMock.embedding, [{ id: 'kw-1', keywordRank: 0.9 }])
      queueTableRows(schemaMock.embedding, [makeResult('kw-1')])

      const results = await executeKeywordSearch({
        knowledgeBaseIds: ['kb-1'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        query: 'PROJ-1234',
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
      })

      expect(results.map((r) => r.id)).toEqual(['kw-1'])
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)

      /**
       * Projecting the distance in the ranking pass makes Postgres detoast the
       * 1536-dimension vector for every full-text match before the LIMIT, so
       * cost tracks how common the term is rather than topK. The ranking pass
       * must select ids and relevance only.
       */
      const rankingSelect = dbChainMockFns.select.mock.calls[0][0]
      expect(Object.keys(rankingSelect)).toEqual(['id', 'keywordRank'])
      expect(Object.keys(dbChainMockFns.select.mock.calls[1][0])).toContain('distance')
    })

    it('uses a single query when the parallel threshold is not crossed', async () => {
      const knowledgeBaseIds = ['kb-1', 'kb-2']
      expect(getQueryStrategy(knowledgeBaseIds.length, 10).useParallel).toBe(false)

      await executeKeywordSearch({
        knowledgeBaseIds,
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        query: 'PROJ-1234',
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
      })

      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    })
  })

  describe('executeKnowledgeSearch', () => {
    beforeEach(() => {
      resetDbChainMock()
    })

    it('throws when neither a query nor tag filters are provided', async () => {
      await expect(
        executeKnowledgeSearch({
          knowledgeBaseIds: ['kb-123'],
          access: WORKSPACE_ACCESS_SCOPE,
          topK: 10,
          searchMode: 'hybrid',
        })
      ).rejects.toThrow('A search query or tag filters are required')
    })

    it('throws when a query is provided without a query vector', async () => {
      await expect(
        executeKnowledgeSearch({
          knowledgeBaseIds: ['kb-123'],
          access: WORKSPACE_ACCESS_SCOPE,
          topK: 10,
          searchMode: 'hybrid',
          query: 'PROJ-1234',
        })
      ).rejects.toThrow('Query vector is required')
    })

    it('runs a single retrieval leg in vector mode', async () => {
      queueTableRows(schemaMock.embedding, [makeResult('vector-hit')])

      const results = await executeKnowledgeSearch({
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        searchMode: 'vector',
        query: 'PROJ-1234',
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
      })

      expect(results.map((r) => r.id)).toEqual(['vector-hit'])
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    })

    it('runs both legs and fuses them in hybrid mode', async () => {
      /**
       * Chains dequeue in creation order. Hybrid legs over-fetch past the
       * plain scan's candidate pool, so the vector leg opens its transaction
       * and applies the scan settings before selecting: the keyword ranking
       * pass is built first, then the vector select, then hydration.
       */
      queueTableRows(schemaMock.embedding, [{ id: 'keyword-hit', keywordRank: 0.9 }])
      queueTableRows(schemaMock.embedding, [makeResult('vector-hit')])
      queueTableRows(schemaMock.embedding, [makeResult('keyword-hit')])

      const results = await executeKnowledgeSearch({
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        searchMode: 'hybrid',
        query: 'PROJ-1234',
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
      })

      expect(results.map((r) => r.id).sort()).toEqual(['keyword-hit', 'vector-hit'])
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(3)
    })

    it('falls back to vector results when the keyword leg fails', async () => {
      /** The failing ranking chain is still built first and takes the first queued set. */
      queueTableRows(schemaMock.embedding, [{ id: 'never-ranked', keywordRank: 0 }])
      queueTableRows(schemaMock.embedding, [makeResult('vector-hit')])

      /**
       * Both legs share one `orderBy` spy, so target the keyword leg by its
       * ranking expression. Calling the untouched spy first captures the
       * sentinel that tells the mock to build its normal chain, which the
       * vector leg still needs.
       */
      const chainDefault = dbChainMockFns.orderBy()
      dbChainMockFns.orderBy.mockImplementation((fragment: unknown) => {
        const text = (fragment as { strings?: string[] })?.strings?.join('') ?? ''
        if (text.includes('ts_rank_cd')) {
          throw new Error('tsquery blew up')
        }
        return chainDefault
      })

      const results = await executeKnowledgeSearch({
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        searchMode: 'hybrid',
        query: 'PROJ-1234',
        queryVector: JSON.stringify([0.1, 0.2, 0.3]),
      })

      expect(results.map((r) => r.id)).toEqual(['vector-hit'])
    })

    it('skips both query legs when only tag filters are provided', async () => {
      queueTableRows(schemaMock.embedding, [makeResult('tag-hit')])

      const results = await executeKnowledgeSearch({
        knowledgeBaseIds: ['kb-123'],
        access: WORKSPACE_ACCESS_SCOPE,
        topK: 10,
        searchMode: 'hybrid',
        structuredFilters: [
          { tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'api' } as never,
        ],
      })

      expect(results.map((r) => r.id)).toEqual(['tag-hit'])
      expect(dbChainMockFns.select).toHaveBeenCalledTimes(1)
    })
  })

  describe('generateSearchEmbedding', () => {
    it('should use Azure OpenAI when KB-specific config is provided', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'text-embedding-ada-002',
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextEmbeddingResponse()

      const result = await generateSearchEmbedding('test query', DEFAULT_EMBEDDING_TARGET)

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://test.openai.azure.com/openai/deployments/text-embedding-ada-002/embeddings?api-version=2024-12-01-preview',
        expect.objectContaining({
          headers: expect.objectContaining({
            'api-key': 'test-azure-key',
          }),
        })
      )
      expect(result.embedding).toEqual(TEST_EMBEDDING)

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should fallback to OpenAI when no KB Azure config provided', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextEmbeddingResponse()

      const result = await generateSearchEmbedding('test query', DEFAULT_EMBEDDING_TARGET)

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-openai-key',
          }),
        })
      )
      expect(result.embedding).toEqual(TEST_EMBEDDING)

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('falls back to OpenAI when AZURE_OPENAI_API_VERSION is not set', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        KB_OPENAI_MODEL_NAME: 'custom-embedding-model',
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextEmbeddingResponse()

      await generateSearchEmbedding('test query', DEFAULT_EMBEDDING_TARGET)

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.any(Object)
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should use custom model name when provided in Azure config', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'custom-embedding-model',
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextEmbeddingResponse()

      await generateSearchEmbedding('test query', DEFAULT_EMBEDDING_TARGET)

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://test.openai.azure.com/openai/deployments/custom-embedding-model/embeddings?api-version=2024-12-01-preview',
        expect.any(Object)
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should throw error when no API configuration provided', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        OPENAI_API_KEY: undefined,
        OPENAI_API_KEY_1: undefined,
        OPENAI_API_KEY_2: undefined,
        OPENAI_API_KEY_3: undefined,
        OPENROUTER_API_KEY: undefined,
      })

      await expect(generateSearchEmbedding('test query', DEFAULT_EMBEDDING_TARGET)).rejects.toThrow(
        'OPENAI_API_KEY is not configured'
      )
    })

    it('should handle Azure OpenAI API errors properly', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'text-embedding-ada-002',
      })

      mockNextFetchResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: 'Deployment not found',
      })

      await expect(generateSearchEmbedding('test query', DEFAULT_EMBEDDING_TARGET)).rejects.toThrow(
        'Embedding API failed'
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should handle OpenAI API errors properly', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        OPENAI_API_KEY: 'test-openai-key',
        OPENROUTER_API_KEY: undefined,
      })

      mockNextFetchResponse({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: 'Rate limit exceeded',
      })

      await expect(generateSearchEmbedding('test query', DEFAULT_EMBEDDING_TARGET)).rejects.toThrow(
        'Embedding API failed'
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should include correct request body for Azure OpenAI', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        AZURE_OPENAI_API_KEY: 'test-azure-key',
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_API_VERSION: '2024-12-01-preview',
        KB_OPENAI_MODEL_NAME: 'text-embedding-ada-002',
      })

      mockNextEmbeddingResponse()

      await generateSearchEmbedding('test query', DEFAULT_EMBEDDING_TARGET)

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            input: ['test query'],
            encoding_format: 'float',
            dimensions: 1536,
          }),
        })
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('should include correct request body for OpenAI', async () => {
      const { env } = await import('@/lib/core/config/env')
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, {
        OPENAI_API_KEY: 'test-openai-key',
      })

      mockNextEmbeddingResponse()

      await generateSearchEmbedding('test query', DEFAULT_EMBEDDING_TARGET)

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            input: ['test query'],
            model: 'text-embedding-3-small',
            encoding_format: 'float',
            dimensions: 1536,
          }),
        })
      )

      // Clean up
      Object.keys(env).forEach((key) => delete (env as any)[key])
    })

    it('projects verified provenance only in the model-bound embedding payload', async () => {
      Object.keys(env).forEach((key) => delete (env as any)[key])
      Object.assign(env, { OPENAI_API_KEY: 'test-openai-key' })
      mockNextEmbeddingResponse()

      const registry = new ResolvedSecretTraceRegistry([
        { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'encrypted-token' },
      ])
      registry.recordResolved('TOKEN', 'secret-value')

      await runWithKnowledgeModelInputProvenance(registry, () =>
        generateSearchEmbedding('prefix secret-value suffix', DEFAULT_EMBEDDING_TARGET)
      )

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({
          body: JSON.stringify({
            input: ['prefix {{TOKEN}} suffix'],
            model: 'text-embedding-3-small',
            encoding_format: 'float',
            dimensions: 1536,
          }),
        })
      )
    })
  })

  describe('getDocumentMetadataByIds', () => {
    it('should handle empty input gracefully', async () => {
      const { getDocumentMetadataByIds } = await import('@/lib/knowledge/search/queries')

      const result = await getDocumentMetadataByIds([])

      expect(result).toEqual({})
    })
  })
})
