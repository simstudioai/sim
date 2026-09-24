/**
 * Real PostgreSQL coverage for the dormant organization search runbook: the Tin trigger drop and
 * restore, and the search index deletion with its storage intents, connector reset, and the
 * guarantee that deleting marks nothing for the projector. Runs only by hand against a disposable
 * local database (see README.md); it is deliberately not listed in CI.
 */
import { db } from '@sim/db'
import {
  document,
  embedding,
  embeddingKeywordSearch,
  embeddingKeywordTin,
  embeddingSearch,
  knowledgeBase,
  knowledgeConnector,
  knowledgeProjectionDirty,
  organization,
  outboxEvent,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { installProjection } from '@sim/db/script-migrations/0019_tin_keyword_projection'
import { generateId } from '@sim/utils/id'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { KNOWLEDGE_STORAGE_CLEANUP_EVENT } from '@/lib/knowledge/documents/storage-cleanup'
import {
  disableTinProjection,
  postgresTinProjectionDatabase,
} from '@/scripts/dormant-org-search/disable-tin-projection'
import {
  migrationTinRestoreSteps,
  restoreTinProjection,
} from '@/scripts/dormant-org-search/restore-tin-projection'
import {
  deleteSearchIndexDocuments,
  SearchIndexDeletionRefused,
} from '@/scripts/dormant-org-search/search-index-deletion'
import { drizzleSearchIndexDeletionStore } from '@/scripts/dormant-org-search/search-index-deletion-store'

const ids = createKnowledgeAclFixtureIds()
const indexId = generateId()
const indexConnectorId = generateId()
const vector = Array.from({ length: 1536 }, (_, index) => (index % 7) / 10)
const DOCUMENTS = 7
const CHUNKS = 3
const timeouts = { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000 }
const sleep = async () => undefined

let pg: postgres.Sql
let tinFunctionsExisted = false
const indexDocumentIds: string[] = []
const workspaceDocumentId = generateId()
const bindingIds: string[] = []

function chunk(documentId: string, knowledgeBaseId: string, chunkIndex: number) {
  return {
    id: generateId(),
    documentId,
    knowledgeBaseId,
    chunkIndex,
    chunkHash: `fixture-hash-${chunkIndex}`,
    content: `dormant search fixture chunk ${chunkIndex}`,
    contentLength: 30,
    tokenCount: 5,
    startOffset: 0,
    endOffset: 30,
    embeddingModel: 'text-embedding-3-small',
    embedding: vector,
  }
}

async function rowsOf(knowledgeBaseId: string) {
  const counts = await Promise.all(
    [embedding, embeddingSearch, embeddingKeywordSearch, embeddingKeywordTin].map(async (table) => {
      const [row] = await db
        .select({ rows: count() })
        .from(table)
        .where(eq(table.knowledgeBaseId, knowledgeBaseId))
      return row.rows
    })
  )
  const [docs] = await db
    .select({ rows: count() })
    .from(document)
    .where(eq(document.knowledgeBaseId, knowledgeBaseId))
  return {
    documents: docs.rows,
    chunks: counts[0],
    vector: counts[1],
    keyword: counts[2],
    tin: counts[3],
  }
}

async function triggerNames() {
  const rows = await pg<Array<{ name: string; definition: string }>>`
    SELECT tgname AS name, pg_get_triggerdef(oid) AS definition FROM pg_trigger
    WHERE NOT tgisinternal AND tgname IN
      ('embedding_keyword_tin_sync', 'knowledge_base_keyword_tin_sync', 'embedding_keyword_tin_source_acl_set')
    ORDER BY tgname`
  return rows
}

beforeAll(async () => {
  pg = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => undefined })
  const [existing] = await pg<Array<{ present: boolean }>>`
    SELECT to_regprocedure('knowledge_tin_stream(tsvector)') IS NOT NULL AS present`
  tinFunctionsExisted = Boolean(existing?.present)
  /**
   * `0019` installs the Tin triggers only where the `tin` extension exists; their functions are
   * plain SQL and PL/pgSQL, so the triggers are installed here directly to exercise the drop.
   */
  await installProjection(pg)

  await seedKnowledgeAclFixture(ids)
  await db.insert(knowledgeBase).values({
    id: indexId,
    userId: ids.aliceId,
    organizationId: ids.organizationId,
    name: 'Dormant search fixture',
    isSearchIndex: true,
  })
  await db.insert(knowledgeConnector).values({
    id: indexConnectorId,
    knowledgeBaseId: indexId,
    connectorType: 'google_drive',
    sourceConfig: {},
    accessMode: 'admin',
    status: 'active',
    lastSyncAt: new Date(),
    listingCheckpoint: { cursor: 'fixture' },
  })
  for (let index = 0; index < DOCUMENTS; index++) {
    const documentId = `dormant-${String(index).padStart(2, '0')}-${generateId()}`
    indexDocumentIds.push(documentId)
    const key = `kb/${generateId()}.txt`
    /** Every other document has a stored object with an organization-owned binding. */
    const stored = index % 2 === 0
    if (stored) {
      const bindingId = generateId()
      bindingIds.push(bindingId)
      await db.insert(workspaceFiles).values({
        id: bindingId,
        key,
        userId: ids.aliceId,
        organizationId: ids.organizationId,
        context: 'knowledge-base',
        originalName: `${documentId}.txt`,
        contentType: 'text/plain',
        sizeBytes: 12,
      })
    }
    await db.insert(document).values({
      id: documentId,
      knowledgeBaseId: indexId,
      connectorId: indexConnectorId,
      filename: `${documentId}.txt`,
      fileUrl: stored
        ? `http://localhost:3000/api/files/serve/${key}?context=knowledge-base`
        : 'https://fixture.test/remote',
      storageKey: stored ? key : null,
      fileSize: 12,
      mimeType: 'text/plain',
      processingStatus: 'completed',
    })
    await db
      .insert(embedding)
      .values(
        Array.from({ length: CHUNKS }, (_, chunkIndex) => chunk(documentId, indexId, chunkIndex))
      )
  }
  await db.insert(document).values({
    id: workspaceDocumentId,
    knowledgeBaseId: ids.knowledgeBaseId,
    connectorId: ids.connectorId,
    filename: 'workspace.txt',
    fileUrl: 'https://fixture.test/workspace',
    fileSize: 12,
    mimeType: 'text/plain',
    processingStatus: 'completed',
  })
  await db.insert(embedding).values(chunk(workspaceDocumentId, ids.knowledgeBaseId, 0))
  /** Seeding marks documents; the deletion under test must add none. */
  await db.delete(knowledgeProjectionDirty)
}, 60_000)

afterAll(async () => {
  await db
    .delete(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, KNOWLEDGE_STORAGE_CLEANUP_EVENT),
        inArray(sql`${outboxEvent.payload}::jsonb ->> 'fileId'`, bindingIds)
      )
    )
  await db.delete(knowledgeBase).where(eq(knowledgeBase.id, indexId))
  await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  if (!tinFunctionsExisted) {
    await pg.unsafe(`DROP TRIGGER IF EXISTS embedding_keyword_tin_sync ON embedding;
      DROP TRIGGER IF EXISTS knowledge_base_keyword_tin_sync ON knowledge_base;
      DROP FUNCTION IF EXISTS sync_embedding_keyword_tin();
      DROP FUNCTION IF EXISTS sync_knowledge_base_keyword_tin();
      DROP FUNCTION IF EXISTS knowledge_tin_stream(tsvector);
      DROP FUNCTION IF EXISTS knowledge_tin_base_token(text);
      DROP FUNCTION IF EXISTS knowledge_tin_membership_key(text);`)
  }
  await pg.end()
})

describe('dormant organization search runbook in PostgreSQL', () => {
  it('drops the Tin triggers, truncates the projection, and leaves the other projections alone', async () => {
    expect(await rowsOf(indexId)).toEqual({
      documents: DOCUMENTS,
      chunks: DOCUMENTS * CHUNKS,
      vector: DOCUMENTS * CHUNKS,
      keyword: DOCUMENTS * CHUNKS,
      tin: DOCUMENTS * CHUNKS,
    })
    const database = postgresTinProjectionDatabase(pg, { retryBudgetMs: 30_000 })

    const dryRun = await disableTinProjection(database, { execute: false })
    expect(dryRun.before.triggers).toHaveLength(3)
    expect((await rowsOf(indexId)).tin).toBe(DOCUMENTS * CHUNKS)

    const result = await disableTinProjection(database, { execute: true })
    expect(result.after).toMatchObject({ triggers: [], hasRows: false })
    expect(await triggerNames()).toEqual([])
    expect(await rowsOf(indexId)).toMatchObject({ tin: 0, vector: DOCUMENTS * CHUNKS })

    /** A new chunk in the search index no longer reaches Tin. */
    const late = chunk(indexDocumentIds[0], indexId, 99)
    await db.insert(embedding).values(late)
    expect((await rowsOf(indexId)).tin).toBe(0)
    await db.delete(embedding).where(eq(embedding.id, late.id))
    await db.delete(knowledgeProjectionDirty)
  })

  it('refuses while a connector is active, and writes nothing', async () => {
    const store = drizzleSearchIndexDeletionStore(timeouts)
    await expect(
      deleteSearchIndexDocuments(store, {
        knowledgeBaseId: indexId,
        execute: true,
        requestId: 'fixture',
        sleep,
      })
    ).rejects.toBeInstanceOf(SearchIndexDeletionRefused)
    await expect(
      deleteSearchIndexDocuments(store, {
        knowledgeBaseId: ids.knowledgeBaseId,
        execute: true,
        requestId: 'fixture',
        sleep,
      })
    ).rejects.toThrow('not an organization search index')
    /** A deleting transaction re-decides the guard itself, so a resume between pages cannot race it. */
    await expect(
      store.deleteChunkBatch(indexId, indexDocumentIds.slice(0, 1), 10)
    ).rejects.toBeInstanceOf(SearchIndexDeletionRefused)
    await expect(
      store.deleteDocuments(indexId, indexDocumentIds.slice(0, 1), 'fixture', true)
    ).rejects.toBeInstanceOf(SearchIndexDeletionRefused)
    expect((await rowsOf(indexId)).documents).toBe(DOCUMENTS)
  })

  it('deletes the search index in resumable pages, queues storage cleanup, and marks nothing', async () => {
    await db
      .update(knowledgeConnector)
      .set({
        status: 'paused',
        lastSyncAt: new Date(),
        listingCheckpoint: { cursor: 'fixture' },
        directoryCheckpoint: { phase: 'complete' },
      })
      .where(eq(knowledgeConnector.id, indexConnectorId))
    const store = drizzleSearchIndexDeletionStore(timeouts)
    const options = {
      knowledgeBaseId: indexId,
      requestId: 'fixture',
      pageSize: 3,
      chunkBatchSize: 4,
      pauseMs: 0,
      sleep,
    }

    const dryRun = await deleteSearchIndexDocuments(store, {
      ...options,
      execute: false,
      maxPages: 10,
    })
    expect(dryRun).toMatchObject({ pages: 3, chunksCounted: DOCUMENTS * CHUNKS, done: true })
    expect((await rowsOf(indexId)).documents).toBe(DOCUMENTS)

    const first = await deleteSearchIndexDocuments(store, {
      ...options,
      execute: true,
      maxPages: 1,
    })
    expect(first).toMatchObject({ pages: 1, documentsDeleted: 3, done: false })
    expect((await rowsOf(indexId)).documents).toBe(DOCUMENTS - 3)
    /** A run stopped after one page already leaves the connector listing from scratch on resume. */
    const [partial] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, indexConnectorId))
    expect(partial).toMatchObject({
      lastSyncAt: null,
      listingCheckpoint: null,
      directoryCheckpoint: null,
    })

    const rest = await deleteSearchIndexDocuments(store, {
      ...options,
      execute: true,
      afterId: first.afterId,
    })
    expect(rest).toMatchObject({
      documentsDeleted: DOCUMENTS - 3,
      done: true,
      connectorsReset: { connectors: 0, members: 0 },
      standaloneDocumentsRemain: false,
      projectionMarks: { before: 0, after: 0 },
    })
    expect(first.chunksDeleted + rest.chunksDeleted).toBe(DOCUMENTS * CHUNKS)
    expect(first.storageCleanupQueued + rest.storageCleanupQueued).toBe(bindingIds.length)
    expect(await rowsOf(indexId)).toEqual({
      documents: 0,
      chunks: 0,
      vector: 0,
      keyword: 0,
      tin: 0,
    })
    expect(await rowsOf(ids.knowledgeBaseId)).toMatchObject({ documents: 1, chunks: 1 })
    const [marks] = await db.select({ rows: count() }).from(knowledgeProjectionDirty)
    expect(marks.rows).toBe(0)

    const events = await db
      .select({ payload: outboxEvent.payload })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, KNOWLEDGE_STORAGE_CLEANUP_EVENT),
          eq(outboxEvent.status, 'pending'),
          inArray(sql`${outboxEvent.payload}::jsonb ->> 'fileId'`, bindingIds)
        )
      )
    expect(
      events.map((event) => (event.payload as { organizationId: string }).organizationId)
    ).toEqual(bindingIds.map(() => ids.organizationId))

    const [connectorRow] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, indexConnectorId))
    expect(connectorRow).toMatchObject({
      status: 'paused',
      lastSyncAt: null,
      listingCheckpoint: null,
      directoryCheckpoint: null,
    })
    const [kbRow] = await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, indexId))
    expect(kbRow).toMatchObject({ isSearchIndex: true, deletedAt: null })

    const again = await deleteSearchIndexDocuments(store, { ...options, execute: true })
    expect(again).toMatchObject({ pages: 0, documentsDeleted: 0, done: true })
  })

  it('restores exactly the dropped Tin triggers, guarded, and backfills', async () => {
    const database = postgresTinProjectionDatabase(pg, { retryBudgetMs: 30_000 })
    const result = await restoreTinProjection(database, migrationTinRestoreSteps(pg), {
      execute: true,
      backfill: true,
    })
    expect(result).toMatchObject({ executed: true, backfilled: 0 })
    const triggers = await triggerNames()
    expect(triggers.map((trigger) => trigger.name)).toEqual([
      'embedding_keyword_tin_source_acl_set',
      'embedding_keyword_tin_sync',
      'knowledge_base_keyword_tin_sync',
    ])
    for (const trigger of triggers.filter(
      (row) => row.name !== 'knowledge_base_keyword_tin_sync'
    )) {
      expect(trigger.definition).toContain('sim.projection_mode')
    }

    /** A synchronous chunk write in a search index reaches Tin again. */
    const documentId = generateId()
    await db.insert(document).values({
      id: documentId,
      knowledgeBaseId: indexId,
      connectorId: indexConnectorId,
      filename: 'resumed.txt',
      fileUrl: 'https://fixture.test/resumed',
      fileSize: 12,
      mimeType: 'text/plain',
      processingStatus: 'completed',
    })
    await db.insert(embedding).values(chunk(documentId, indexId, 0))
    expect((await rowsOf(indexId)).tin).toBe(1)
  })
})
