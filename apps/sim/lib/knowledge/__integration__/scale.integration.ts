import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { db } from '@sim/db'
import { document, embedding, knowledgeConnector, user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { resolveKnowledgeAccessScope } from '@/lib/knowledge/access/scope'
import { type KnowledgeAccessScope, WORKSPACE_ACCESS_TOKENS } from '@/lib/knowledge/access/types'
import {
  beginListingCheckpoint,
  listingFingerprint,
} from '@/lib/knowledge/connectors/listing-checkpoint'
import { runConnectorContentPass } from '@/lib/knowledge/connectors/sync-content-pass'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'
import { loadPageCorpus } from '@/lib/knowledge/connectors/sync-primitives'
import { executeKnowledgeSearch, getStructuredTagFilters } from '@/lib/knowledge/search/queries'
import type { StructuredFilter } from '@/lib/knowledge/types'
import { embeddingDistance } from '@/lib/knowledge/vector-columns'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import type { SyncResult } from '@/connectors/types'

/** Run through the disposable-container runner with KNOWLEDGE_SCALE_TEST=true. */
const enabled = process.env.KNOWLEDGE_SCALE_TEST === 'true'
const metadataOnly = process.env.KNOWLEDGE_SCALE_PHASE === 'metadata'
const keepDatabase = process.env.KNOWLEDGE_SCALE_KEEP_DATABASE === 'true'
const bulkSeed = process.env.KNOWLEDGE_SCALE_BULK_SEED === 'true'
const reuseReportFile = process.env.KNOWLEDGE_SCALE_REUSE_REPORT_FILE
const distribution = z
  .enum(['periodic-stress', 'clustered-control'])
  .parse(process.env.KNOWLEDGE_SCALE_DISTRIBUTION ?? 'periodic-stress')
const rows = Number(process.env.KNOWLEDGE_SCALE_DOCUMENTS ?? 250_000)
const SEED_BATCH_SIZE = 2_000
const PAGE_SIZE = 500
const DIMENSIONS = 1536
const logger = createLogger('KnowledgeScaleIntegration')
if (reuseReportFile && statSync(reuseReportFile).size > 16 * 1024 * 1024)
  throw new Error('Retained scale report must be at most 16 MiB')
const ids = reuseReportFile
  ? z
      .object({
        fixture: z.object({
          aliceId: z.uuid(),
          bobId: z.uuid(),
          workspaceId: z.uuid(),
          organizationId: z.uuid(),
          knowledgeBaseId: z.uuid(),
          connectorId: z.uuid(),
          lockId: z.uuid(),
          groups: z.array(z.string().max(128)).length(3),
          groupIds: z.array(z.uuid()).length(3),
        }),
      })
      .parse(JSON.parse(readFileSync(reuseReportFile, 'utf8'))).fixture
  : createKnowledgeAclFixtureIds()
const aliceToken = `u:${ids.aliceId}@fixture.test`
const bobToken = `u:${ids.bobId}@fixture.test`
const prefix = `${ids.workspaceId}-`
const startedAt = new Date()
const report: Record<string, unknown> = {
  fixture: ids,
  method: {
    documents: rows,
    dimensions: DIMENSIONS,
    seedBatchSize: SEED_BATCH_SIZE,
    providerCalls: 0,
    vectors:
      distribution === 'periodic-stress'
        ? 'Adversarial periodic one-parameter cosine coordinates; not representative semantic embeddings'
        : 'Normalized deterministic clustered coordinates; numerical control, not semantic quality',
    distribution,
    vectorIndexSetup: reuseReportFile
      ? 'Retained corpus and existing HNSW; no vector reseeding'
      : bulkSeed
        ? 'Bulk fixture load, then exact canonical HNSW recreation; not ingestion throughput'
        : 'Incremental insertion into all current indexes',
    sampleRepetitions: 3,
    cache: 'First sample then two warm samples; no server cache flush',
    plans: 'EXPLAIN ANALYZE BUFFERS of the equivalent production predicates and projections',
  },
}

function saveReport() {
  const file = process.env.KNOWLEDGE_SCALE_REPORT_FILE
  if (file) writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 })
}

async function measure<T>(label: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now()
  const result = await work()
  const milliseconds = Number((performance.now() - start).toFixed(2))
  report[label] = {
    milliseconds,
    rssBytes: process.memoryUsage().rss,
    ...(Array.isArray(result) ? { returnedRows: result.length } : {}),
  }
  saveReport()
  logger.info(label, report[label])
  return result
}

async function explain(label: string, query: SQL, iterative = false) {
  const run = async (executor: Pick<typeof db, 'execute'>) => {
    const plan = await executor.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`)
    report[`${label}.plan`] = plan[0]['QUERY PLAN']
  }
  if (iterative) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`)
      await tx.execute(sql`SET LOCAL hnsw.max_scan_tuples = 20000`)
      await run(tx)
    })
  } else await run(db)
  saveReport()
}

async function snapshot(label: string) {
  const size =
    await db.execute(sql`SELECT pg_database_size(current_database())::text AS database_bytes,
    pg_total_relation_size('document')::text AS document_bytes,
    pg_total_relation_size('embedding')::text AS embedding_bytes,
    (SELECT sum(total_bytes)::text FROM pg_backend_memory_contexts) AS current_backend_memory_bytes`)
  report[label] = { ...size[0], process: process.memoryUsage(), usage: process.resourceUsage() }
  saveReport()
  logger.info(label, size[0])
}

function page(offset: number) {
  return Array.from({ length: PAGE_SIZE }, (_, index) => String(offset + index + 1))
}

async function checkPage(label: string, externalIds: string[]) {
  for (let sample = 0; sample < 3; sample++) {
    const corpus = await measure(`${label}.${sample}`, () =>
      loadPageCorpus(ids.connectorId, externalIds)
    )
    expect(corpus.priorByExternalId.size).toBe(PAGE_SIZE)
    for (const externalId of externalIds) {
      expect(corpus.priorByExternalId.get(externalId)?.id).toBe(`${prefix}${externalId}`)
    }
    expect(corpus.excludedExternalIds).toEqual(
      new Set(externalIds.filter((id) => Number(id) % 997 === 0))
    )
  }
  const query = db
    .select({
      id: document.id,
      externalId: document.externalId,
      contentHash: document.contentHash,
      storageKey: document.storageKey,
      userExcluded: document.userExcluded,
      sourceSeenAt: document.sourceSeenAt,
    })
    .from(document)
    .where(
      and(
        eq(document.connectorId, ids.connectorId),
        inArray(document.externalId, externalIds),
        isNull(document.archivedAt)
      )
    )
    .limit(501)
  await explain(label, query.getSQL())
}

describe.skipIf(!enabled)('knowledge scale: isolated real PostgreSQL, no providers', () => {
  beforeAll(async () => {
    if (!Number.isInteger(rows) || rows < 10_000 || rows > 1_000_000 || rows % PAGE_SIZE !== 0) {
      throw new Error(
        'KNOWLEDGE_SCALE_DOCUMENTS must be a multiple of 500 between 10000 and 1000000'
      )
    }
    if (reuseReportFile) {
      if (!keepDatabase || bulkSeed || distribution !== 'periodic-stress')
        throw new Error('Retained fixture reuse requires keep=true, bulk=false, periodic-stress')
      const [existing] = await db.select().from(workspace).where(eq(workspace.id, ids.workspaceId))
      expect(existing?.name).toBe('ACL integration fixture')
      expect(existing?.ownerId).toBe(ids.aliceId)
      const [connector] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
      expect(connector?.knowledgeBaseId).toBe(ids.knowledgeBaseId)
      expect(connector?.syncLockToken).toBe(ids.lockId)
      const [count] = await db.execute(
        sql`SELECT count(*)::int AS count FROM document WHERE connector_id = ${ids.connectorId}`
      )
      expect(count.count).toBe(rows)
      await db.execute(
        sql`UPDATE document SET source_seen_at = ${startedAt.toISOString()}::timestamp WHERE connector_id = ${ids.connectorId}`
      )
    } else await seedKnowledgeAclFixture(ids)
    report.indexes = await db.execute(
      sql`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE tablename IN ('document', 'embedding') ORDER BY tablename, indexname`
    )
    report.server = (
      await db.execute(
        sql`SELECT version(), current_setting('shared_buffers') AS shared_buffers, current_setting('work_mem') AS work_mem, current_setting('maintenance_work_mem') AS maintenance_work_mem, (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector`
      )
    )[0]
    await snapshot('beforeSeed')
    if (!reuseReportFile)
      await measure('seed.metadata', async () => {
        for (let first = 1; first <= rows; first += SEED_BATCH_SIZE) {
          await db.execute(sql`INSERT INTO document (id, knowledge_base_id, connector_id, external_id, filename, file_url, file_size, mime_type,
          processing_status, content_hash, chunk_count, acl, acl_verified_at, source_seen_at, tag1, user_excluded, deleted_at)
          SELECT ${prefix} || n, ${ids.knowledgeBaseId}, ${ids.connectorId}, n::text,
            'Scale fixture ' || n, 'https://fixture.invalid/' || n, 128, 'text/plain', 'completed', 'hash-' || n, 1,
            CASE WHEN n % 1000 = 0 THEN ARRAY[${aliceToken}, ${bobToken}]::text[] ELSE ARRAY[${aliceToken}]::text[] END,
            ${startedAt.toISOString()}::timestamp, ${startedAt.toISOString()}::timestamp,
            CASE WHEN n % 11 = 0 THEN 'selective' ELSE 'broad' END,
            n % 997 = 0, CASE WHEN n % 100 = 99 THEN ${startedAt.toISOString()}::timestamp ELSE NULL END
          FROM generate_series(${first}::int, ${Math.min(rows, first + SEED_BATCH_SIZE - 1)}::int) n`)
        }
      })
    await db.execute(sql`ANALYZE document`)
    await snapshot('afterMetadata')
  }, 300_000)

  afterAll(async () => {
    if (!enabled) return
    try {
      await snapshot('final')
      if (!keepDatabase) {
        await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
        await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
      }
    } finally {
      await db.$client.end()
    }
  }, 300_000)

  it('loads 500 identities including tombstones at the beginning, middle and end', async () => {
    await checkPage('page.beginning', page(0))
    await checkPage('page.middle', page(Math.floor(rows / 2 / PAGE_SIZE) * PAGE_SIZE))
    await checkPage('page.end', page(rows - PAGE_SIZE))
    const externalIds = page(rows - PAGE_SIZE)
    const acls = new Map(
      externalIds.map((externalId) => [externalId, [aliceToken] as readonly string[]])
    )
    const updated = await measure('acl.only.metadata', () =>
      persistDocumentAcls(ids.connectorId, acls)
    )
    expect(updated).toEqual({ updated: PAGE_SIZE, rejected: 0 })
    await explain(
      'acl.only',
      sql`UPDATE document SET acl = ARRAY[${aliceToken}]::text[], acl_requirements = '[]'::jsonb, acl_verified_at = statement_timestamp()
      WHERE connector_id = ${ids.connectorId} AND external_id IN (${sql.join(
        externalIds.map((id) => sql`${id}`),
        sql`,`
      )}) RETURNING id`
    )
  }, 300_000)

  it('reconciles bounded absent batches through the actual content pass', async () => {
    const absentCount = Math.min(10_000, Math.floor(rows / 10 / PAGE_SIZE) * PAGE_SIZE)
    report.reconciliationAbsentDocuments = absentCount
    const fingerprint = listingFingerprint({ scale: ids.workspaceId })
    const checkpoint = beginListingCheckpoint({ fingerprint, generationId: ids.lockId, startedAt })
    checkpoint.complete = true
    checkpoint.listedCount = rows - absentCount
    await db.execute(
      sql`UPDATE document SET source_seen_at = CASE WHEN external_id::integer <= ${rows - absentCount / 2} THEN NULL ELSE '2000-01-01 00:00:00.000123'::timestamp END, deleted_at = NULL, user_excluded = false WHERE connector_id = ${ids.connectorId} AND external_id::integer > ${rows - absentCount}`
    )
    await db
      .update(knowledgeConnector)
      .set({ listingCheckpoint: checkpoint })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    const [connector] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, ids.connectorId))
    const result: SyncResult = {
      docsAdded: 0,
      docsUpdated: 0,
      docsDeleted: 0,
      docsUnchanged: 0,
      docsSkipped: 0,
      docsFailed: 0,
      processingDispatch: { requested: 0, accepted: 0, failed: 0 },
    }
    await explain(
      'reconciliation.absentBatch',
      sql`SELECT id FROM document WHERE connector_id = ${ids.connectorId} AND user_excluded = false AND archived_at IS NULL
      AND (source_seen_at IS NULL OR source_seen_at < ${startedAt.toISOString()}::timestamp) AND cardinality(acl) > 0 LIMIT 500`
    )
    const seenOrder = sql`COALESCE(${document.sourceSeenAt}, '-infinity'::timestamp)`
    const absent = sql`connector_id = ${ids.connectorId} AND user_excluded = false AND archived_at IS NULL
      AND ${seenOrder} < ${startedAt.toISOString()}::timestamp AND cardinality(acl) > 0`
    const firstPage = db
      .select({ id: document.id, seenAt: sql<string>`${seenOrder}::text` })
      .from(document)
      .where(absent)
      .orderBy(asc(seenOrder), asc(document.id))
      .limit(PAGE_SIZE)
    await explain('reconciliation.keyset.first', firstPage.getSQL())
    const firstCandidates = await firstPage
    expect(firstCandidates).toHaveLength(PAGE_SIZE)
    const nextPage = db
      .select({ id: document.id })
      .from(document)
      .where(
        and(
          absent,
          sql`(${seenOrder}, ${document.id}) > (${firstCandidates.at(-1)!.seenAt}::timestamp, ${firstCandidates.at(-1)!.id})`
        )
      )
      .orderBy(asc(seenOrder), asc(document.id))
      .limit(PAGE_SIZE)
    await explain('reconciliation.keyset.next', nextPage.getSQL())
    const nextCandidates = await nextPage
    expect(nextCandidates).toHaveLength(PAGE_SIZE)
    expect(new Set([...firstCandidates, ...nextCandidates].map((row) => row.id)).size).toBe(
      2 * PAGE_SIZE
    )
    const outcome = await measure('reconciliation.actual', async () =>
      runConnectorContentPass({
        connectorId: ids.connectorId,
        connector,
        connectorConfig: CONNECTOR_REGISTRY.confluence,
        sourceConfig: {},
        syncContext: {},
        kbOwner: { userId: ids.aliceId, workspaceId: ids.workspaceId },
        billingAttribution: await resolveBillingAttribution({
          actorUserId: ids.aliceId,
          workspaceId: ids.workspaceId,
        }),
        result,
        lease: createContentSyncLease(ids.connectorId, ids.lockId),
        leaseKind: 'content',
        runId: ids.lockId,
        fingerprint,
        documentAccess: 'admin',
        getAccessToken: async () => {
          throw new Error('Scale test must never call a provider')
        },
        hydration: {
          getDocument: async () => {
            throw new Error('Scale test must never hydrate content')
          },
        },
        forceRehydrate: false,
        deadlineAt: Date.now() + 300_000,
      })
    )
    expect(outcome.complete).toBe(true)
    expect(outcome.holdNotice).toBeNull()
    const [removed] = await db.execute(
      sql`SELECT count(*)::int AS count FROM document WHERE connector_id = ${ids.connectorId} AND external_id::integer > ${rows - absentCount} AND deleted_at IS NOT NULL AND cardinality(acl) = 0`
    )
    expect(removed.count).toBe(absentCount)
    expect(result.docsDeleted).toBe(0)
    await db.execute(sql`UPDATE document SET source_seen_at = ${startedAt.toISOString()}::timestamp, deleted_at = NULL, user_excluded = external_id::integer % 997 = 0, acl = ARRAY[${aliceToken}]::text[], acl_verified_at = statement_timestamp()
      WHERE connector_id = ${ids.connectorId} AND external_id::integer > ${rows - absentCount}`)
  }, 300_000)

  it('refreshes 500 ACLs without changing stored chunks', async () => {
    await seedVectorBatch(1, PAGE_SIZE)
    const externalIds = page(0)
    const [before] = await db.execute(
      sql`SELECT md5(string_agg(id || chunk_hash || updated_at::text, '' ORDER BY id)) AS checksum, count(*)::int AS count FROM embedding WHERE document_id IN (${sql.join(
        externalIds.map((id) => sql`${prefix + id}`),
        sql`,`
      )})`
    )
    expect(before.count).toBe(PAGE_SIZE)
    await measure('acl.only.withVectors', () =>
      persistDocumentAcls(ids.connectorId, new Map(externalIds.map((id) => [id, [aliceToken]])))
    )
    const [after] = await db.execute(
      sql`SELECT md5(string_agg(id || chunk_hash || updated_at::text, '' ORDER BY id)) AS checksum, count(*)::int AS count FROM embedding WHERE document_id IN (${sql.join(
        externalIds.map((id) => sql`${prefix + id}`),
        sql`,`
      )})`
    )
    expect(after).toEqual(before)
  }, 300_000)

  it.skipIf(metadataOnly)(
    'stores a bounded dense corpus and measures ACL/tag-filtered vector and hybrid retrieval',
    async () => {
      let vectorIndexDefinition: string | undefined
      if (bulkSeed) {
        const other = await db
          .select({ id: embedding.id })
          .from(embedding)
          .where(sql`${embedding.knowledgeBaseId} <> ${ids.knowledgeBaseId}`)
          .limit(1)
        if (other.length)
          throw new Error(
            'Bulk scale setup requires a database containing only its own fixture chunks'
          )
        const [index] = await db.execute(
          sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'embedding_vector_hnsw_idx'`
        )
        if (typeof index?.indexdef !== 'string')
          throw new Error('Canonical 1536-dimensional HNSW index is missing')
        vectorIndexDefinition = index.indexdef
        await db.execute(sql`DROP INDEX embedding_vector_hnsw_idx`)
      }
      if (!reuseReportFile)
        await measure('seed.vectors', async () => {
          for (let first = 1; first <= rows; first += SEED_BATCH_SIZE) {
            await seedVectorBatch(first, Math.min(rows, first + SEED_BATCH_SIZE - 1))
            if (first === 1 || (first - 1) % 20_000 === 0) {
              report.vectorSeedProgress = {
                seeded: Math.min(rows, first + SEED_BATCH_SIZE - 1),
                rows,
                rssBytes: process.memoryUsage().rss,
              }
              saveReport()
              logger.info('Vector seed progress', report.vectorSeedProgress)
            }
          }
        })
      if (vectorIndexDefinition) {
        const definition = vectorIndexDefinition
        await measure('seed.hnswBuild', () =>
          db.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL maintenance_work_mem = '2GB'`)
            await tx.execute(sql`SET LOCAL max_parallel_maintenance_workers = 2`)
            await tx.execute(sql.raw(definition))
          })
        )
        const [restored] = await db.execute(
          sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'embedding_vector_hnsw_idx'`
        )
        expect(restored.indexdef).toBe(vectorIndexDefinition)
      }
      await db.execute(sql`ANALYZE embedding`)
      await db.execute(sql`ANALYZE document`)
      const [count] = await db.execute(
        sql`SELECT count(*)::int AS count FROM embedding WHERE knowledge_base_id = ${ids.knowledgeBaseId}`
      )
      expect(count.count).toBe(rows)
      await snapshot('afterVectors')
      const queryId = `${prefix}${Math.min(rows, 11_000)}`
      const [queryChunk] = await db.execute(
        sql`SELECT embedding::text AS vector FROM embedding WHERE id = ${queryId}`
      )
      const vector = z.string().parse(queryChunk.vector)
      const workspaceResults = await measure('search.workspace.denied', () =>
        executeKnowledgeSearch({
          knowledgeBaseIds: [ids.knowledgeBaseId],
          topK: 10,
          access: { kind: 'workspace', tokens: WORKSPACE_ACCESS_TOKENS },
          searchMode: 'hybrid',
          query: 'Orion',
          queryVector: { vector, dimensions: DIMENSIONS },
        })
      )
      expect(workspaceResults).toEqual([])
      for (const [label, userId] of [
        ['broad', ids.aliceId],
        ['selective', ids.bobId],
      ] as const) {
        const access = await resolveKnowledgeAccessScope(
          { kind: 'session', userId, sessionId: `scale-${userId}` },
          { workspaceId: ids.workspaceId }
        )
        for (const filtered of [false, true]) {
          const filters: StructuredFilter[] | undefined = filtered
            ? [{ tagSlot: 'tag1', fieldType: 'text', operator: 'eq', value: 'selective' }]
            : undefined
          const queryGroup = `search.${label}.${filtered ? 'tag' : 'all'}`
          const exact = await measure(`${queryGroup}.exact`, () =>
            exactVectorReference(access, vector, filters)
          )
          const exactIds = new Set(exact.map((row) => row.id))
          try {
            for (const mode of ['vector', 'hybrid'] as const) {
              const queryLabel = `search.${label}.${filtered ? 'tag' : 'all'}.${mode}`
              for (let sample = 0; sample < 3; sample++) {
                const result = await measure(`${queryLabel}.${sample}`, () =>
                  executeKnowledgeSearch({
                    knowledgeBaseIds: [ids.knowledgeBaseId],
                    topK: 10,
                    access,
                    searchMode: mode,
                    query: 'Orion',
                    queryVector: { vector, dimensions: DIMENSIONS },
                    structuredFilters: filters,
                  })
                )
                expect(result).toHaveLength(exact.length)
                for (const row of result) {
                  const ordinal = Number(row.id.slice(prefix.length))
                  expect(ordinal).toBeGreaterThan(0)
                  expect(ordinal).toBeLessThanOrEqual(rows)
                  if (userId === ids.bobId) expect(ordinal % 1000).toBe(0)
                  if (filtered) expect(row.tag1).toBe('selective')
                  expect(ordinal % 997).not.toBe(0)
                }
                if (mode === 'vector') {
                  expect(result.map((row) => row.distance)).toEqual(
                    result.map((row) => row.distance).sort((a, b) => a - b)
                  )
                  report[`${queryLabel}.${sample}.recallAt10`] = exact.length
                    ? result.filter((row) => exactIds.has(row.id)).length / exact.length
                    : 1
                  saveReport()
                }
              }
            }
          } finally {
            await explainSearch(
              `search.${label}.${filtered ? 'tag' : 'all'}`,
              access,
              vector,
              filters
            )
          }
        }
      }
    },
    3_600_000
  )
})

function searchConditions(access: KnowledgeAccessScope, filters?: StructuredFilter[]) {
  return and(
    eq(embedding.knowledgeBaseId, ids.knowledgeBaseId),
    eq(embedding.enabled, true),
    eq(document.enabled, true),
    eq(document.processingStatus, 'completed'),
    eq(document.userExcluded, false),
    isNull(document.archivedAt),
    isNull(document.deletedAt),
    knowledgeAccessCondition(access),
    ...(filters ? getStructuredTagFilters(filters, embedding) : [])
  )
}

async function exactVectorReference(
  access: KnowledgeAccessScope,
  vector: string,
  filters?: StructuredFilter[]
) {
  const distance = embeddingDistance(DIMENSIONS, vector)
  return db.transaction(async (tx) => {
    /** HNSW is an index scan; disabling it makes this an exact ranking over all eligible rows. */
    await tx.execute(sql`SET LOCAL enable_indexscan = off`)
    return tx
      .select({ id: embedding.id, distance: distance.as('distance') })
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .where(and(searchConditions(access, filters), sql`${distance} < 1`))
      .orderBy(distance)
      .limit(10)
  })
}

async function explainSearch(
  label: string,
  access: KnowledgeAccessScope,
  vector: string,
  filters?: StructuredFilter[]
) {
  const distance = embeddingDistance(DIMENSIONS, vector)
  const conditions = searchConditions(access, filters)
  const fields = sql`embedding.id, embedding.content, embedding.document_id, embedding.chunk_index, embedding.tag1, embedding.tag2, embedding.tag3,
    embedding.tag4, embedding.tag5, embedding.tag6, embedding.tag7, embedding.number1, embedding.number2, embedding.number3, embedding.number4, embedding.number5,
    embedding.date1, embedding.date2, embedding.boolean1, embedding.boolean2, embedding.boolean3, embedding.knowledge_base_id, document.source_modified_at`
  await explain(
    `${label}.vector`,
    sql`SELECT ${fields}, ${distance} AS distance FROM embedding JOIN document ON embedding.document_id = document.id WHERE ${conditions} AND ${distance} < 1 ORDER BY ${distance} LIMIT 10`,
    true
  )
  await explain(
    `${label}.keyword`,
    sql`SELECT embedding.id, ts_rank_cd(embedding.content_tsv, websearch_to_tsquery('english', 'Orion')) AS keyword_rank
    FROM embedding JOIN document ON embedding.document_id = document.id WHERE ${conditions} AND embedding.content_tsv @@ websearch_to_tsquery('english', 'Orion')
    ORDER BY ts_rank_cd(embedding.content_tsv, websearch_to_tsquery('english', 'Orion')) DESC LIMIT 50`
  )
}

async function seedVectorBatch(first: number, last: number) {
  const coordinates =
    distribution === 'periodic-stress'
      ? sql`ARRAY(SELECT (0.25 + cos(n::double precision * coordinate::double precision * 0.001))::real FROM generate_series(1, ${DIMENSIONS}) coordinate)::vector(1536)`
      : sql`l2_normalize(ARRAY(SELECT (
        2 * (sin((n % 2500 + 1)::double precision * coordinate * 12.9898 + 78.233) * 43758.5453 - floor(sin((n % 2500 + 1)::double precision * coordinate * 12.9898 + 78.233) * 43758.5453)) - 1
        + 0.2 * (2 * (sin(n::double precision * coordinate * 39.3467 + 11.135) * 47453.5453 - floor(sin(n::double precision * coordinate * 39.3467 + 11.135) * 47453.5453)) - 1)
      )::real FROM generate_series(1, ${DIMENSIONS}) coordinate)::vector(1536))`
  await db.execute(sql`INSERT INTO embedding (id, knowledge_base_id, document_id, chunk_index, chunk_hash, content, content_length, token_count, start_offset, end_offset, tag1, embedding)
          SELECT ${prefix} || n, ${ids.knowledgeBaseId}, ${prefix} || n, 0, 'hash-' || n,
            CASE WHEN n % 17 = 0 THEN 'Orion reference engineering design scale fixture ' ELSE 'Synthetic enterprise document fixture ' END || n,
            80, 20, 0, 80, CASE WHEN n % 11 = 0 THEN 'selective' ELSE 'broad' END,
            ${coordinates}
          FROM generate_series(${first}::int, ${last}::int) n ON CONFLICT (id) DO NOTHING`)
}
