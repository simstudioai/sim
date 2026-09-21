/** Real search adapters, application authorization, PostgreSQL/pgvector, and result processing. */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  copilotChats,
  credential,
  credentialGroup,
  document,
  embedding,
  embeddingSearch,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  member,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { createLogger, Logger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, type MockInstance, vi } from 'vitest'
import { z } from 'zod'
import { workspaceKnowledgeSearchDataSchema } from '@/lib/api/contracts/knowledge/search'
import { internalSessionAuth } from '@/lib/api/server/routes'
import type {
  MothershipStreamV1CheckpointPausePayload,
  MothershipStreamV1ToolCallDescriptor,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { isContractStreamEventEnvelope } from '@/lib/copilot/request/session/contract'
import {
  readDocumentServerTool,
  searchWorkspaceServerTool,
} from '@/lib/copilot/tools/server/knowledge/workspace-search'
import { seedSearchReaderFixture } from '@/lib/knowledge/__integration__/seed-search-reader-fixture'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { type KnowledgeSearchTagFilter, searchKnowledge } from '@/lib/knowledge/application/search'
import type { KbEmbeddingDimensions } from '@/lib/knowledge/embedding-models'
import {
  SearchBudget,
  SearchDeadlineError,
  type SearchExecutor,
} from '@/lib/knowledge/search/budget'
import type { SearchStage } from '@/lib/knowledge/search/diagnostics'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { embeddingCandidateDistance } from '@/lib/knowledge/vector-columns'
import { POST as searchRoute } from '@/app/api/knowledge/search/route'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/** Initialize controlled provider configuration before the real application modules load. */
vi.hoisted(() => {
  if (process.env.KNOWLEDGE_SEARCH_PERFORMANCE_TEST === 'true') {
    Object.assign(process.env, {
      OPENAI_API_KEY: 'isolated-embedding-http-fixture',
      GEMINI_API_KEY: 'isolated-gemini-http-fixture',
      CONFLUENCE_CLIENT_ID: 'isolated-confluence-fixture-client',
      CONFLUENCE_CLIENT_SECRET: 'isolated-confluence-fixture-secret',
    })
  }
})

const externalFetch = globalThis.fetch
const enabled = process.env.KNOWLEDGE_SEARCH_PERFORMANCE_TEST === 'true'
const batchSize = 1000
const MIN_CHUNK_COUNT = 5000
const chunkCount = Number(process.env.KNOWLEDGE_SEARCH_PERFORMANCE_CHUNKS ?? 20_000)
const unrelatedChunkCount = Number(
  process.env.KNOWLEDGE_SEARCH_PERFORMANCE_UNRELATED_CHUNKS ??
    Math.max(MIN_CHUNK_COUNT, Math.ceil(chunkCount / (2 * batchSize)) * batchSize)
)
const evictSharedBuffers = process.env.KNOWLEDGE_SEARCH_PERFORMANCE_EVICT_BUFFERS === 'true'
const dimensions = 1536
const candidateDimensions = 512
const HYBRID_CANDIDATE_LIMIT = 1600
const chunksPerDocument = 4
const logger = createLogger('SearchLatencyIntegration')
const fixtureSchema = z.object({
  aliceId: z.uuid(),
  bobId: z.uuid(),
  workspaceId: z.uuid(),
  organizationId: z.uuid(),
  knowledgeBaseId: z.uuid(),
  connectorId: z.uuid(),
  lockId: z.uuid(),
  groups: z.array(z.string()).length(3),
  groupIds: z.array(z.uuid()).length(3),
})
const reuseFile = enabled ? process.env.KNOWLEDGE_SEARCH_PERFORMANCE_REUSE_REPORT_FILE : undefined
function readFixtureReport(file: string) {
  /** Captured SQL plans include repeated high-dimensional query parameters. */
  if (statSync(file).size > 64 * 1024 * 1024) throw new Error('Fixture report exceeds 64 MiB')
  return z
    .object({
      fixture: fixtureSchema,
      unrelatedFixture: fixtureSchema,
      fullWidthFixture: fixtureSchema.optional(),
      method: z.object({ fixtureVersion: z.literal(2) }),
    })
    .parse(JSON.parse(readFileSync(file, 'utf8')))
}
const reused = reuseFile ? readFixtureReport(reuseFile) : undefined
const ids = reused?.fixture ?? createKnowledgeAclFixtureIds()
const unrelated = reused?.unrelatedFixture ?? createKnowledgeAclFixtureIds()
const fullWidthFixture = reused?.fullWidthFixture ?? createKnowledgeAclFixtureIds()
const FULL_WIDTH_CHUNK_COUNT = 5000
const organizationChatId = generateId()
function topicVector(topic = 0) {
  const vector = Array.from({ length: dimensions }, (_, index) =>
    Math.sin(
      (((index * 137 + Math.floor(index / candidateDimensions) * 57) % candidateDimensions) + 1) *
        (topic + 1) *
        12.9898
    )
  )
  const magnitude = Math.hypot(...vector)
  return vector.map((value) => value / magnitude)
}
const queryVector = topicVector()

/**
 * The exact nearest chunks on the projection's stored halfvec, which is what the page's order
 * is measured against: the walk ranks on that column, and nothing rescores it.
 */
async function exactProjectionNeighbors(vector: number[], limit: number, readerClause?: SQL) {
  const distance = embeddingCandidateDistance(
    dimensions as KbEmbeddingDimensions,
    JSON.stringify(vector),
    'text-embedding-3-small'
  )
  /** Unaliased: the distance expression qualifies its column with the table's own name. */
  return db.execute<{ id: string }>(sql`SELECT ${embeddingSearch.id} AS id FROM ${embeddingSearch}
    INNER JOIN document d ON d.id = ${embeddingSearch.documentId}
    WHERE ${embeddingSearch.knowledgeBaseId} = ${ids.knowledgeBaseId}
      AND ${embeddingSearch.enabled} ${readerClause ?? sql``}
    ORDER BY (${distance}) + 0, ${embeddingSearch.id}
    LIMIT ${limit}`)
}
const captured: CapturedQuery[] = []
const report: Record<string, unknown> = {
  fixture: ids,
  unrelatedFixture: unrelated,
  fullWidthFixture,
  method: {
    fixtureVersion: 2,
    chunkCount,
    unrelatedChunkCount,
    fullWidthChunkCount: FULL_WIDTH_CHUNK_COUNT,
    dimensions,
    candidateDimensions,
    chunksPerDocument,
    sql: 'Captured from real search application adapters; no hand-written retrieval query',
    providers:
      'Embedding and source-permission HTTP responses are controlled; internal search and authorization code is real',
    vectors:
      'Normalized 512-dimensional topic/noise geometry with permuted copies across 1536 dimensions; verifies prefix candidate ranking, not semantic embedding quality',
    cache: evictSharedBuffers
      ? 'Selected workspace and organization samples evict PostgreSQL shared buffers; operating-system cache is not cleared'
      : 'First and repeated samples; no claim of a cold operating-system cache',
    layout: reused
      ? 'Reused fixture; physical layout is inherited from its original report'
      : 'Tenant batches interleaved; chunks permuted across document identities',
  },
}
let capture = false
let embeddingCalls = 0
let readerCalls = 0
let readerRevoked = false
const previousDebug = db.$client.options.debug
let diagnosticLog: MockInstance<Logger['info']> | undefined

interface CapturedQuery {
  query: string
  parameters: NonNullable<Parameters<typeof db.$client.unsafe>[1]>
}

interface ExplainNode {
  'Node Type': string
  'Actual Rows': number
  'Actual Loops': number
  'Rows Removed by Filter'?: number
  'Plan Rows'?: number
  'Shared Hit Blocks'?: number
  'Shared Read Blocks'?: number
  'Index Name'?: string
  'Relation Name'?: string
  'Subplan Name'?: string
  'CTE Name'?: string
  Output?: string[]
  Plans?: ExplainNode[]
}

const explainNodeSchema: z.ZodType<ExplainNode> = z.lazy(() =>
  z
    .object({
      'Node Type': z.string(),
      'Actual Rows': z.number(),
      'Actual Loops': z.number(),
      'Rows Removed by Filter': z.number().optional(),
      'Plan Rows': z.number().optional(),
      'Shared Hit Blocks': z.number().optional(),
      'Shared Read Blocks': z.number().optional(),
      'Index Name': z.string().optional(),
      'Relation Name': z.string().optional(),
      'Subplan Name': z.string().optional(),
      'CTE Name': z.string().optional(),
      Output: z.array(z.string()).optional(),
      Plans: z.array(explainNodeSchema).optional(),
    })
    .passthrough()
)
const explainSchema = z.array(z.object({ Plan: explainNodeSchema }).passthrough()).length(1)

/** The ANN stage must not fetch full vectors, even for planner-added sort projections. */
function assertCompactCandidates(node: ExplainNode) {
  expect(node['Relation Name']).not.toBe('embedding')
  for (const expression of node.Output ?? [])
    expect(expression).not.toMatch(/binary_quantize\([^)]*embedding\.embedding/)
  for (const child of node.Plans ?? []) assertCompactCandidates(child)
}

function explainNodes(node: ExplainNode): ExplainNode[] {
  return [node, ...(node.Plans ?? []).flatMap(explainNodes)]
}

/** Broad ranking must stop the ordered ANN scan instead of sorting every accessible chunk. */
/**
 * The bounded ANN traversal, identified by the visibility lateral it alone carries. The probe
 * aliases its own lateral `scoped_chunk`, so this cannot match it, and matching on the rendered
 * clause casing would silently stop these assertions from running at all.
 */
/** The vector page reads a pool slice's identities from the projection and its documents. */
const VECTOR_PAGE_JOIN =
  'INNER JOIN "document" ON "document"."id" = "embedding_search"."document_id"'

function isVectorCandidateQuery(statement: string) {
  return statement.toLowerCase().includes(') as visible')
}

function assertIndexedCandidates(
  plan: ExplainNode,
  candidateLimit: number,
  width = candidateDimensions
) {
  const indexName =
    width === 1536
      ? 'embedding_search_cosine_hnsw_idx'
      : `embedding_search_${width}_cosine_hnsw_idx`
  const nodes = explainNodes(plan)
  expect(nodes.some((node) => node['Index Name'] === indexName && node['Actual Loops'] > 0)).toBe(
    true
  )
  /** The graph walk supplies the order, so a Sort here means the index ordering was discarded. */
  expect(nodes.some((node) => node['Node Type'] === 'Sort')).toBe(false)
  /**
   * The traversal is the whole candidate set. Reaching the projection by document lookup or by
   * sequential scan is the corpus-wide rescan this query exists to avoid, at any candidate count.
   */
  expect(nodes.some((node) => node['Index Name'] === 'embedding_search_document_lookup_idx')).toBe(
    false
  )
  expect(
    nodes.some(
      (node) => node['Relation Name'] === 'embedding_search' && node['Node Type'] === 'Seq Scan'
    )
  ).toBe(false)
  const traversed = nodes.find((node) => node['Index Name'] === indexName)!
  expect(traversed['Actual Rows']).toBeLessThanOrEqual(candidateLimit)
}

/** Small scopes must seek chunk metadata by document without reading the full vector projection. */
function assertIndexedChunkProbe(node: ExplainNode): number {
  let lookups = 0
  if (node['Relation Name'] === 'embedding_search') {
    expect(['Index Scan', 'Index Only Scan']).toContain(node['Node Type'])
    expect(node['Index Name']).toBe('embedding_search_document_lookup_idx')
    expect((node.Output ?? []).join(' ')).not.toMatch(/(?:embedding_search\.)?(?:vector|binary)/)
    lookups = node['Actual Loops']
  }
  for (const child of node.Plans ?? []) lookups += assertIndexedChunkProbe(child)
  return lookups
}

/** Keyword sort memory must scale with identities and scores, not the matched document text. */
function assertScalarKeywordSorts(node: ExplainNode) {
  if (node['Node Type'] === 'Sort') {
    expect((node.Output ?? []).join(' ')).not.toContain('content_tsv')
  }
  for (const child of node.Plans ?? []) assertScalarKeywordSorts(child)
}

function saveReport() {
  const file = process.env.KNOWLEDGE_SEARCH_PERFORMANCE_REPORT_FILE
  if (file) writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 })
}

/** Only the disposable fixture may evict shared buffers; the operating-system cache stays intact. */
async function prepareOrganizationSample(label: string) {
  if (!evictSharedBuffers) return
  const [eviction] = await db.execute<{ buffers: number; evicted: number }>(sql`
    WITH cached AS MATERIALIZED (
      SELECT bufferid FROM pg_buffercache
      WHERE reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
    ) SELECT count(*)::int AS buffers,
      count(*) FILTER (WHERE pg_buffercache_evict(bufferid))::int AS evicted
    FROM cached
  `)
  report[`${label}.sharedBufferEviction`] = eviction
  saveReport()
}

const diagnosticSchema = z
  .object({
    surface: z.enum(['dashboard', 'copilot', 'workflow', 'api']),
    outcome: z.enum(['success', 'partial']),
    elapsedMs: z.number(),
    vectorBudgetMs: z.number().positive(),
    vectorCandidateDimensions: z.number().optional(),
    vectorCandidateLimit: z.number().optional(),
    vectorCandidateScan: z.enum(['planned', 'underfilled']).optional(),
    retrievalStatus: z.enum(['complete', 'partial']),
    timedOutLegs: z.array(z.enum(['vector', 'keyword', 'tags'])),
    toolResultBytes: z.number().int().nonnegative().optional(),
    passageBytes: z.number().int().nonnegative().optional(),
    maxPassageBytes: z.number().int().nonnegative().optional(),
    uniqueDocumentCount: z.number().int().nonnegative().optional(),
    stages: z.record(
      z.string(),
      z.object({
        count: z.number(),
        totalMs: z.number(),
        maxMs: z.number(),
        errors: z.number(),
      })
    ),
  })
  .passthrough()

const resultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    results: z.array(
      z.object({
        documentId: z.string(),
        content: z.string(),
        knowledgeBaseId: z.string(),
        embeddingId: z.string().optional(),
      })
    ),
  }),
})

async function search(
  userId = ids.aliceId,
  query = 'Orion deployment',
  filters: WorkspaceSearchFilters = {},
  organizationScope = false,
  topK = 15
) {
  return resultSchema.parse(
    await searchWorkspaceServerTool.execute(
      { query, topK, ...filters },
      {
        userId,
        ...(organizationScope
          ? { organizationId: ids.organizationId, chatId: organizationChatId }
          : { workspaceId: ids.workspaceId }),
        requestMode: 'assistant',
        toolCallId: generateId(),
        copilotToolExecution: true,
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
          userId,
          ...(organizationScope ? {} : { workspaceId: ids.workspaceId }),
        }),
      }
    )
  )
}

async function searchDashboard(
  query = 'Orion deployment',
  userId = ids.aliceId,
  organizationScope = false,
  topK = 15
) {
  const authenticate = vi.spyOn(internalSessionAuth, 'authenticate').mockResolvedValue({
    kind: 'session',
    userId,
    sessionId: 'fixture-dashboard',
  })
  try {
    const response = await searchRoute(
      new NextRequest('http://localhost/api/knowledge/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(organizationScope
            ? { organizationId: ids.organizationId }
            : { workspaceId: ids.workspaceId }),
          query,
          topK,
        }),
      })
    )
    expect(response.status).toBe(200)
    return {
      success: true as const,
      data: workspaceKnowledgeSearchDataSchema.parse((await response.json()).data),
    }
  } finally {
    authenticate.mockRestore()
  }
}

async function searchWorkspaceKb(
  query = 'Orion deployment',
  options: {
    principal?: Principal
    tagFilters?: KnowledgeSearchTagFilter[]
    fixture?: typeof ids
  } = {}
) {
  const fixture = options.fixture ?? ids
  const result = await searchKnowledge.execute({
    principal: options.principal ?? {
      kind: 'workspace_api_key',
      workspaceId: fixture.workspaceId,
      keyId: 'fixture-search-key',
    },
    input: {
      workspaceId: fixture.workspaceId,
      knowledgeBaseIds: [fixture.knowledgeBaseId],
      query,
      topK: 15,
      searchMode: 'vector',
      surface: 'workflow',
      tagFilters: options.tagFilters,
    },
  })
  return resultSchema.parse({ success: true, data: result })
}

/** Allow either index or filtered plans, but require successful retrieval within the real surface budget. */
function expectCompleteVectorSearch(diagnostics: z.infer<typeof diagnosticSchema>) {
  const budget = diagnostics.surface === 'dashboard' ? 3000 : 8000
  expect(diagnostics).toMatchObject({
    outcome: 'success',
    vectorBudgetMs: budget,
    retrievalStatus: 'complete',
    timedOutLegs: [],
  })
  expect(diagnostics.stages.vector.totalMs).toBeLessThanOrEqual(budget)
}

async function sample(
  label: string,
  run: () => ReturnType<typeof search>,
  options: { explain?: boolean; candidateScanRowLimit?: number } = {}
) {
  captured.length = 0
  diagnosticLog?.mockClear()
  const start = performance.now()
  capture = true
  let result: Awaited<ReturnType<typeof search>>
  try {
    result = await run()
  } finally {
    capture = false
  }
  const milliseconds = performance.now() - start
  const completed =
    diagnosticLog?.mock.calls.filter(([message]) => message === 'Knowledge search completed') ?? []
  expect(completed).toHaveLength(1)
  const diagnostics = diagnosticSchema.parse(completed[0][1])
  expect(diagnostics.stages.embedding.count).toBe(1)
  expect(diagnostics.stages.retrieval.count).toBe(1)
  if (diagnostics.surface === 'copilot') {
    const passageBytes = result.data.results.map((row) => Buffer.byteLength(row.content))
    expect(diagnostics.passageBytes).toBe(passageBytes.reduce((total, bytes) => total + bytes, 0))
    expect(diagnostics.maxPassageBytes).toBe(Math.max(0, ...passageBytes))
    expect(diagnostics.uniqueDocumentCount).toBe(
      new Set(result.data.results.map((row) => row.documentId)).size
    )
    expect(diagnostics.toolResultBytes).toBeGreaterThan(diagnostics.passageBytes!)
  }
  expect(captured.length).toBeLessThan(300)
  const searches = captured.filter(
    (item) =>
      (item.query.includes('from "embedding"') ||
        item.query.includes('FROM "embedding"') ||
        item.query.includes('from "embedding_search"') ||
        item.query.includes('FROM "embedding_search"') ||
        item.query.includes('from "embedding_keyword_search"') ||
        item.query.includes('FROM "embedding_keyword_search"')) &&
      (item.query.includes('order by') ||
        item.query.includes('limit') ||
        item.query.includes('CROSS JOIN LATERAL') ||
        isVectorCandidateQuery(item.query) ||
        item.query.includes(VECTOR_PAGE_JOIN) ||
        item.query.includes('WITH matched_keyword_chunks'))
  )
  const plans: Array<
    CapturedQuery & {
      kind: 'keyword' | 'vector' | 'page' | 'probe'
      plan: z.infer<typeof explainSchema>
    }
  > = []
  report[label] = {
    milliseconds,
    diagnostics,
    queryCount: captured.length,
    resultCount: result.data.results.length,
    explainsDeferred: options.explain === false,
    plans,
  }
  saveReport()
  for (const query of options.explain === false ? [] : searches) {
    const plan = await db.$client.begin(async (tx) => {
      await tx.unsafe("SET LOCAL statement_timeout = '45s'")
      await tx.unsafe('SET LOCAL jit = off')
      await tx.unsafe("SET LOCAL hnsw.iterative_scan = 'relaxed_order'")
      await tx.unsafe('SET LOCAL hnsw.max_scan_tuples = 20000')
      if (isVectorCandidateQuery(query.query)) {
        await tx.unsafe('SET LOCAL hnsw.max_scan_tuples = 1000')
        await tx.unsafe('SET LOCAL hnsw.ef_search = 1000')
        await tx.unsafe('SET LOCAL hnsw.scan_mem_multiplier = 2')
      }
      return tx.unsafe(
        `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ${query.query}`,
        query.parameters
      )
    })
    const parsedPlan = explainSchema.parse(plan[0]['QUERY PLAN'])
    plans.push({
      kind: query.query.includes('keyword_rank')
        ? 'keyword'
        : isVectorCandidateQuery(query.query)
          ? 'vector'
          : query.query.includes('order by') || query.query.includes(VECTOR_PAGE_JOIN)
            ? 'page'
            : 'probe',
      query: query.query,
      parameters: query.parameters,
      plan: parsedPlan,
    })
    saveReport()
    if (isVectorCandidateQuery(query.query)) {
      const width = diagnostics.vectorCandidateDimensions!
      expect(query.query).toContain(
        `"embedding_search"."${width === 1536 ? 'vector' : `vector_${width}`}"`
      )
      expect(diagnostics.vectorCandidateLimit).toBeGreaterThan(0)
      if (options.candidateScanRowLimit !== undefined) {
        /** A small model-specific projection can be cheaper to rank through its KB index. */
        assertCompactCandidates(parsedPlan[0].Plan)
        const scans = explainNodes(parsedPlan[0].Plan).filter(
          (node) => node['Relation Name'] === 'embedding_search' && node['Actual Loops'] > 0
        )
        expect(scans.length).toBeGreaterThan(0)
        for (const node of scans) {
          const visited =
            (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0)) * node['Actual Loops']
          /** EXPLAIN rounds per-worker row averages to integers. */
          expect(visited).toBeLessThanOrEqual(
            options.candidateScanRowLimit + node['Actual Loops'] - 1
          )
        }
      } else {
        assertIndexedCandidates(parsedPlan[0].Plan, diagnostics.vectorCandidateLimit!, width)
      }
    }
    if (query.query.includes('WITH matched_keyword_chunks')) {
      assertScalarKeywordSorts(parsedPlan[0].Plan)
    }
  }
  logger.info(label, {
    milliseconds,
    queryCount: captured.length,
    resultCount: result.data.results.length,
  })
  return { result, plans, diagnostics }
}

describe.skipIf(!enabled)('Knowledge search latency on a realistic indexed corpus', () => {
  beforeAll(async () => {
    if (
      [chunkCount, unrelatedChunkCount].some(
        (count) =>
          !Number.isInteger(count) ||
          count < MIN_CHUNK_COUNT ||
          count > 200_000 ||
          count % batchSize !== 0
      )
    )
      throw new Error(
        'Search performance chunk counts must be multiples of 1000 from 5000 to 200000'
      )
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (
        url === 'https://api.atlassian.com/ex/confluence/search-fixture/wiki/rest/api/user/current'
      ) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-search-reader')
        readerCalls++
        return readerRevoked
          ? new Response(null, { status: 403 })
          : Response.json({ type: 'known', accountId: ids.aliceId })
      }
      if (
        url ===
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'
      ) {
        z.object({
          requests: z
            .array(
              z.object({
                model: z.literal('models/gemini-embedding-001'),
                content: z.object({
                  parts: z.array(z.object({ text: z.literal('Orion deployment') })),
                }),
                outputDimensionality: z.literal(dimensions),
              })
            )
            .length(1),
        }).parse(JSON.parse(String(init?.body)))
        embeddingCalls++
        return Response.json({
          embeddings: [{ values: queryVector }],
          usageMetadata: { promptTokenCount: 4 },
        })
      }
      if (url !== 'https://api.openai.com/v1/embeddings')
        throw new Error(`Unexpected outbound request in search fixture: ${new URL(url).origin}`)
      const body = z
        .object({
          input: z.array(z.string()).length(1),
          encoding_format: z.literal('base64'),
          model: z.literal('text-embedding-3-small'),
        })
        .parse(JSON.parse(String(init?.body)))
      embeddingCalls += body.input.length
      const bytes = Buffer.alloc(dimensions * 4)
      const topic = Number(/^Topic (\d+) deployment$/.exec(body.input[0])?.[1] ?? 0)
      topicVector(topic).forEach((value, index) => bytes.writeFloatLE(value, index * 4))
      return Response.json({
        data: [{ embedding: bytes.toString('base64') }],
        usage: { total_tokens: 4 },
      })
    })
    if (reused) {
      const owners = await db
        .select({ id: workspace.id, ownerId: workspace.ownerId })
        .from(workspace)
        .where(inArray(workspace.id, [ids.workspaceId, unrelated.workspaceId]))
      expect(owners).toEqual(
        expect.arrayContaining([
          { id: ids.workspaceId, ownerId: ids.aliceId },
          { id: unrelated.workspaceId, ownerId: unrelated.aliceId },
        ])
      )
      for (const fixture of [ids, unrelated]) {
        const [size] = await db.execute<{ count: number }>(
          sql`SELECT count(*)::int AS count FROM embedding WHERE knowledge_base_id = ${fixture.knowledgeBaseId}`
        )
        expect(size.count).toBe(fixture === ids ? chunkCount : unrelatedChunkCount)
      }
      await db
        .update(knowledgeBase)
        .set({
          workspaceId: ids.workspaceId,
          organizationId: null,
          embeddingModel: 'text-embedding-3-small',
        })
        .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      await db
        .update(knowledgeConnector)
        .set({ connectorType: 'google_drive', credentialId: null, sourceConfig: {} })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      await db.delete(credential).where(eq(credential.workspaceId, ids.workspaceId))
      await db.delete(credentialGroup).where(eq(credentialGroup.workspaceId, ids.workspaceId))
      await db
        .delete(copilotChats)
        .where(
          and(
            eq(copilotChats.organizationId, ids.organizationId),
            eq(copilotChats.userId, ids.aliceId)
          )
        )
      await db
        .delete(member)
        .where(and(eq(member.organizationId, ids.organizationId), eq(member.userId, ids.aliceId)))
      await db.execute(
        sql`UPDATE document SET acl = ARRAY[${`u:${ids.aliceId}@fixture.test`}], user_excluded = false, acl_verified_at = statement_timestamp() WHERE knowledge_base_id = ${ids.knowledgeBaseId}`
      )
    } else {
      await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
      await seedKnowledgeAclFixture(unrelated, { connectorType: 'google_drive' })
      /** The controlled geometry preserves prefix distances for the production 512-dimensional path. */
      await db
        .update(knowledgeBase)
        .set({ embeddingModel: 'text-embedding-3-small' })
        .where(inArray(knowledgeBase.id, [ids.knowledgeBaseId, unrelated.knowledgeBaseId]))
      await db
        .update(knowledgeBase)
        .set({ isSearchIndex: true })
        .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      const indexes = await db.execute<{
        indexname: string
        indexdef: string
      }>(sql`SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename IN ('embedding', 'embedding_search') AND indexdef LIKE '% USING hnsw %'`)
      for (const index of indexes)
        await db.execute(sql`DROP INDEX ${sql.identifier(index.indexname)}`)
      for (const fixture of [ids, unrelated]) {
        const count = fixture === ids ? chunkCount : unrelatedChunkCount
        for (let first = 0; first < count / chunksPerDocument; first += batchSize) {
          const last = Math.min(first + batchSize, count / chunksPerDocument) - 1
          await db.execute(sql`INSERT INTO document
          (id, knowledge_base_id, connector_id, external_id, filename, file_url, file_size, mime_type, processing_status, acl, acl_verified_at)
          SELECT ${fixture.workspaceId} || '-doc-' || n, ${fixture.knowledgeBaseId}, ${fixture.connectorId}, n::text,
            'Deployment guide ' || n, 'https://fixture.invalid/document/' || n, 12000, 'text/plain', 'completed',
            ARRAY[${`u:${fixture.aliceId}@fixture.test`}]::text[], statement_timestamp()
          FROM generate_series(${first}::int, ${last}::int) n`)
        }
      }
      for (let first = 0; first < Math.max(chunkCount, unrelatedChunkCount); first += batchSize) {
        for (const fixture of [ids, unrelated]) {
          const count = fixture === ids ? chunkCount : unrelatedChunkCount
          if (first >= count) continue
          const last = Math.min(first + batchSize, count) - 1
          await db.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL jit = off`)
            await tx.execute(sql`INSERT INTO embedding
          (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length, token_count, start_offset, end_offset, embedding)
          SELECT ${fixture.workspaceId} || '-chunk-' || n, ${fixture.knowledgeBaseId}, ${fixture.workspaceId} || '-doc-' || (n / ${chunksPerDocument}),
            n % ${chunksPerDocument}, 'hash-' || n,
            CASE WHEN n % 8 = 0 THEN 'Orion deployment reference. ' ELSE 'Engineering operations reference. ' END ||
              (SELECT string_agg(md5(n::text || ':' || paragraph::text), ' ') FROM generate_series(1, 90) paragraph),
            3000, 750, 0, 3000,
            l2_normalize(ARRAY(SELECT (sin(coordinate * (n % 32 + 1) * 12.9898) +
              0.25 * sin(n::double precision * coordinate * 12.9898 + coordinate * 78.233))::real
              FROM (
                SELECT (((position - 1) * 137 + ((position - 1) / ${candidateDimensions}) * 57)
                  % ${candidateDimensions}) + 1 AS coordinate
                FROM generate_series(1, ${dimensions}) position
              ) coordinates)::vector(1536))
          FROM (
            SELECT (ordinal * 7919) % ${count} AS n
            FROM generate_series(${first}::int, ${last}::int) ordinal
          ) shuffled`)
          })
        }
      }
      logger.info('Synthetic corpora loaded', { chunkCount, unrelatedChunkCount })
      for (const index of indexes) await db.execute(sql.raw(index.indexdef))
    }
    /** A non-shortenable model must populate its own full-width projection through the write trigger. */
    if (!reused?.fullWidthFixture) {
      await seedKnowledgeAclFixture(fullWidthFixture, { connectorType: 'google_drive' })
      await db
        .update(knowledgeBase)
        .set({ embeddingModel: 'gemini-embedding-001' })
        .where(eq(knowledgeBase.id, fullWidthFixture.knowledgeBaseId))
      await db.execute(sql`
      WITH source AS MATERIALIZED (
        SELECT id, content, embedding FROM embedding
        WHERE knowledge_base_id = ${ids.knowledgeBaseId} ORDER BY id LIMIT ${FULL_WIDTH_CHUNK_COUNT}
      ), documents AS (
        INSERT INTO document
          (id, knowledge_base_id, connector_id, external_id, filename, file_url, file_size,
            mime_type, processing_status, acl, acl_verified_at)
        SELECT ${fullWidthFixture.workspaceId} || '-doc-' || id, ${fullWidthFixture.knowledgeBaseId},
          ${fullWidthFixture.connectorId}, id, 'Full-width deployment guide',
          'https://fixture.invalid/full-width', 12000, 'text/plain', 'completed',
          ARRAY['pub']::text[], statement_timestamp() FROM source RETURNING id
      ) INSERT INTO embedding
        (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length,
          token_count, start_offset, end_offset, embedding)
      SELECT ${fullWidthFixture.workspaceId} || '-chunk-' || source.id,
        ${fullWidthFixture.knowledgeBaseId}, documents.id, 0, source.id, source.content,
        3000, 750, 0, 3000, source.embedding
      FROM source JOIN documents ON documents.id = ${fullWidthFixture.workspaceId} || '-doc-' || source.id
    `)
    }
    const [fullWidthSize] = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM embedding WHERE knowledge_base_id = ${fullWidthFixture.knowledgeBaseId}`
    )
    expect(fullWidthSize.count).toBe(FULL_WIDTH_CHUNK_COUNT)
    await db.execute(sql`UPDATE embedding SET tag1 = 'selected' WHERE knowledge_base_id = ${ids.knowledgeBaseId}
      AND tag1 IS DISTINCT FROM 'selected'
      AND document_id IN (SELECT id FROM document WHERE knowledge_base_id = ${ids.knowledgeBaseId} AND external_id::int < 600)`)
    await db.execute(sql`ANALYZE document`)
    await db.execute(sql`ANALYZE embedding`)
    await db.execute(sql`ANALYZE embedding_search`)
    await db.execute(sql`ANALYZE embedding_keyword_search`)
    if (evictSharedBuffers) await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_buffercache`)
    report.server = (
      await db.execute(sql`SELECT version(), current_setting('work_mem') AS work_mem,
      (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector`)
    )[0]
    report.relations = await db.execute(sql`
      SELECT relname, pg_relation_size(oid) AS bytes
      FROM pg_class
      WHERE relname IN ('embedding', 'embedding_search', 'document')
        OR relname LIKE 'embedding_search%hnsw_idx'
      ORDER BY relname
    `)
    db.$client.options.debug = (_connection, query, parameters) => {
      if (capture && captured.length < 300) captured.push({ query, parameters: [...parameters] })
    }
    diagnosticLog = vi.spyOn(Logger.prototype, 'info')
  }, 120 * 60_000)

  afterAll(async () => {
    diagnosticLog?.mockRestore()
    db.$client.options.debug = previousDebug
    vi.unstubAllGlobals()
    saveReport()
    for (const fixture of process.env.KNOWLEDGE_SEARCH_PERFORMANCE_KEEP_DATABASE === 'true'
      ? []
      : [ids, unrelated, fullWidthFixture]) {
      await db.delete(workspace).where(eq(workspace.id, fixture.workspaceId))
      await db.delete(organization).where(eq(organization.id, fixture.organizationId))
      await db.delete(user).where(eq(user.id, fixture.aliceId))
      await db.delete(user).where(eq(user.id, fixture.bobId))
    }
    await db.$client.end()
  }, 120_000)

  it('cancels slow SQL on the server and restores pooled connection settings', async () => {
    const budget = new SearchBudget('keyword', performance.now() + 200)
    const started = performance.now()
    await expect(
      budget.query('keyword.sql', (tx) => tx.execute(sql`SELECT pg_sleep(5)`))
    ).rejects.toBeInstanceOf(SearchDeadlineError)
    expect(performance.now() - started).toBeLessThan(2000)
    const [active] = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'active' AND query = 'SELECT pg_sleep(5)'`
    )
    expect(active.count).toBe(0)
    const [settings] = await db.execute<{ timeout: string }>(
      sql`SELECT current_setting('statement_timeout') AS timeout`
    )
    expect(settings.timeout).toBe('0')
  })

  it('disables compilation only inside deadline-bound search transactions', async () => {
    const [before] = await db.execute<{ jit: string }>(sql`SELECT current_setting('jit') AS jit`)
    for (const leg of ['vector', 'keyword', 'tags'] as const) {
      const budget = new SearchBudget(leg, performance.now() + 2000)
      const [inside] = await budget.query(`${leg}.sql`, (executor) =>
        executor.execute<{ jit: string }>(sql`SELECT current_setting('jit') AS jit`)
      )
      expect(inside.jit).toBe('off')
    }
    const [settings] = await db.execute<{ jit: string }>(sql`SELECT current_setting('jit') AS jit`)
    expect(settings.jit).toBe(before.jit)
  })

  it('expires waiting for a saturated pool without executing abandoned work', async () => {
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let markSaturated!: () => void
    const saturated = new Promise<void>((resolve) => {
      markSaturated = resolve
    })
    let acquired = 0
    const holders = Array.from({ length: db.$client.options.max }, () =>
      db.transaction(async () => {
        if (++acquired === db.$client.options.max) markSaturated()
        await released
      })
    )
    const run = vi.fn((tx: SearchExecutor) => tx.execute(sql`SELECT 1`))
    const started = performance.now()
    try {
      await saturated
      const budget = new SearchBudget('keyword', performance.now() + 200)
      await expect(budget.query('keyword.sql', run)).rejects.toBeInstanceOf(SearchDeadlineError)
      expect(performance.now() - started).toBeLessThan(2000)
    } finally {
      release()
      await Promise.all(holders)
    }
    await db.execute(sql`SELECT 1`)
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['vector', 'keyword', 'both'] as const)(
    'keeps the Assistant budget when %s SQL branches are delayed',
    async (delayedLegs) => {
      diagnosticLog?.mockClear()
      let vectorDelayed = false
      const query = SearchBudget.prototype.query
      const delayed = vi.spyOn(SearchBudget.prototype, 'query').mockImplementation(function <T>(
        this: SearchBudget,
        stage: SearchStage,
        run: (executor: SearchExecutor) => PromiseLike<T>
      ): Promise<T> {
        return query.call(this, stage, async (tx) => {
          if (delayedLegs === 'vector' && this.leg === 'vector' && !vectorDelayed) {
            vectorDelayed = true
            await tx.execute(sql`SELECT pg_sleep(4)`)
          } else if (
            delayedLegs === 'both' ||
            (delayedLegs === 'keyword' && this.leg === 'keyword')
          )
            await tx.execute(sql`SELECT pg_sleep(9)`)
          return run(tx)
        }) as Promise<T>
      })
      try {
        const result = await searchWorkspaceServerTool.execute(
          { query: 'Orion deployment', topK: 15 },
          {
            userId: ids.aliceId,
            workspaceId: ids.workspaceId,
            toolCallId: generateId(),
            copilotToolExecution: true,
            resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
              userId: ids.aliceId,
              workspaceId: ids.workspaceId,
            }),
          }
        )
        const completed = diagnosticLog?.mock.calls.find(
          ([message]) => message === 'Knowledge search completed'
        )
        expect(diagnosticSchema.parse(completed?.[1])).toMatchObject({
          vectorBudgetMs: 8000,
          outcome: delayedLegs === 'vector' ? 'success' : 'partial',
        })
        if (delayedLegs === 'both') {
          expect(result).toMatchObject({
            success: true,
            data: {
              retrieval: { status: 'partial', timedOutLegs: ['vector', 'keyword'] },
              results: [],
            },
          })
          return
        }
        expect(result).toMatchObject({
          success: true,
          data: {
            retrieval:
              delayedLegs === 'vector'
                ? { status: 'complete', timedOutLegs: [] }
                : { status: 'partial', timedOutLegs: ['keyword'] },
          },
        })
        const parsed = resultSchema.parse(result)
        expect(parsed.data.results.length).toBeGreaterThan(0)
        expect(
          parsed.data.results.every((row) => row.knowledgeBaseId === ids.knowledgeBaseId)
        ).toBe(true)
        report[`assistant.deadline.${delayedLegs}`] = { resultCount: parsed.data.results.length }
      } finally {
        delayed.mockRestore()
      }
    },
    30_000
  )

  it.each(['vector', 'both'] as const)(
    'returns incomplete dashboard coverage when %s SQL branches exceed their deadline',
    async (delayedLegs) => {
      diagnosticLog?.mockClear()
      const query = SearchBudget.prototype.query
      const delayed = vi.spyOn(SearchBudget.prototype, 'query').mockImplementation(function <T>(
        this: SearchBudget,
        stage: SearchStage,
        run: (executor: SearchExecutor) => PromiseLike<T>
      ): Promise<T> {
        return query.call(this, stage, async (tx) => {
          if (delayedLegs === 'both' || this.leg === 'vector')
            await tx.execute(sql`SELECT pg_sleep(${delayedLegs === 'both' ? 9 : 4})`)
          return run(tx)
        }) as Promise<T>
      })
      try {
        const { data } = await searchDashboard()
        const completed = diagnosticLog?.mock.calls.find(
          ([message]) => message === 'Knowledge search completed'
        )
        const diagnostics = diagnosticSchema.parse(completed?.[1])
        expect(diagnostics.outcome).toBe('partial')
        expect(diagnostics.vectorBudgetMs).toBe(3000)
        expect(diagnostics.stages.vector.totalMs).toBeGreaterThan(2500)
        expect(diagnostics.stages.vector.totalMs).toBeLessThan(4000)
        expect(data.retrieval).toEqual({
          status: 'partial',
          timedOutLegs: delayedLegs === 'both' ? ['vector', 'keyword'] : ['vector'],
        })
        if (delayedLegs === 'both') expect(data.results).toEqual([])
        else {
          expect(data.results.length).toBeGreaterThan(0)
          expect(
            data.results.every((result) => result.knowledgeBaseId === ids.knowledgeBaseId)
          ).toBe(true)
        }
        report[`dashboard.deadline.${delayedLegs}`] = { resultCount: data.results.length }
      } finally {
        delayed.mockRestore()
      }
    },
    30_000
  )

  it('records first and repeated application searches with the actual SQL plans', async () => {
    const before = embeddingCalls
    for (let iteration = 0; iteration < 2; iteration++) {
      const { result, plans, diagnostics } = await sample(`broad.${iteration}`, () => search())
      expectCompleteVectorSearch(diagnostics)
      expect(result.data.results).toHaveLength(15)
      expect(result.data.results.every((row) => row.knowledgeBaseId === ids.knowledgeBaseId)).toBe(
        true
      )
      expect(plans.length).toBeGreaterThanOrEqual(2)
      const vectorPlans = plans.filter((plan) => plan.kind === 'vector')
      expect(vectorPlans).toHaveLength(1)
      expect(vectorPlans[0].plan[0].Plan['Actual Rows']).toBeGreaterThan(0)
      assertCompactCandidates(vectorPlans[0].plan[0].Plan)
      expect(plans.some((plan) => plan.kind === 'page')).toBe(true)
      const page = plans.find((plan) => plan.kind === 'page')!
      const actual = await db.$client.unsafe(page.query, page.parameters).values()
      const expected = await exactProjectionNeighbors(queryVector, actual.length)
      const expectedIds = new Set(expected.map(({ id }) => id))
      const recall = actual.filter(([id]) => expectedIds.has(id)).length / expected.length
      expect(recall).toBeGreaterThanOrEqual(0.95)
      report[`recall.${iteration}`] = { neighbors: expected.length, recall }
      saveReport()
    }
    expect(embeddingCalls - before).toBe(2)
  }, 180_000)

  it('preserves exact-neighbor recall across different query vectors', async () => {
    for (const topic of [3, 11, 23]) {
      const { plans, diagnostics } = await sample(`topic.${topic}`, () =>
        search(ids.aliceId, `Topic ${topic} deployment`)
      )
      expectCompleteVectorSearch(diagnostics)
      const candidates = plans.find((plan) => plan.kind === 'vector')!
      assertCompactCandidates(candidates.plan[0].Plan)
      const page = plans.find((plan) => plan.kind === 'page')!
      const actual = await db.$client.unsafe(page.query, page.parameters).values()
      const expected = await exactProjectionNeighbors(topicVector(topic), actual.length)
      const expectedIds = new Set(expected.map(({ id }) => id))
      const recall = actual.filter(([id]) => expectedIds.has(id)).length / expected.length
      expect(recall).toBeGreaterThanOrEqual(0.95)
      report[`recall.topic.${topic}`] = { neighbors: expected.length, recall }
      saveReport()
    }
  }, 180_000)

  it('compares the Search tab and Assistant with the same person, query and index', async () => {
    const dashboard = await sample('dashboard', searchDashboard)
    const assistant = await sample('assistant.comparison', () => search())
    expectCompleteVectorSearch(dashboard.diagnostics)
    expectCompleteVectorSearch(assistant.diagnostics)
    expect(dashboard.diagnostics.surface).toBe('dashboard')
    expect(assistant.diagnostics.surface).toBe('copilot')
    expect(dashboard.diagnostics.stages.result_provenance).toBeUndefined()
    expect(assistant.diagnostics.stages.result_provenance.count).toBe(1)
    expect(dashboard.result.data.results).toHaveLength(15)
    expect(assistant.result.data.results).toHaveLength(15)
    const dashboardVector = dashboard.plans.filter((plan) => plan.kind === 'vector')
    const assistantVector = assistant.plans.filter((plan) => plan.kind === 'vector')
    expect(dashboardVector).toHaveLength(1)
    expect(assistantVector).toHaveLength(1)
    expect(dashboardVector[0].query).toBe(assistantVector[0].query)
    expect(dashboardVector[0].parameters).toEqual(assistantVector[0].parameters)
    expect(dashboardVector[0].plan[0].Plan['Actual Rows']).toBeGreaterThan(0)
  }, 180_000)

  it('keeps inaccessible content out of an otherwise identical search', async () => {
    const { result } = await sample('denied', () => search(ids.bobId))
    expect(result.data.results).toEqual([])
  }, 180_000)

  it('preserves recall when the nearest topic is mostly inaccessible within a broad permission scope', async () => {
    const reader = `u:${ids.aliceId}@fixture.test`
    /** Four consecutive topics share each document; hide 99% of the query's topic cluster. */
    await db.execute(sql`UPDATE document
      SET acl = ARRAY[${`u:${ids.bobId}@fixture.test`}]
      WHERE knowledge_base_id = ${ids.knowledgeBaseId}
        AND external_id::int % 8 = 0 AND external_id::int % 800 <> 0`)
    try {
      for (const surface of ['copilot', 'dashboard'] as const) {
        const { result, plans, diagnostics } = await sample(
          `filtered-neighborhood.${surface}`,
          surface === 'copilot' ? () => search() : searchDashboard
        )
        expectCompleteVectorSearch(diagnostics)
        expect(result.data.results).toHaveLength(15)
        const page = plans.find((plan) => plan.kind === 'page')!
        expect(page).toBeDefined()
        const actual = await db.$client.unsafe(page.query, page.parameters).values()
        const expected = await exactProjectionNeighbors(
          queryVector,
          actual.length,
          sql`AND d.acl @> ARRAY[${reader}]::text[]`
        )
        expect(expected.length).toBeGreaterThan(0)
        const expectedIds = new Set(expected.map(({ id }) => id))
        const recall = actual.filter(([id]) => expectedIds.has(id)).length / expected.length
        expect(recall).toBeGreaterThanOrEqual(0.95)
        report[`recall.filtered-neighborhood.${surface}`] = { neighbors: expected.length, recall }
        saveReport()
      }
    } finally {
      await db
        .update(document)
        .set({ acl: [reader] })
        .where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))
    }
  }, 180_000)

  it('ranks a small permission scope by its bounded IDs without a corpus-wide vector probe', async () => {
    const lastTopicDocument = Math.floor((chunkCount / chunksPerDocument - 1) / 8) * 8
    const documentIds = [0, 8, 16].map(
      (offset) => `${ids.workspaceId}-doc-${lastTopicDocument - offset}`
    )
    await db
      .update(document)
      .set({ acl: [`u:${ids.aliceId}@fixture.test`, `u:${ids.bobId}@fixture.test`] })
      .where(inArray(document.id, documentIds))
    try {
      for (const surface of ['copilot', 'dashboard'] as const) {
        const { result, plans, diagnostics } = await sample(`small-scope.${surface}`, () =>
          surface === 'copilot' ? search(ids.bobId) : searchDashboard('Orion deployment', ids.bobId)
        )
        expectCompleteVectorSearch(diagnostics)
        expect(result.data.results.length).toBeGreaterThan(0)
        expect(result.data.results.every((row) => documentIds.includes(row.documentId))).toBe(true)
        const probe = plans.filter((plan) => plan.kind === 'probe')
        expect(probe).toHaveLength(1)
        expect(probe[0].query).not.toContain('<=>')
        expect(probe[0].plan[0].Plan['Actual Rows']).toBe(12)
        expect(assertIndexedChunkProbe(probe[0].plan[0].Plan)).toBe(documentIds.length)
        /** The page reads the bounded ranking's identities from the projection, never the original vectors. */
        const page = plans.filter((plan) => plan.kind === 'page')
        expect(page).toHaveLength(1)
        expect(page[0].query).not.toContain('"embedding"."embedding"')
      }
    } finally {
      await db
        .update(document)
        .set({ acl: [`u:${ids.aliceId}@fixture.test`] })
        .where(inArray(document.id, documentIds))
    }
  }, 180_000)

  it.each([200, 1000, 1596, 1600, 2000])(
    'keeps a selective scope of %s chunks within both retrieval budgets',
    async (count) => {
      const documentCount = count / chunksPerDocument
      const documentIds = Array.from(
        { length: documentCount },
        (_, index) => `${ids.workspaceId}-doc-${chunkCount / chunksPerDocument - 1 - index}`
      )
      await db
        .update(document)
        .set({ acl: [`u:${ids.aliceId}@fixture.test`, `u:${ids.bobId}@fixture.test`] })
        .where(inArray(document.id, documentIds))
      try {
        for (const surface of ['copilot', 'dashboard'] as const) {
          const { result, plans, diagnostics } = await sample(
            `selective-${count}.${surface}`,
            () =>
              surface === 'copilot'
                ? search(ids.bobId)
                : searchDashboard('Orion deployment', ids.bobId)
          )
          expectCompleteVectorSearch(diagnostics)
          expect(result.data.results.length).toBeGreaterThan(0)
          expect(result.data.results.every((row) => documentIds.includes(row.documentId))).toBe(
            true
          )
          const probe = plans.find((plan) => plan.kind === 'probe')!
          expect(probe.plan[0].Plan['Actual Rows']).toBe(Math.min(count, HYBRID_CANDIDATE_LIMIT))
          expect(assertIndexedChunkProbe(probe.plan[0].Plan)).toBe(
            Math.min(documentCount, HYBRID_CANDIDATE_LIMIT / chunksPerDocument)
          )
          expect(plans.filter((plan) => plan.kind === 'vector')).toHaveLength(
            count < HYBRID_CANDIDATE_LIMIT ? 0 : 1
          )
          if (count > HYBRID_CANDIDATE_LIMIT) {
            const page = plans.find((plan) => plan.kind === 'page')!
            const actual = await db.$client.unsafe(page.query, page.parameters).values()
            const expected = await exactProjectionNeighbors(
              queryVector,
              actual.length,
              sql`AND ${embeddingSearch.documentId} IN (${sql.join(
                documentIds.map((id) => sql`${id}`),
                sql`, `
              )})`
            )
            const expectedIds = new Set(expected.map(({ id }) => id))
            const recall = actual.filter(([id]) => expectedIds.has(id)).length / expected.length
            expect(recall).toBeGreaterThanOrEqual(0.95)
            report[`recall.selective-${count}.${surface}`] = {
              neighbors: expected.length,
              recall,
              candidateScan: diagnostics.vectorCandidateScan,
            }
            saveReport()
          }
        }
      } finally {
        await db
          .update(document)
          .set({ acl: [`u:${ids.aliceId}@fixture.test`] })
          .where(inArray(document.id, documentIds))
      }
    },
    180_000
  )

  it('bounds member-observation searches and rejects suspended readers with current ACL checks', async () => {
    const fixture = await seedKnowledgeMemberFixture(ids)
    const [alice, bob] = fixture.members
    const lastTopicDocument = Math.floor((chunkCount / chunksPerDocument - 1) / 8) * 8
    const documentIds = [0, 8, 16].map(
      (offset) => `${ids.workspaceId}-doc-${lastTopicDocument - offset}`
    )
    try {
      await db
        .update(document)
        .set({ connectorId: fixture.connectorId, acl: [alice.subjectToken] })
        .where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))
      await db.execute(sql`INSERT INTO knowledge_document_observation
        (document_id, member_id, run_id)
        SELECT id, ${alice.id}, ${fixture.runId} FROM document
        WHERE knowledge_base_id = ${ids.knowledgeBaseId}`)
      await db.insert(knowledgeDocumentObservation).values(
        documentIds.map((documentId) => ({
          documentId,
          memberId: bob.id,
          runId: fixture.runId,
        }))
      )
      await db
        .update(document)
        .set({ acl: [alice.subjectToken, bob.subjectToken] })
        .where(inArray(document.id, documentIds))
      await db.execute(sql`ANALYZE document`)
      await db.execute(sql`ANALYZE knowledge_document_observation`)
      for (const surface of ['copilot', 'dashboard'] as const) {
        const broad = await sample(`member-broad.${surface}`, () =>
          surface === 'copilot' ? search() : searchDashboard()
        )
        expectCompleteVectorSearch(broad.diagnostics)
        expect(broad.result.data.results).toHaveLength(15)
        const broadProbe = broad.plans.find((plan) => plan.kind === 'probe')!
        expect(broadProbe.plan[0].Plan['Actual Rows']).toBe(HYBRID_CANDIDATE_LIMIT)
        expect(assertIndexedChunkProbe(broadProbe.plan[0].Plan)).toBe(
          HYBRID_CANDIDATE_LIMIT / chunksPerDocument
        )
        const { result, plans, diagnostics } = await sample(`member-scope.${surface}`, () =>
          surface === 'copilot' ? search(ids.bobId) : searchDashboard('Orion deployment', ids.bobId)
        )
        expectCompleteVectorSearch(diagnostics)
        expect(result.data.results.length).toBeGreaterThan(0)
        expect(result.data.results.every((row) => documentIds.includes(row.documentId))).toBe(true)
        const probe = plans.find((plan) => plan.kind === 'probe')!
        expect(probe).toBeDefined()
        expect(probe.query).toContain('knowledge_document_observation')
        expect(assertIndexedChunkProbe(probe.plan[0].Plan)).toBe(documentIds.length)
      }
      await db
        .update(knowledgeConnectorMember)
        .set({ status: 'suspended' })
        .where(eq(knowledgeConnectorMember.id, bob.id))
      const denied = await sample('member-scope.suspended', () => search(ids.bobId))
      expectCompleteVectorSearch(denied.diagnostics)
      expect(denied.result.data.results).toEqual([])
    } finally {
      await db
        .update(document)
        .set({ connectorId: ids.connectorId, acl: [`u:${ids.aliceId}@fixture.test`] })
        .where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))
      await db.delete(knowledgeConnector).where(eq(knowledgeConnector.id, fixture.connectorId))
      await db.delete(credential).where(
        inArray(
          credential.id,
          fixture.members.map((member) => member.credentialId)
        )
      )
      await db.delete(credentialGroup).where(eq(credentialGroup.id, fixture.groupId))
      await db.execute(sql`ANALYZE document`)
    }
  }, 180_000)

  it('applies selective document scope and exclusion before ranking', async () => {
    const documentIds = [0, 8, 16, 24, 32].map((index) => `${ids.workspaceId}-doc-${index}`)
    await db.update(document).set({ userExcluded: true }).where(eq(document.id, documentIds[0]))
    try {
      const { result } = await sample('selective', () =>
        search(ids.aliceId, 'Orion deployment', { documentIds })
      )
      expect(result.data.results.length).toBeGreaterThan(0)
      expect(new Set(result.data.results.map((row) => row.documentId))).toEqual(
        new Set(documentIds.slice(1))
      )
      expect(
        result.data.results.every((row) => documentIds.slice(1).includes(row.documentId))
      ).toBe(true)
    } finally {
      await db.update(document).set({ userExcluded: false }).where(eq(document.id, documentIds[0]))
    }
  }, 180_000)

  it.each(['copilot', 'dashboard'] as const)(
    'keeps %s searches for common keyword terms complete',
    async (surface) => {
      const { result, diagnostics } = await sample(`common-keyword.${surface}`, () =>
        surface === 'dashboard'
          ? searchDashboard('Engineering operations')
          : search(ids.aliceId, 'Engineering operations')
      )
      expectCompleteVectorSearch(diagnostics)
      expect(result.data.results).toHaveLength(15)
    },
    180_000
  )

  it('runs two independent Assistant searches concurrently', async () => {
    diagnosticLog?.mockClear()
    const start = performance.now()
    const results = await Promise.all([search(), search(ids.aliceId, 'Topic 11 deployment')])
    const completed = diagnosticLog!.mock.calls
      .filter(([message]) => message === 'Knowledge search completed')
      .map(([, metadata]) => diagnosticSchema.parse(metadata))
    report.concurrent = {
      milliseconds: performance.now() - start,
      resultCounts: results.map((result) => result.data.results.length),
      diagnostics: completed,
    }
    saveReport()
    for (const result of results) expect(result.data.results).toHaveLength(15)
    expect(completed).toHaveLength(2)
    for (const diagnostics of completed) expectCompleteVectorSearch(diagnostics)
  }, 180_000)

  it('uses compact indexed ranking for workspace KBs with stale estimates and private neighbors', async () => {
    const originalAcl = `u:${ids.aliceId}@fixture.test`
    await db.execute(sql`ALTER TABLE document SET (autovacuum_enabled = false)`)
    try {
      /** Analyze a narrow scope, then grow it without updating the planner's ACL histogram. */
      await db.execute(sql`UPDATE document SET acl = CASE WHEN external_id::int % 10 = 1
        THEN ARRAY['pub'] ELSE ARRAY[${originalAcl}] END
        WHERE knowledge_base_id = ${ids.knowledgeBaseId}`)
      await db.execute(sql`ANALYZE document`)
      await db.execute(sql`UPDATE document SET acl = CASE WHEN external_id::int % 5 <> 0
        THEN ARRAY['pub'] ELSE ARRAY[${originalAcl}] END
        WHERE knowledge_base_id = ${ids.knowledgeBaseId}`)
      for (const topic of [0, 11, 23]) {
        const label = `workspace-kb.topic.${topic}`
        await prepareOrganizationSample(label)
        const { result, plans, diagnostics } = await sample(label, () =>
          searchWorkspaceKb(`Topic ${topic} deployment`)
        )
        expectCompleteVectorSearch(diagnostics)
        expect(diagnostics.accessScopeKind).toBe('workspace')
        expect(diagnostics.vectorRanking).toBe('projection-walk')
        expect(result.data.results).toHaveLength(15)
        expect(plans.some((plan) => plan.kind === 'vector')).toBe(true)
        for (const row of result.data.results) {
          expect(row.knowledgeBaseId).toBe(ids.knowledgeBaseId)
          expect(Number(row.documentId.split('-doc-')[1]) % 5).not.toBe(0)
        }
        const expected = await db.execute<{ id: string }>(sql`
          SELECT embedding.id FROM embedding JOIN document ON document.id = embedding.document_id
          WHERE embedding.knowledge_base_id = ${ids.knowledgeBaseId} AND embedding.enabled
            AND document.acl = ARRAY['pub']::text[]
          ORDER BY (embedding.embedding <=> ${JSON.stringify(topicVector(topic))}::vector) + 0, embedding.id
          LIMIT 15
        `)
        const expectedIds = new Set(expected.map(({ id }) => id))
        const recall =
          result.data.results.filter((row) => expectedIds.has(row.embeddingId!)).length /
          expected.length
        expect(recall).toBeGreaterThanOrEqual(0.95)
        report[`${label}.recall`] = { neighbors: expected.length, recall }
        saveReport()
      }
      const fullWidth = await sample(
        'workspace-kb.full-width',
        () => searchWorkspaceKb('Orion deployment', { fixture: fullWidthFixture }),
        { candidateScanRowLimit: FULL_WIDTH_CHUNK_COUNT }
      )
      expectCompleteVectorSearch(fullWidth.diagnostics)
      expect(fullWidth.diagnostics.vectorCandidateDimensions).toBe(dimensions)
      expect(fullWidth.result.data.results).toHaveLength(15)

      const workflowId = generateId()
      const scheduled: Principal = {
        kind: 'delegated',
        serviceId: 'executor',
        workspaceId: ids.workspaceId,
        delegationId: generateId(),
        audience: 'sim:knowledge',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        delegationContext: {
          kind: 'workflow_execution',
          workflowId,
          principal: {
            kind: 'system',
            serviceId: 'schedule',
            workspaceId: ids.workspaceId,
            workflowId,
          },
          currentWorkflow: { workflowId, mode: 'deployment', deploymentVersionId: generateId() },
        },
      }
      const scheduledResult = await sample('workspace-kb.scheduled', () =>
        searchWorkspaceKb('Orion deployment', { principal: scheduled })
      )
      expectCompleteVectorSearch(scheduledResult.diagnostics)
      expect(scheduledResult.diagnostics.accessScopeKind).toBe('workspace')
      expect(scheduledResult.result.data.results).toHaveLength(15)

      for (const concurrency of [2, 8]) {
        const label = `workspace-kb.concurrent.${concurrency}`
        await prepareOrganizationSample(label)
        diagnosticLog?.mockClear()
        const started = performance.now()
        const results = await Promise.all(
          Array.from({ length: concurrency }, (_, index) =>
            searchWorkspaceKb(`Topic ${index * 3} deployment`)
          )
        )
        const completed = diagnosticLog!.mock.calls
          .filter(([message]) => message === 'Knowledge search completed')
          .map(([, metadata]) => diagnosticSchema.parse(metadata))
        report[label] = {
          milliseconds: performance.now() - started,
          resultCounts: results.map((result) => result.data.results.length),
          diagnostics: completed,
        }
        saveReport()
        expect(completed).toHaveLength(concurrency)
        for (const result of results) expect(result.data.results).toHaveLength(15)
        for (const diagnostics of completed) expectCompleteVectorSearch(diagnostics)
      }

      const tagged = await sample('workspace-kb.tagged', () =>
        searchWorkspaceKb('Orion deployment', {
          tagFilters: [{ tagName: 'Fixture', operator: 'eq', value: 'selected' }],
        })
      )
      expectCompleteVectorSearch(tagged.diagnostics)
      expect(tagged.diagnostics.vectorRanking).toBe('projection-walk')
      expect(tagged.result.data.results).toHaveLength(15)
      for (const row of tagged.result.data.results) {
        const ordinal = Number(row.documentId.split('-doc-')[1])
        expect(ordinal).toBeLessThan(600)
        expect(ordinal % 5).not.toBe(0)
      }
      const expectedTagged = await db.execute<{ id: string }>(sql`
        SELECT embedding.id FROM embedding JOIN document ON document.id = embedding.document_id
        WHERE embedding.knowledge_base_id = ${ids.knowledgeBaseId} AND embedding.enabled
          AND document.acl = ARRAY['pub']::text[] AND embedding.tag1 = 'selected'
        ORDER BY (embedding.embedding <=> ${JSON.stringify(queryVector)}::vector) + 0, embedding.id LIMIT 15
      `)
      const taggedIds = new Set(expectedTagged.map(({ id }) => id))
      const taggedRecall =
        tagged.result.data.results.filter((row) => taggedIds.has(row.embeddingId!)).length /
        expectedTagged.length
      expect(taggedRecall).toBeGreaterThanOrEqual(0.95)
      report['workspace-kb.tagged.recall'] = {
        neighbors: expectedTagged.length,
        recall: taggedRecall,
      }
      saveReport()

      /** Workspace credentials cannot keep reading a source after its access rewrite begins. */
      await db
        .update(knowledgeConnector)
        .set({ accessRewritePending: true })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      const denied = await sample('workspace-kb.revoked', () => searchWorkspaceKb())
      expectCompleteVectorSearch(denied.diagnostics)
      expect(denied.result.data.results).toEqual([])
    } finally {
      await db
        .update(knowledgeConnector)
        .set({ accessRewritePending: false })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      await db.execute(
        sql`UPDATE document SET acl = ARRAY[${originalAcl}] WHERE knowledge_base_id = ${ids.knowledgeBaseId}`
      )
      await db.execute(sql`ALTER TABLE document RESET (autovacuum_enabled)`)
      await db.execute(sql`ANALYZE document`)
    }
  }, 180_000)

  it('checks live reader access on every search, including after revocation', async () => {
    await seedSearchReaderFixture(ids)
    const allowed = await sample('live.allowed', () => search())
    expect(allowed.result.data.results).toHaveLength(15)
    expect(readerCalls).toBeGreaterThan(0)
    readerRevoked = true
    const before = readerCalls
    const denied = await sample('live.revoked', () => search())
    for (const probe of denied.plans.filter((plan) => plan.kind === 'probe')) {
      expect(probe.query).not.toContain('<=>')
    }
    expect(denied.result.data.results).toEqual([])
    expect(readerCalls).toBeGreaterThan(before)
    readerRevoked = false
    const restored = await sample('live.restored', () => search())
    expect(restored.result.data.results).toHaveLength(15)
  }, 180_000)

  it('keeps organization searches complete with stale ACL estimates and concurrent requests', async () => {
    await db.insert(member).values({
      id: generateId(),
      organizationId: ids.organizationId,
      userId: ids.aliceId,
      role: 'owner',
    })
    await db.insert(copilotChats).values({
      id: organizationChatId,
      organizationId: ids.organizationId,
      userId: ids.aliceId,
      type: 'mothership',
    })
    await db
      .update(knowledgeBase)
      .set({ workspaceId: null, organizationId: ids.organizationId })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db
      .update(knowledgeConnector)
      .set({ connectorType: 'google_drive', credentialId: null, sourceConfig: {} })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    /** Keep the deliberate tenfold visibility underestimate until the measured requests finish. */
    await db.execute(sql`ALTER TABLE document SET (autovacuum_enabled = false)`)
    try {
      await db.execute(sql`UPDATE document
        SET acl = ARRAY[CASE WHEN external_id::int % 10 = 0
          THEN ${`u:${ids.aliceId}@fixture.test`} ELSE ${`u:${ids.bobId}@fixture.test`} END]
        WHERE knowledge_base_id = ${ids.knowledgeBaseId}`)
      await db.execute(sql`ANALYZE document`)
      await db.execute(sql`UPDATE document SET acl = ARRAY[${`u:${ids.aliceId}@fixture.test`}]
        WHERE knowledge_base_id = ${ids.knowledgeBaseId}`)
      report.organizationVisibility = {
        analyzedVisibleDocuments: chunkCount / chunksPerDocument / 10,
        actualVisibleDocuments: chunkCount / chunksPerDocument,
        unrelatedChunks: unrelatedChunkCount,
      }
      /** Capture latency samples before EXPLAIN ANALYZE can warm the candidate paths. */
      for (const surface of ['dashboard', 'copilot'] as const) {
        const label = `organization.${surface}`
        await prepareOrganizationSample(label)
        const { result, diagnostics } = await sample(
          label,
          () =>
            surface === 'dashboard'
              ? searchDashboard('Orion deployment', ids.aliceId, true, 20)
              : search(ids.aliceId, 'Orion deployment', {}, true, 20),
          { explain: false }
        )
        expectCompleteVectorSearch(diagnostics)
        expect(result.data.results).toHaveLength(20)
        expect(
          result.data.results.every((row) => row.knowledgeBaseId === ids.knowledgeBaseId)
        ).toBe(true)
      }
      await prepareOrganizationSample('organization.concurrent')
      diagnosticLog?.mockClear()
      const started = performance.now()
      const results = await Promise.all([
        search(ids.aliceId, 'Orion deployment', {}, true, 20),
        search(ids.aliceId, 'Topic 11 deployment', {}, true, 20),
      ])
      const diagnostics = diagnosticLog!.mock.calls
        .filter(([message]) => message === 'Knowledge search completed')
        .map(([, metadata]) => diagnosticSchema.parse(metadata))
      report['organization.concurrent'] = {
        milliseconds: performance.now() - started,
        resultCounts: results.map((result) => result.data.results.length),
        diagnostics,
      }
      saveReport()
      expect(diagnostics).toHaveLength(2)
      for (const item of diagnostics) expectCompleteVectorSearch(item)
      for (const result of results) {
        expect(result.data.results).toHaveLength(20)
        expect(
          result.data.results.every((row) => row.knowledgeBaseId === ids.knowledgeBaseId)
        ).toBe(true)
      }
      const planned = await sample('organization.plans', () =>
        search(ids.aliceId, 'Orion deployment', {}, true, 20)
      )
      expectCompleteVectorSearch(planned.diagnostics)
      expect(planned.plans.filter((plan) => plan.kind === 'vector')).toHaveLength(1)
    } finally {
      await db.execute(sql`ALTER TABLE document RESET (autovacuum_enabled)`)
      await db.execute(sql`ANALYZE document`)
    }
  }, 180_000)
  /** Opt in with local Sim and Go URLs; uses the real configured provider, billing adapter, and async resume protocol. */
  it.skipIf(!process.env.KNOWLEDGE_SEARCH_ASSISTANT_URL)(
    'recovers quietly from incomplete search through local Go Assistant, then reads and cites evidence',
    async () => {
      const assistantUrl = new URL(process.env.KNOWLEDGE_SEARCH_ASSISTANT_URL!)
      const simUrl = new URL(process.env.KNOWLEDGE_SEARCH_SIM_URL!)
      for (const url of [assistantUrl, simUrl]) {
        if (!['127.0.0.1', 'localhost'].includes(url.hostname))
          throw new Error(
            'Assistant integration requires local servers using the disposable test databases'
          )
      }
      const apiKey = process.env.KNOWLEDGE_SEARCH_ASSISTANT_API_KEY!
      const internalKey = process.env.KNOWLEDGE_SEARCH_SIM_INTERNAL_KEY!
      expect(apiKey).toBeTruthy()
      expect(internalKey).toBeTruthy()
      const chunkId = `${ids.workspaceId}-chunk-0`
      const [original] = await db
        .select({
          content: embedding.content,
          contentLength: embedding.contentLength,
          tokenCount: embedding.tokenCount,
        })
        .from(embedding)
        .where(eq(embedding.id, chunkId))
        .limit(1)
      const longContent =
        'Orion deployment guide. The activation phrase and final checksum appear at the end.\n' +
        'Review the deployment stages in order. Preserve the rollback procedure.\n'.repeat(320) +
        '\nActivation phrase: SILVER COMET\nFinal checksum: K7M2-84\n'
      const registry = new ResolvedSecretTraceRegistry([], { userId: ids.aliceId })
      const calls: Array<{
        name: string
        arguments: unknown
        milliseconds: number
        bytes: number
      }> = []
      let answer = ''
      let incompleteSearch = true
      const query = SearchBudget.prototype.query
      const delayed = vi.spyOn(SearchBudget.prototype, 'query').mockImplementation(function <T>(
        this: SearchBudget,
        stage: SearchStage,
        run: (executor: SearchExecutor) => PromiseLike<T>
      ): Promise<T> {
        return query.call(this, stage, async (tx) => {
          if (incompleteSearch) await tx.execute(sql`SELECT pg_sleep(9)`)
          return run(tx)
        }) as Promise<T>
      })
      const started = performance.now()
      try {
        await db
          .update(embedding)
          .set({
            content: longContent,
            contentLength: longContent.length,
            tokenCount: Math.ceil(longContent.length / 4),
          })
          .where(eq(embedding.id, chunkId))
        const admission = await externalFetch(new URL('/api/copilot/api-keys/validate', simUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': internalKey,
            'x-sim-billing-protocol': 'legacy-v0',
          },
          body: JSON.stringify({
            userId: ids.aliceId,
            organizationId: ids.organizationId,
            chatId: organizationChatId,
          }),
        })
        expect(admission.status, await admission.text()).toBe(200)
        let path = '/api/mothership'
        let body: Record<string, unknown> = {
          message:
            'Search for the Orion deployment guide that mentions an activation phrase and final checksum. Read enough of that document to report both values and cite it.',
          version: '3.0.0',
          mode: 'assistant',
          userId: ids.aliceId,
          organizationId: ids.organizationId,
          chatId: organizationChatId,
        }
        for (let round = 0; round < 8; round++) {
          const response = await externalFetch(new URL(path, assistantUrl), {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'x-sim-billing-protocol': 'legacy-v0',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120000),
          })
          const wire = await response.text()
          expect(response.status, wire.slice(0, 2000)).toBe(200)
          expect(Buffer.byteLength(wire)).toBeLessThan(2 * 1024 * 1024)
          const pending = new Map<string, MothershipStreamV1ToolCallDescriptor>()
          let checkpoint: MothershipStreamV1CheckpointPausePayload | undefined
          let streamId = ''
          for (const line of wire.split('\n')) {
            if (!line.startsWith('data:')) continue
            const raw = line.slice(5).trim()
            if (!raw || raw === '[DONE]') continue
            const event: unknown = JSON.parse(raw)
            if (!isContractStreamEventEnvelope(event))
              throw new Error('Assistant returned an invalid generated stream envelope')
            streamId = event.stream.streamId
            if (event.type === 'error') throw new Error(JSON.stringify(event.payload))
            if (event.type === 'text') answer += event.payload.text
            if (
              event.type === 'tool' &&
              event.payload.phase === 'call' &&
              !event.payload.partial &&
              event.payload.arguments
            )
              pending.set(event.payload.toolCallId, event.payload)
            if (event.type === 'run' && event.payload.kind === 'checkpoint_pause')
              checkpoint = event.payload
          }
          if (!checkpoint) break
          const results = await Promise.all(
            checkpoint.pendingToolCallIds.map(async (callId) => {
              const call = pending.get(callId)
              if (!call) throw new Error('Checkpoint referenced an absent tool call')
              const tool =
                call.toolName === 'search_workspace'
                  ? searchWorkspaceServerTool
                  : call.toolName === 'read_document'
                    ? readDocumentServerTool
                    : undefined
              if (!tool) throw new Error(`Unexpected Assistant tool: ${call.toolName}`)
              const toolStarted = performance.now()
              const result = await tool.execute(call.arguments, {
                userId: ids.aliceId,
                organizationId: ids.organizationId,
                chatId: organizationChatId,
                toolCallId: callId,
                copilotToolExecution: true,
                requestMode: 'assistant',
                resolvedSecretTraceRegistry: registry,
              })
              calls.push({
                name: call.toolName,
                arguments: call.arguments,
                milliseconds: performance.now() - toolStarted,
                bytes: Buffer.byteLength(JSON.stringify(result)),
              })
              const { success } = z.object({ success: z.boolean() }).parse(result)
              expect(success).toBe(true)
              if (incompleteSearch) {
                expect(call.toolName).toBe('search_workspace')
                expect(result).toMatchObject({
                  data: {
                    retrieval: { status: 'partial', timedOutLegs: ['vector', 'keyword'] },
                    results: [],
                  },
                })
              }
              return { callId, name: call.toolName, success, data: result }
            })
          )
          incompleteSearch = false
          path = '/api/tools/resume'
          body = {
            checkpointId: checkpoint.checkpointId,
            streamId,
            userId: ids.aliceId,
            organizationId: ids.organizationId,
            chatId: organizationChatId,
            results,
          }
          report['assistant.live.progress'] = { rounds: round + 1, calls }
          saveReport()
        }
        report['assistant.live'] = { milliseconds: performance.now() - started, calls, answer }
        saveReport()
        expect(answer).toContain('SILVER COMET')
        expect(answer).toContain('K7M2-84')
        expect(answer).toContain('<source>')
        expect(answer).not.toMatch(/timed?\s*out|timeout|internal retr(?:y|ies)/i)
        expect(calls.some((call) => call.name === 'read_document')).toBe(true)
        expect(calls.filter((call) => call.name === 'search_workspace').length).toBeGreaterThan(1)
        expect(calls.every((call) => call.bytes < 40000)).toBe(true)
      } finally {
        delayed.mockRestore()
        await db.update(embedding).set(original).where(eq(embedding.id, chunkId))
      }
    },
    10 * 60_000
  )
})
