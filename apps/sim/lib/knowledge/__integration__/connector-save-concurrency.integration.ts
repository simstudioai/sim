/** Real PostgreSQL lock compatibility through the connector persistence entry points. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  organization,
  outboxEvent,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbTransaction } from '@/lib/db/types'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { stillHoldsSyncLock } from '@/lib/knowledge/connectors/sync-lock'
import {
  addDocument,
  persistSkippedDocuments,
  persistSkippedRetryHashes,
  persistSourceDocumentFailures,
  updateDocument,
} from '@/lib/knowledge/connectors/sync-persistence'
import { deleteKnowledgeBase } from '@/lib/knowledge/service'
import type { ExternalDocument } from '@/connectors/types'

const WAIT_OPTIONS = { interval: 1, timeout: 5000 }
const SAVE_KINDS = ['add', 'update', 'skip', 'retry hash', 'source failure'] as const
type SaveKind = (typeof SAVE_KINDS)[number]

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

/** Pause only after the real transaction callback has finished all its writes, before commit. */
function holdTransactions(...predicates: Array<(tx: DbTransaction) => Promise<boolean>>) {
  const gates = predicates.map((matches) => ({
    matches,
    pid: undefined as number | undefined,
    release: deferred(),
  }))
  const transaction = db.transaction.bind(db)
  vi.spyOn(db, 'transaction').mockImplementation((callback, config) =>
    transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`)
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '15s'`)
      const result = await callback(tx)
      for (const gate of gates) {
        if (gate.pid !== undefined || !(await gate.matches(tx))) continue
        const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        gate.pid = backend.pid
        await gate.release.promise
      }
      return result
    }, config)
  )
  return gates
}

async function blockedBackend(blockingPid: number) {
  const [row] = await db.execute<{ pid: number; query: string }>(sql`
    SELECT pid, query FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
      AND ${blockingPid} = ANY(pg_blocking_pids(pid))
    LIMIT 1
  `)
  return row
}

describe('independent connector saves in one knowledge base', () => {
  let ids: ReturnType<typeof createKnowledgeAclFixtureIds>

  beforeAll(() => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-connector-concurrency-'))
  })
  beforeEach(async () => {
    ids = createKnowledgeAclFixtureIds()
    await seedKnowledgeAclFixture(ids)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await db
      .delete(outboxEvent)
      .where(sql`${outboxEvent.payload}->>'workspaceId' = ${ids.workspaceId}`)
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  })
  afterAll(async () => {
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await db.$client.end()
  })

  async function source(kind: SaveKind) {
    const item = {
      documentId: generateId(),
      extDoc: {
        externalId: generateId(),
        title: 'Concurrent source',
        content: 'New source content',
        mimeType: 'text/plain',
        contentHash: generateId(),
        skippedReason: 'Source intentionally excluded',
      } satisfies ExternalDocument,
    }
    if (kind !== 'add') {
      await db.insert(document).values({
        id: item.documentId,
        knowledgeBaseId: ids.knowledgeBaseId,
        connectorId: ids.connectorId,
        externalId: item.extDoc.externalId,
        filename: 'Old source',
        fileUrl: 'data:text/plain,old',
        fileSize: 3,
        mimeType: 'text/plain',
        contentHash: 'old-content',
        processingStatus: 'completed',
      })
    }
    return item
  }

  function save(kind: SaveKind, item: Awaited<ReturnType<typeof source>>) {
    const lease = { stillHeld: () => stillHoldsSyncLock(ids.connectorId, ids.lockId) }
    const args = [
      ids.knowledgeBaseId,
      ids.connectorId,
      'confluence',
      item.extDoc,
      { workspaceId: ids.workspaceId, userId: ids.aliceId },
      undefined,
      'workspace',
      lease,
    ] as const
    switch (kind) {
      case 'add':
        return addDocument(...args)
      case 'update':
        return updateDocument(item.documentId, ...args)
      case 'skip':
        return persistSkippedDocuments(
          ids.knowledgeBaseId,
          ids.connectorId,
          'confluence',
          [{ type: 'skip', existingId: item.documentId, extDoc: item.extDoc }],
          undefined,
          'workspace',
          lease
        )
      case 'retry hash':
        return persistSkippedRetryHashes(
          ids.knowledgeBaseId,
          ids.connectorId,
          [{ existingId: item.documentId, ...item.extDoc }],
          lease
        )
      case 'source failure':
        return persistSourceDocumentFailures({
          knowledgeBaseId: ids.knowledgeBaseId,
          connectorId: ids.connectorId,
          connectorType: 'confluence',
          documents: [item.extDoc],
          failedExternalIds: new Set([item.extDoc.externalId]),
          priorByExternalId: new Map([[item.extDoc.externalId, { id: item.documentId }]]),
          sourceConfig: {},
          access: 'workspace',
          lease,
        })
    }
  }

  function wrote(kind: SaveKind, item: Awaited<ReturnType<typeof source>>) {
    return async (tx: DbTransaction) => {
      const rows = await tx
        .select({ id: document.id })
        .from(document)
        .where(
          and(
            eq(document.connectorId, ids.connectorId),
            eq(document.externalId, item.extDoc.externalId),
            kind === 'source failure'
              ? isNull(document.contentHash)
              : eq(document.contentHash, item.extDoc.contentHash)
          )
        )
      return rows.length === 1
    }
  }

  it.each(SAVE_KINDS)(
    '%s reaches writes for different documents before either commits',
    async (kind) => {
      const first = await source(kind)
      const second = await source(kind)
      const gates = holdTransactions(wrote(kind, first), wrote(kind, second))
      const firstResult = Promise.allSettled([save(kind, first)])
      let secondResult: ReturnType<typeof Promise.allSettled> | undefined
      try {
        await expect.poll(() => gates[0].pid, WAIT_OPTIONS).toBeDefined()
        secondResult = Promise.allSettled([save(kind, second)])
        await expect.poll(() => gates[1].pid, WAIT_OPTIONS).toBeDefined()
        expect(gates[0].pid).not.toBe(gates[1].pid)
        const committed = await db
          .select({ contentHash: document.contentHash })
          .from(document)
          .where(eq(document.connectorId, ids.connectorId))
        expect(committed).toEqual(
          kind === 'add' ? [] : [{ contentHash: 'old-content' }, { contentHash: 'old-content' }]
        )
        for (const gate of gates) gate.release.resolve()
        expect(await firstResult).toMatchObject([{ status: 'fulfilled' }])
        expect(await secondResult).toMatchObject([{ status: 'fulfilled' }])
      } finally {
        for (const gate of gates) gate.release.resolve()
        await firstResult
        await secondResult
      }
    }
  )

  it.each(['add', 'update'] as const)(
    'deletion waits for an in-flight %s and archives its committed document',
    async (kind) => {
      const item = await source(kind)
      const [gate] = holdTransactions(wrote(kind, item))
      const saved = Promise.allSettled([save(kind, item)])
      let deleted: Promise<PromiseSettledResult<void>[]> | undefined
      try {
        await expect.poll(() => gate.pid, WAIT_OPTIONS).toBeDefined()
        deleted = Promise.allSettled([
          deleteKnowledgeBase(ids.knowledgeBaseId, 'concurrent-delete'),
        ])
        await expect.poll(() => blockedBackend(gate.pid!), WAIT_OPTIONS).toBeDefined()
        const [active] = await db
          .select()
          .from(knowledgeBase)
          .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
        expect(active.deletedAt).toBeNull()
        gate.release.resolve()
        expect(await saved).toMatchObject([{ status: 'fulfilled' }])
        expect(await deleted).toMatchObject([{ status: 'fulfilled' }])
        const [row] = await db
          .select()
          .from(document)
          .where(eq(document.externalId, item.extDoc.externalId))
        expect(row.archivedAt).toBeInstanceOf(Date)
        expect(row.contentHash).toBe(item.extDoc.contentHash)
      } finally {
        gate.release.resolve()
        await saved
        await deleted
      }
    }
  )

  it('rejects a save that waits behind a deletion which commits first', async () => {
    const item = await source('add')
    const [gate] = holdTransactions(async (tx) => {
      const rows = await tx
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.id, ids.knowledgeBaseId), isNotNull(knowledgeBase.deletedAt)))
      return rows.length === 1
    })
    const deleted = Promise.allSettled([deleteKnowledgeBase(ids.knowledgeBaseId, 'delete-first')])
    let saved: ReturnType<typeof Promise.allSettled> | undefined
    try {
      await expect.poll(() => gate.pid, WAIT_OPTIONS).toBeDefined()
      saved = Promise.allSettled([save('add', item)])
      await expect.poll(() => blockedBackend(gate.pid!), WAIT_OPTIONS).toBeDefined()
      gate.release.resolve()
      expect(await deleted).toMatchObject([{ status: 'fulfilled' }])
      expect(await saved).toMatchObject([
        {
          status: 'rejected',
          reason: { message: `Knowledge base ${ids.knowledgeBaseId} is deleted` },
        },
      ])
      expect(
        await db.select().from(document).where(eq(document.externalId, item.extDoc.externalId))
      ).toEqual([])
      const guards = await db
        .select({ status: outboxEvent.status })
        .from(outboxEvent)
        .where(sql`${outboxEvent.payload}->>'workspaceId' = ${ids.workspaceId}`)
      expect(guards).toEqual([{ status: 'pending' }])
    } finally {
      gate.release.resolve()
      await deleted
      await saved
    }
  })

  it('serializes same-document updates at the document lock while another document saves', async () => {
    const first = await source('update')
    const second = { ...first, extDoc: { ...first.extDoc, contentHash: generateId() } }
    const independent = await source('update')
    const [gate] = holdTransactions(wrote('update', first))
    const firstResult = Promise.allSettled([save('update', first)])
    let secondResult: ReturnType<typeof Promise.allSettled> | undefined
    try {
      await expect.poll(() => gate.pid, WAIT_OPTIONS).toBeDefined()
      secondResult = Promise.allSettled([save('update', second)])
      await expect
        .poll(() => blockedBackend(gate.pid!), WAIT_OPTIONS)
        .toMatchObject({
          query: expect.stringMatching(/from "document".*for update/i),
        })
      await save('update', independent)
      gate.release.resolve()
      expect(await firstResult).toMatchObject([{ status: 'fulfilled' }])
      expect(await secondResult).toMatchObject([{ status: 'fulfilled' }])
      const [row] = await db.select().from(document).where(eq(document.id, first.documentId))
      expect(row.contentHash).toBe(second.extDoc.contentHash)
    } finally {
      gate.release.resolve()
      await firstResult
      await secondResult
    }
  })

  it('holds the connector lease until commit and rejects writes from the reclaimed lease', async () => {
    const item = await source('add')
    const [gate] = holdTransactions(wrote('add', item))
    const saved = Promise.allSettled([save('add', item)])
    let reclaimed: ReturnType<typeof Promise.allSettled> | undefined
    try {
      await expect.poll(() => gate.pid, WAIT_OPTIONS).toBeDefined()
      reclaimed = Promise.allSettled([
        db.transaction(async (tx) => {
          await tx
            .update(knowledgeConnector)
            .set({ syncLockToken: generateId() })
            .where(eq(knowledgeConnector.id, ids.connectorId))
        }),
      ])
      await expect
        .poll(() => blockedBackend(gate.pid!), WAIT_OPTIONS)
        .toMatchObject({
          query: expect.stringMatching(/update "knowledge_connector"/i),
        })
      gate.release.resolve()
      expect(await saved).toMatchObject([{ status: 'fulfilled' }])
      expect(await reclaimed).toMatchObject([{ status: 'fulfilled' }])
      const stale = await source('add')
      await expect(save('add', stale)).rejects.toThrow(
        `Sync lock for connector ${ids.connectorId} was reclaimed during sync`
      )
      expect(
        await db.select().from(document).where(eq(document.externalId, stale.extDoc.externalId))
      ).toEqual([])
    } finally {
      gate.release.resolve()
      await saved
      await reclaimed
    }
  })

  it('allows an embedding FK check while a save waits on its document lock', async () => {
    const item = await source('update')
    holdTransactions()
    const publish = deferred()
    let processingPid: number | undefined
    const processing = db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`)
      await tx
        .select({ id: document.id })
        .from(document)
        .where(eq(document.id, item.documentId))
        .for('update')
      const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      processingPid = backend.pid
      await publish.promise
      await tx.insert(embedding).values({
        id: generateId(),
        knowledgeBaseId: ids.knowledgeBaseId,
        documentId: item.documentId,
        chunkIndex: 0,
        chunkHash: 'fixture',
        content: 'fixture',
        contentLength: 7,
        tokenCount: 1,
        startOffset: 0,
        endOffset: 7,
        embedding: Array.from({ length: 1536 }, () => 0.01),
      })
    })
    const processed = Promise.allSettled([processing])
    let saved: ReturnType<typeof Promise.allSettled> | undefined
    try {
      await expect.poll(() => processingPid, WAIT_OPTIONS).toBeDefined()
      saved = Promise.allSettled([save('update', item)])
      await expect
        .poll(() => blockedBackend(processingPid!), WAIT_OPTIONS)
        .toMatchObject({
          query: expect.stringMatching(/from "document".*for update/i),
        })
      publish.resolve()
      expect(await processed).toMatchObject([{ status: 'fulfilled' }])
      expect(await saved).toMatchObject([{ status: 'fulfilled' }])
      expect(
        await db
          .select({ id: embedding.id })
          .from(embedding)
          .where(eq(embedding.documentId, item.documentId))
      ).toHaveLength(1)
    } finally {
      publish.resolve()
      await processed
      await saved
    }
  })
})
