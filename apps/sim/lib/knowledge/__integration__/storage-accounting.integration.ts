/** Real PostgreSQL coverage for storage ownership changes and document lifecycle accounting. */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { db } from '@sim/db'
import {
  document,
  embedding,
  embeddingSearch,
  knowledgeBase,
  knowledgeConnector,
  organization,
  outboxEvent,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { drainConnectorEvent } from '@/lib/knowledge/__integration__/drain-connector-event'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { WORKSPACE_ACCESS_SCOPE } from '@/lib/knowledge/access/scope'
import { SYSTEM_ACCESS_SCOPE } from '@/lib/knowledge/access/types'
import { KNOWLEDGE_CONNECTOR_CLEANUP_EVENT } from '@/lib/knowledge/connectors/deletion'
import { KNOWLEDGE_CONNECTOR_DETACH_EVENT } from '@/lib/knowledge/connectors/detachment'
import { createContentSyncLease, SyncLockLostException } from '@/lib/knowledge/connectors/sync-lock'
import { persistSkippedDocuments } from '@/lib/knowledge/connectors/sync-persistence'
import {
  createSingleDocument,
  getKnowledgeDocument,
  hardDeleteDocuments,
} from '@/lib/knowledge/documents/service'
import { performDeleteKnowledgeConnector } from '@/lib/knowledge/orchestration/connectors'

type Fixture = ReturnType<typeof createKnowledgeAclFixtureIds>
const fixtures: Fixture[] = []

async function seed() {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  await seedKnowledgeAclFixture(ids)
  await db
    .update(knowledgeConnector)
    .set({ accessMode: 'workspace' })
    .where(eq(knowledgeConnector.id, ids.connectorId))
  return ids
}

async function manualDocument(ids: Fixture, bytes: number) {
  return createSingleDocument(
    {
      filename: 'manual.txt',
      fileUrl: `data:text/plain;base64,${Buffer.alloc(bytes, 'a').toString('base64')}`,
      fileSize: bytes,
      mimeType: 'text/plain',
    },
    ids.knowledgeBaseId,
    generateId(),
    ids.aliceId
  )
}

function sourceDocument(
  ids: Fixture,
  bytes: number,
  extra: Partial<typeof document.$inferInsert> = {}
) {
  return {
    id: generateId(),
    knowledgeBaseId: ids.knowledgeBaseId,
    connectorId: ids.connectorId,
    filename: 'source.txt',
    fileUrl: 'data:text/plain;base64,c291cmNl',
    fileSize: bytes,
    mimeType: 'text/plain',
    ...extra,
  }
}

async function ledger(ids: Fixture) {
  const [row] = await db
    .select({
      workspaceBytes: workspace.storageUsedBytes,
      payerBytes: organization.storageUsedBytes,
    })
    .from(workspace)
    .innerJoin(organization, eq(organization.id, workspace.organizationId))
    .where(eq(workspace.id, ids.workspaceId))
  return row
}

function disconnect(ids: Fixture, deleteDocuments = false) {
  return performDeleteKnowledgeConnector({
    knowledgeBase: { id: ids.knowledgeBaseId, name: 'Fixture', workspaceId: ids.workspaceId },
    connectorId: ids.connectorId,
    deleteDocuments,
    userId: ids.aliceId,
    source: 'api',
    requestId: generateId(),
    recordSemanticAudit: false,
    recordProductAnalytics: false,
  })
}

/** Removes the source keeping its documents, then runs the background release to completion. */
async function detach(ids: Fixture) {
  const outcome = await disconnect(ids)
  if (outcome.success) await drainConnectorEvent(ids.connectorId, KNOWLEDGE_CONNECTOR_DETACH_EVENT)
  return outcome
}

afterAll(async () => {
  for (const ids of fixtures) {
    await db
      .delete(outboxEvent)
      .where(
        and(
          inArray(outboxEvent.eventType, [
            KNOWLEDGE_CONNECTOR_CLEANUP_EVENT,
            KNOWLEDGE_CONNECTOR_DETACH_EVENT,
          ]),
          sql`${outboxEvent.payload}->>'knowledgeBaseId' = ${ids.knowledgeBaseId}`
        )
      )
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  }
  await db.$client.end()
})

describe('knowledge document storage ledgers', () => {
  it('debits the real payer when source detachment commits after the deletion snapshot', async () => {
    const ids = await seed()
    const source = sourceDocument(ids, 37)
    await db.insert(document).values(source)
    const transaction = db.transaction.bind(db)
    /** Interleave real operations at the lock boundary; every query and commit still uses PostgreSQL. */
    const detachBeforeLock: typeof db.transaction = async (callback, config) => {
      expect(await detach(ids)).toMatchObject({ success: true })
      expect(await ledger(ids)).toEqual({ workspaceBytes: 37, payerBytes: 37 })
      return transaction(callback, config)
    }
    const scheduled = vi.spyOn(db, 'transaction').mockImplementationOnce(detachBeforeLock)
    try {
      await expect(hardDeleteDocuments([source.id], generateId())).resolves.toBe(1)
    } finally {
      scheduled.mockRestore()
    }
    expect(await ledger(ids)).toEqual({ workspaceBytes: 0, payerBytes: 0 })
  })

  it('charges retained source documents exactly once under concurrent detachment and deletion', async () => {
    const ids = await seed()
    const manual = await manualDocument(ids, 29)
    const now = new Date()
    const source = [
      sourceDocument(ids, 11),
      sourceDocument(ids, 0, { processingStatus: 'failed' }),
      sourceDocument(ids, 13, { deletedAt: now }),
      sourceDocument(ids, 17, { archivedAt: now }),
      sourceDocument(ids, 19, { archivedAt: now, deletedAt: now }),
      sourceDocument(ids, 2_000_000_000, {
        fileUrl: '',
        storageKey: null,
        processingStatus: 'failed',
      }),
    ]
    await db.insert(document).values(source)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 29, payerBytes: 29 })

    const outcomes = await Promise.all([disconnect(ids), disconnect(ids)])
    expect(outcomes.filter((result) => result.success)).toEqual([
      { success: true, documentsKept: 6, documentsDeleted: 0 },
    ])
    expect(outcomes.filter((result) => !result.success)).toHaveLength(1)
    /** Detached documents stay attached, readable, and unbilled until the release runs. */
    expect(await ledger(ids)).toEqual({ workspaceBytes: 29, payerBytes: 29 })
    expect(
      await getKnowledgeDocument(ids.knowledgeBaseId, source[0].id, WORKSPACE_ACCESS_SCOPE)
    ).not.toBeNull()
    await drainConnectorEvent(ids.connectorId, KNOWLEDGE_CONNECTOR_DETACH_EVENT)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 70, payerBytes: 70 })
    expect(
      await db
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
    ).toHaveLength(0)
    const retained = await db
      .select({ id: document.id, connectorId: document.connectorId, deletedAt: document.deletedAt })
      .from(document)
      .where(
        inArray(
          document.id,
          source.map((row) => row.id)
        )
      )
    expect(retained.every((row) => row.connectorId === null)).toBe(true)
    expect(retained.find((row) => row.id === source[2].id)?.deletedAt).toBeNull()
    expect(retained.find((row) => row.id === source[4].id)?.deletedAt).not.toBeNull()

    const removed = await Promise.all([
      hardDeleteDocuments(
        source.map((row) => row.id),
        generateId()
      ),
      hardDeleteDocuments(
        source.map((row) => row.id),
        generateId()
      ),
    ])
    expect(removed.reduce((sum, count) => sum + count, 0)).toBe(6)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 29, payerBytes: 29 })
    expect(await hardDeleteDocuments([manual.id], generateId())).toBe(1)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 0, payerBytes: 0 })
  })

  it('releases a document larger than one page without a search row still naming its source', async () => {
    const ids = await seed()
    const row = sourceDocument(ids, 5)
    await db.insert(document).values(row)
    await db.insert(embedding).values(
      Array.from({ length: 600 }, (_, chunkIndex) => ({
        id: generateId(),
        knowledgeBaseId: ids.knowledgeBaseId,
        documentId: row.id,
        chunkIndex,
        chunkHash: `hash-${chunkIndex}`,
        content: 'test chunk',
        contentLength: 10,
        tokenCount: 2,
        startOffset: 0,
        endOffset: 10,
        embedding384: Array(384).fill(0.1),
      }))
    )
    const sourceRows = () =>
      db
        .select({ count: sql<number>`COUNT(*)::integer` })
        .from(embeddingSearch)
        .where(and(eq(embeddingSearch.documentId, row.id), isNotNull(embeddingSearch.connectorId)))
    expect((await sourceRows())[0].count).toBe(600)

    expect(await detach(ids)).toEqual({ success: true, documentsKept: 1, documentsDeleted: 0 })

    expect((await sourceRows())[0].count).toBe(0)
    const [released] = await db
      .select({ connectorId: document.connectorId })
      .from(document)
      .where(eq(document.id, row.id))
    expect(released.connectorId).toBeNull()
    expect(await ledger(ids)).toEqual({ workspaceBytes: 5, payerBytes: 5 })
  })

  it('hides a source immediately and cleans bounded batches without debiting manual storage', async () => {
    const ids = await seed()
    await manualDocument(ids, 31)
    const rows = Array.from({ length: 501 }, (_, index) =>
      sourceDocument(ids, index + 1, index % 2 ? { archivedAt: new Date() } : {})
    )
    await db.insert(document).values(rows)
    await db.insert(embedding).values(
      Array.from({ length: 1_001 }, (_, chunkIndex) => ({
        id: generateId(),
        knowledgeBaseId: ids.knowledgeBaseId,
        documentId: rows[0].id,
        chunkIndex,
        chunkHash: `hash-${chunkIndex}`,
        content: 'test chunk',
        contentLength: 10,
        tokenCount: 2,
        startOffset: 0,
        endOffset: 10,
        embedding384: Array(384).fill(0.1),
      }))
    )

    expect(await disconnect(ids, true)).toEqual({
      success: true,
      documentsKept: 0,
      documentsDeleted: 501,
    })
    const [tombstone] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, ids.connectorId))
    expect(tombstone.deletedAt).toBeInstanceOf(Date)
    expect(tombstone.status).toBe('disabled')
    expect(tombstone.syncLockToken).toBeNull()
    const [retained] = await db
      .select({ count: sql<number>`COUNT(*)::integer` })
      .from(document)
      .where(eq(document.connectorId, ids.connectorId))
    expect(retained.count).toBe(501)
    for (const access of [SYSTEM_ACCESS_SCOPE, WORKSPACE_ACCESS_SCOPE]) {
      expect(await getKnowledgeDocument(ids.knowledgeBaseId, rows[0].id, access)).toBeNull()
    }
    await expect(
      persistSkippedDocuments(
        ids.knowledgeBaseId,
        ids.connectorId,
        'confluence',
        [
          {
            type: 'skip',
            extDoc: {
              externalId: generateId(),
              title: 'Late source write',
              content: '',
              mimeType: 'text/plain',
              contentHash: 'late-source',
              skippedReason: 'Too large',
            },
          },
        ],
        undefined,
        'workspace',
        createContentSyncLease(ids.connectorId, ids.lockId)
      )
    ).rejects.toBeInstanceOf(SyncLockLostException)
    await drainConnectorEvent(ids.connectorId, KNOWLEDGE_CONNECTOR_CLEANUP_EVENT)
    expect(
      await db
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
    ).toHaveLength(0)
    const [remaining] = await db
      .select({ count: sql<number>`COUNT(*)::integer` })
      .from(document)
      .where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))
    expect(remaining.count).toBe(1)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 31, payerBytes: 31 })
  })

  it('rolls back both the source tombstone and cleanup intent on a failed commit', async () => {
    const ids = await seed()
    const row = sourceDocument(ids, 10)
    await db.insert(document).values(row)
    const transaction = db.transaction.bind(db)
    const failure = vi.spyOn(db, 'transaction').mockImplementationOnce((callback, config) =>
      transaction(async (tx) => {
        await callback(tx)
        throw new Error('Removal transaction failed')
      }, config)
    )
    try {
      expect(await disconnect(ids, true)).toMatchObject({ success: false })
    } finally {
      failure.mockRestore()
    }
    const [source] = await db
      .select({ deletedAt: knowledgeConnector.deletedAt })
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, ids.connectorId))
    expect(source.deletedAt).toBeNull()
    expect(
      await getKnowledgeDocument(ids.knowledgeBaseId, row.id, WORKSPACE_ACCESS_SCOPE)
    ).not.toBeNull()
    const events = await db
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, KNOWLEDGE_CONNECTOR_CLEANUP_EVENT),
          sql`${outboxEvent.payload}->>'connectorId' = ${ids.connectorId}`
        )
      )
    expect(events).toHaveLength(0)
  })

  it('keeps the source and every document attached when detachment exceeds the quota', async () => {
    const ids = await seed()
    const rows = [sourceDocument(ids, 800_000_000), sourceDocument(ids, 800_000_000)]
    await db.insert(document).values(rows)
    const previous = process.env.FREE_STORAGE_LIMIT_GB
    process.env.FREE_STORAGE_LIMIT_GB = '1'
    try {
      expect(await disconnect(ids)).toMatchObject({
        success: false,
        errorCode: 'payload_too_large',
      })
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, 'FREE_STORAGE_LIMIT_GB')
      else process.env.FREE_STORAGE_LIMIT_GB = previous
    }
    const remaining = await db
      .select({ id: document.id })
      .from(document)
      .where(and(eq(document.connectorId, ids.connectorId), isNull(document.deletedAt)))
    expect(remaining).toHaveLength(2)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 0, payerBytes: 0 })
    expect(
      await db
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
    ).toHaveLength(1)
  })

  it('repairs historical missing charges with the bounded post-deploy reconciliation command', async () => {
    const ids = await seed()
    const manual = await manualDocument(ids, 43)
    await db.update(workspace).set({ storageUsedBytes: 0 }).where(eq(workspace.id, ids.workspaceId))
    await db
      .update(organization)
      .set({ storageUsedBytes: 0 })
      .where(eq(organization.id, ids.organizationId))
    const script = path.resolve(
      process.cwd(),
      '../../packages/db/scripts/reconcile-workspace-storage.ts'
    )
    const run = promisify(execFile)
    const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL
    if (!databaseUrl) throw new Error('Missing isolated reconciliation database')
    for (let attempt = 0; attempt < 2; attempt++) {
      await run('bun', [script], {
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: databaseUrl,
          WORKSPACE_STORAGE_RECONCILE_ACK: 'old-apps-drained',
        },
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      })
      expect(await ledger(ids)).toEqual({ workspaceBytes: 43, payerBytes: 43 })
    }
    expect(await hardDeleteDocuments([manual.id], generateId())).toBe(1)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 0, payerBytes: 0 })
  })

  it('serializes ordinary uploads against source detachment without losing either charge', async () => {
    const ids = await seed()
    await db.insert(document).values([sourceDocument(ids, 37)])
    const [detached, manual] = await Promise.all([detach(ids), manualDocument(ids, 41)])
    expect(detached).toMatchObject({ success: true })
    expect(await ledger(ids)).toEqual({ workspaceBytes: 78, payerBytes: 78 })
    const [source] = await db
      .select({ id: document.id })
      .from(document)
      .where(
        and(eq(document.knowledgeBaseId, ids.knowledgeBaseId), eq(document.filename, 'source.txt'))
      )
    const counts = await Promise.all([
      hardDeleteDocuments([manual.id], generateId()),
      hardDeleteDocuments([source.id], generateId()),
    ])
    expect(counts).toEqual([1, 1])
    expect(await ledger(ids)).toEqual({ workspaceBytes: 0, payerBytes: 0 })
  })
})
