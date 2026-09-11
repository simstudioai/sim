/** Real Assistant tool, application authorization, PostgreSQL/pgvector, and result processing. */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { db } from '@sim/db'
import {
  copilotChats,
  credential,
  credentialGroup,
  document,
  knowledgeBase,
  knowledgeConnector,
  member,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { createLogger, Logger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, type MockInstance, vi } from 'vitest'
import { z } from 'zod'
import { searchWorkspaceServerTool } from '@/lib/copilot/tools/server/knowledge/workspace-search'
import { seedSearchReaderFixture } from '@/lib/knowledge/__integration__/seed-search-reader-fixture'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { searchScopedKnowledge } from '@/lib/knowledge/application/workspace-search'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/** Initialize controlled provider configuration before the real application modules load. */
vi.hoisted(() => {
  if (process.env.KNOWLEDGE_SEARCH_PERFORMANCE_TEST === 'true') {
    Object.assign(process.env, {
      OPENAI_API_KEY: 'isolated-embedding-http-fixture',
      CONFLUENCE_CLIENT_ID: 'isolated-confluence-fixture-client',
      CONFLUENCE_CLIENT_SECRET: 'isolated-confluence-fixture-secret',
    })
  }
})

const enabled = process.env.KNOWLEDGE_SEARCH_PERFORMANCE_TEST === 'true'
const chunkCount = Number(process.env.KNOWLEDGE_SEARCH_PERFORMANCE_CHUNKS ?? 20_000)
const dimensions = 1536
const chunksPerDocument = 4
const batchSize = 1000
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
  if (statSync(file).size > 8 * 1024 * 1024) throw new Error('Fixture report exceeds 8 MiB')
  return z
    .object({ fixture: fixtureSchema, unrelatedFixture: fixtureSchema })
    .parse(JSON.parse(readFileSync(file, 'utf8')))
}
const reused = reuseFile ? readFixtureReport(reuseFile) : undefined
const ids = reused?.fixture ?? createKnowledgeAclFixtureIds()
const unrelated = reused?.unrelatedFixture ?? createKnowledgeAclFixtureIds()
const organizationChatId = generateId()
const queryVector = Array.from({ length: dimensions }, (_, index) => (index === 0 ? 1 : 0))
const captured: CapturedQuery[] = []
const report: Record<string, unknown> = {
  fixture: ids,
  unrelatedFixture: unrelated,
  method: {
    chunkCount,
    dimensions,
    chunksPerDocument,
    sql: 'Captured from the real Assistant tool; no hand-written search query',
    providers:
      'Embedding and source-permission HTTP responses are controlled; internal search and authorization code is real',
    vectors:
      'Normalized topic clusters with deterministic dense noise; not semantic-quality evaluation',
    cache: 'First and repeated samples; no claim of a cold operating-system cache',
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
  'Index Name'?: string
  Plans?: ExplainNode[]
}

const explainNodeSchema: z.ZodType<ExplainNode> = z.lazy(() =>
  z
    .object({
      'Node Type': z.string(),
      'Actual Rows': z.number(),
      'Index Name': z.string().optional(),
      Plans: z.array(explainNodeSchema).optional(),
    })
    .passthrough()
)
const explainSchema = z.array(z.object({ Plan: explainNodeSchema }).passthrough()).length(1)

function usesVectorIndex(node: ExplainNode): boolean {
  return (
    node['Index Name'] === 'embedding_vector_hnsw_idx' ||
    (node.Plans?.some(usesVectorIndex) ?? false)
  )
}

function saveReport() {
  const file = process.env.KNOWLEDGE_SEARCH_PERFORMANCE_REPORT_FILE
  if (file) writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 })
}

const diagnosticSchema = z
  .object({
    surface: z.enum(['dashboard', 'copilot']),
    outcome: z.literal('success'),
    elapsedMs: z.number(),
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
      z.object({ documentId: z.string(), content: z.string(), knowledgeBaseId: z.string() })
    ),
  }),
})

async function search(
  userId = ids.aliceId,
  query = 'Orion deployment',
  filters: WorkspaceSearchFilters = {},
  organizationScope = false
) {
  return resultSchema.parse(
    await searchWorkspaceServerTool.execute(
      { query, topK: 15, ...filters },
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

async function sample(label: string, run: () => ReturnType<typeof search>) {
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
      item.query.includes('from "embedding"') &&
      (item.query.includes('order by') || item.query.includes('limit'))
  )
  const plans = []
  for (const query of searches) {
    const plan = await db.$client.begin(async (tx) => {
      await tx.unsafe("SET LOCAL hnsw.iterative_scan = 'relaxed_order'")
      await tx.unsafe('SET LOCAL hnsw.max_scan_tuples = 20000')
      return tx.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.query}`, query.parameters)
    })
    plans.push({
      kind: query.query.includes('keyword_rank')
        ? 'keyword'
        : query.query.includes('order by')
          ? 'vector'
          : 'probe',
      query: query.query,
      parameters: query.parameters,
      plan: explainSchema.parse(plan[0]['QUERY PLAN']),
    })
  }
  report[label] = {
    milliseconds,
    diagnostics,
    queryCount: captured.length,
    resultCount: result.data.results.length,
    plans,
  }
  saveReport()
  logger.info(label, {
    milliseconds,
    queryCount: captured.length,
    resultCount: result.data.results.length,
  })
  return { result, plans, diagnostics }
}

describe.skipIf(!enabled)('Assistant search latency on a realistic indexed corpus', () => {
  beforeAll(async () => {
    if (
      !Number.isInteger(chunkCount) ||
      chunkCount < 10_000 ||
      chunkCount > 200_000 ||
      chunkCount % batchSize !== 0
    )
      throw new Error(
        'KNOWLEDGE_SEARCH_PERFORMANCE_CHUNKS must be a multiple of 1000 from 10000 to 200000'
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
      if (url !== 'https://api.openai.com/v1/embeddings')
        throw new Error(`Unexpected outbound request in search fixture: ${new URL(url).origin}`)
      const body = z
        .object({ input: z.array(z.string()).length(1), encoding_format: z.literal('base64') })
        .parse(JSON.parse(String(init?.body)))
      embeddingCalls += body.input.length
      const bytes = Buffer.alloc(dimensions * 4)
      queryVector.forEach((value, index) => bytes.writeFloatLE(value, index * 4))
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
        expect(size.count).toBe(fixture === ids ? chunkCount : chunkCount / 2)
      }
      await db
        .update(knowledgeBase)
        .set({ workspaceId: ids.workspaceId, organizationId: null })
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
      await db
        .update(knowledgeBase)
        .set({ isSearchIndex: true })
        .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      const indexes = await db.execute<{
        indexname: string
        indexdef: string
      }>(sql`SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'embedding' AND indexdef LIKE '% USING hnsw %'`)
      for (const index of indexes)
        await db.execute(sql`DROP INDEX ${sql.identifier(index.indexname)}`)
      for (const fixture of [ids, unrelated]) {
        const count = fixture === ids ? chunkCount : chunkCount / 2
        for (let first = 0; first < count / chunksPerDocument; first += batchSize) {
          const last = Math.min(first + batchSize, count / chunksPerDocument) - 1
          await db.execute(sql`INSERT INTO document
          (id, knowledge_base_id, connector_id, external_id, filename, file_url, file_size, mime_type, processing_status, acl, acl_verified_at)
          SELECT ${fixture.workspaceId} || '-doc-' || n, ${fixture.knowledgeBaseId}, ${fixture.connectorId}, n::text,
            'Deployment guide ' || n, 'https://fixture.invalid/document/' || n, 12000, 'text/plain', 'completed',
            ARRAY[${`u:${fixture.aliceId}@fixture.test`}]::text[], statement_timestamp()
          FROM generate_series(${first}::int, ${last}::int) n`)
        }
        for (let first = 0; first < count; first += batchSize) {
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
            l2_normalize(ARRAY(SELECT (CASE WHEN coordinate = n % 32 + 1 THEN 1 ELSE 0 END +
              0.025 * sin(n::double precision * coordinate * 12.9898 + coordinate * 78.233))::real
              FROM generate_series(1, ${dimensions}) coordinate)::vector(1536))
          FROM generate_series(${first}::int, ${last}::int) n`)
          })
        }
        logger.info('Synthetic corpus loaded', { chunks: count })
      }
      for (const index of indexes) await db.execute(sql.raw(index.indexdef))
    }
    await db.execute(sql`ANALYZE document`)
    await db.execute(sql`ANALYZE embedding`)
    report.server = (
      await db.execute(sql`SELECT version(), current_setting('work_mem') AS work_mem,
      (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector`)
    )[0]
    db.$client.options.debug = (_connection, query, parameters) => {
      if (capture && captured.length < 300) captured.push({ query, parameters: [...parameters] })
    }
    diagnosticLog = vi.spyOn(Logger.prototype, 'info')
  }, 60 * 60_000)

  afterAll(async () => {
    diagnosticLog?.mockRestore()
    db.$client.options.debug = previousDebug
    vi.unstubAllGlobals()
    saveReport()
    for (const fixture of process.env.KNOWLEDGE_SEARCH_PERFORMANCE_KEEP_DATABASE === 'true'
      ? []
      : [ids, unrelated]) {
      await db.delete(workspace).where(eq(workspace.id, fixture.workspaceId))
      await db.delete(organization).where(eq(organization.id, fixture.organizationId))
      await db.delete(user).where(eq(user.id, fixture.aliceId))
      await db.delete(user).where(eq(user.id, fixture.bobId))
    }
    await db.$client.end()
  }, 120_000)

  it('records first and repeated application searches with the actual SQL plans', async () => {
    for (let iteration = 0; iteration < 2; iteration++) {
      const { result, plans } = await sample(`broad.${iteration}`, () => search())
      expect(result.data.results).toHaveLength(15)
      expect(result.data.results.every((row) => row.knowledgeBaseId === ids.knowledgeBaseId)).toBe(
        true
      )
      expect(plans.length).toBeGreaterThanOrEqual(2)
      const vectorPlans = plans.filter((plan) => plan.kind === 'vector')
      expect(vectorPlans).toHaveLength(1)
      expect(usesVectorIndex(vectorPlans[0].plan[0].Plan)).toBe(true)
    }
    expect(embeddingCalls).toBe(2)
  }, 180_000)

  it('compares the Search tab and Assistant with the same person, query and index', async () => {
    const dashboard = await sample('dashboard', async () => {
      const result = await searchScopedKnowledge.execute({
        principal: { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-dashboard' },
        input: {
          workspaceId: ids.workspaceId,
          query: 'Orion deployment',
          topK: 15,
          surface: 'dashboard',
        },
      })
      return resultSchema.parse({ success: true, data: result })
    })
    const assistant = await sample('assistant.comparison', () => search())
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
    expect(usesVectorIndex(dashboardVector[0].plan[0].Plan)).toBe(true)
  }, 180_000)

  it('keeps inaccessible content out of an otherwise identical search', async () => {
    const { result } = await sample('denied', () => search(ids.bobId))
    expect(result.data.results).toEqual([])
  }, 180_000)

  it('ranks a small permission scope by its bounded IDs without a corpus-wide vector probe', async () => {
    const documentIds = [0, 8, 16].map((index) => `${ids.workspaceId}-doc-${index}`)
    await db
      .update(document)
      .set({ acl: [`u:${ids.aliceId}@fixture.test`, `u:${ids.bobId}@fixture.test`] })
      .where(inArray(document.id, documentIds))
    try {
      const { result, plans } = await sample('small-scope', () => search(ids.bobId))
      expect(result.data.results.length).toBeGreaterThan(0)
      expect(result.data.results.every((row) => documentIds.includes(row.documentId))).toBe(true)
      const probe = plans.filter((plan) => plan.kind === 'probe')
      expect(probe).toHaveLength(1)
      expect(probe[0].query).not.toContain('<=>')
      expect(probe[0].plan[0].Plan['Actual Rows']).toBe(12)
      const vector = plans.filter((plan) => plan.kind === 'vector')
      expect(vector).toHaveLength(1)
      expect(vector[0].query).toContain('"embedding"."id" in')
    } finally {
      await db
        .update(document)
        .set({ acl: [`u:${ids.aliceId}@fixture.test`] })
        .where(inArray(document.id, documentIds))
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

  it('runs two independent Assistant searches concurrently', async () => {
    const start = performance.now()
    const results = await Promise.all([search(), search(ids.aliceId, 'Engineering operations')])
    report.concurrent = {
      milliseconds: performance.now() - start,
      resultCounts: results.map((result) => result.data.results.length),
    }
    saveReport()
    for (const result of results) expect(result.data.results).toHaveLength(15)
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

  it('uses the same indexed retrieval through a persisted private organization Assistant chat', async () => {
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
    await db.execute(
      sql`UPDATE document SET acl = ARRAY[${`u:${ids.aliceId}@fixture.test`}] WHERE knowledge_base_id = ${ids.knowledgeBaseId}`
    )
    await db.execute(sql`ANALYZE document`)
    const { result } = await sample('organization', () =>
      search(ids.aliceId, 'Orion deployment', {}, true)
    )
    expect(result.data.results).toHaveLength(15)
    expect(result.data.results.every((row) => row.knowledgeBaseId === ids.knowledgeBaseId)).toBe(
      true
    )
  }, 180_000)
})
