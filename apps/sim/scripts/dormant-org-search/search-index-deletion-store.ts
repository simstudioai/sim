import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeProjectionDirty,
  outboxEvent,
} from '@sim/db/schema'
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import {
  enqueueKnowledgeStorageCleanup,
  KNOWLEDGE_STORAGE_CLEANUP_EVENT,
} from '@/lib/knowledge/documents/storage-cleanup'
import {
  evaluateDeletionGuard,
  SearchIndexDeletionRefused,
  type SearchIndexDeletionStore,
  STOPPED_CONNECTOR_STATUSES,
} from '@/scripts/dormant-org-search/search-index-deletion'

/** Bounds for one deletion transaction: short lock waits, and a cap on any one statement. */
export interface DeletionTimeouts {
  lockTimeoutMs: number
  statementTimeoutMs: number
}

async function enterBoundedTransaction(tx: DbTransaction, timeouts: DeletionTimeouts) {
  await tx.execute(
    sql`SELECT set_config('lock_timeout', ${`${timeouts.lockTimeoutMs}ms`}, true),
      set_config('statement_timeout', ${`${timeouts.statementTimeoutMs}ms`}, true)`
  )
}

/**
 * Re-decides the deletion guard inside a deleting transaction, holding the base and its
 * connectors `FOR SHARE` until commit. A resume or a sync claim updates the connector row, so it
 * waits for this page to commit and the next page's guard refuses it: no page can delete
 * documents under a sync that started after the page-level guard ran.
 */
async function lockGuard(tx: DbTransaction, knowledgeBaseId: string) {
  const [base] = await tx
    .select({
      id: knowledgeBase.id,
      isSearchIndex: knowledgeBase.isSearchIndex,
      deletedAt: knowledgeBase.deletedAt,
      workspaceId: knowledgeBase.workspaceId,
      organizationId: knowledgeBase.organizationId,
      userId: knowledgeBase.userId,
    })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, knowledgeBaseId))
    .for('share')
    .limit(1)
  const connectors = await tx
    .select({
      id: knowledgeConnector.id,
      status: knowledgeConnector.status,
      syncLockToken: knowledgeConnector.syncLockToken,
      memberSyncLockToken: knowledgeConnector.memberSyncLockToken,
      deletedAt: knowledgeConnector.deletedAt,
      detachedAt: knowledgeConnector.detachedAt,
    })
    .from(knowledgeConnector)
    .where(eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId))
    .orderBy(asc(knowledgeConnector.id))
    .for('share')
  const reasons = evaluateDeletionGuard(
    base ?? null,
    connectors.map((row) => ({
      id: row.id,
      status: row.status,
      syncLockHeld: row.syncLockToken !== null,
      memberSyncLockHeld: row.memberSyncLockToken !== null,
      deletedAt: row.deletedAt,
      detachedAt: row.detachedAt,
    }))
  )
  if (!base || reasons.length > 0) throw new SearchIndexDeletionRefused(reasons)
  return base
}

/**
 * Makes every stopped connector of the base list its sources from scratch when it resumes: the
 * same columns the app clears when a connector must list everything again (an access mode
 * switch, a source change), plus the directory checkpoint, and every member made due. Runs in
 * each deleting transaction, so a run stopped partway never leaves a connector whose cursors
 * would skip the documents already deleted; rows already reset are left alone.
 */
async function resetCursors(tx: DbTransaction, knowledgeBaseId: string, now: Date) {
  const connectors = await tx
    .update(knowledgeConnector)
    .set({
      lastSyncAt: null,
      lastSyncDocCount: null,
      listingCheckpoint: null,
      directoryCheckpoint: null,
      memberTombstoneCursor: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeConnector.detachedAt),
        inArray(knowledgeConnector.status, [...STOPPED_CONNECTOR_STATUSES]),
        isNull(knowledgeConnector.syncLockToken),
        isNull(knowledgeConnector.memberSyncLockToken),
        or(
          isNotNull(knowledgeConnector.lastSyncAt),
          isNotNull(knowledgeConnector.lastSyncDocCount),
          isNotNull(knowledgeConnector.listingCheckpoint),
          isNotNull(knowledgeConnector.directoryCheckpoint),
          isNotNull(knowledgeConnector.memberTombstoneCursor)
        )
      )
    )
    .returning({ id: knowledgeConnector.id })
  const stopped = tx
    .select({ id: knowledgeConnector.id })
    .from(knowledgeConnector)
    .where(
      and(
        eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeConnector.detachedAt),
        inArray(knowledgeConnector.status, [...STOPPED_CONNECTOR_STATUSES])
      )
    )
  const members = await tx
    .update(knowledgeConnectorMember)
    .set({
      listingCheckpoint: null,
      changeCursor: null,
      memberSyncedThrough: null,
      lastCompleteListingAt: null,
      lastListedCount: null,
      nextAttemptAt: null,
      updatedAt: now,
    })
    .where(
      and(
        inArray(knowledgeConnectorMember.connectorId, stopped),
        or(
          isNotNull(knowledgeConnectorMember.listingCheckpoint),
          isNotNull(knowledgeConnectorMember.changeCursor),
          isNotNull(knowledgeConnectorMember.memberSyncedThrough),
          isNotNull(knowledgeConnectorMember.lastCompleteListingAt),
          isNotNull(knowledgeConnectorMember.lastListedCount),
          isNotNull(knowledgeConnectorMember.nextAttemptAt)
        )
      )
    )
    .returning({ id: knowledgeConnectorMember.id })
  return { connectors: connectors.length, members: members.length }
}

/**
 * The deletion store on the app's database client, so storage cleanup intents are queued by the
 * app's own `enqueueKnowledgeStorageCleanup` in the deleting transaction, and deleted by the app's
 * outbox worker with its ownership, content-version and reference checks.
 */
export function drizzleSearchIndexDeletionStore(
  timeouts: DeletionTimeouts
): SearchIndexDeletionStore {
  return {
    async loadKnowledgeBase(knowledgeBaseId) {
      const [row] = await db
        .select({
          id: knowledgeBase.id,
          isSearchIndex: knowledgeBase.isSearchIndex,
          organizationId: knowledgeBase.organizationId,
          deletedAt: knowledgeBase.deletedAt,
        })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, knowledgeBaseId))
        .limit(1)
      return row ?? null
    },

    async listConnectors(knowledgeBaseId) {
      const rows = await db
        .select({
          id: knowledgeConnector.id,
          status: knowledgeConnector.status,
          syncLockToken: knowledgeConnector.syncLockToken,
          memberSyncLockToken: knowledgeConnector.memberSyncLockToken,
          deletedAt: knowledgeConnector.deletedAt,
          detachedAt: knowledgeConnector.detachedAt,
        })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId))
        .orderBy(asc(knowledgeConnector.id))
      return rows.map((row) => ({
        id: row.id,
        status: row.status,
        syncLockHeld: row.syncLockToken !== null,
        memberSyncLockHeld: row.memberSyncLockToken !== null,
        deletedAt: row.deletedAt,
        detachedAt: row.detachedAt,
      }))
    },

    async nextDocumentPage(knowledgeBaseId, afterId, limit) {
      const rows = await db
        .select({ id: document.id })
        .from(document)
        .where(
          and(
            eq(document.knowledgeBaseId, knowledgeBaseId),
            isNotNull(document.connectorId),
            gt(document.id, afterId)
          )
        )
        .orderBy(asc(document.id))
        .limit(limit)
      return rows.map((row) => row.id)
    },

    async countChunks(documentIds) {
      const [row] = await db
        .select({ chunks: count() })
        .from(embedding)
        .where(inArray(embedding.documentId, [...documentIds]))
      return Number(row?.chunks ?? 0)
    },

    async deleteChunkBatch(knowledgeBaseId, documentIds, limit) {
      return db.transaction(async (tx) => {
        await enterBoundedTransaction(tx, timeouts)
        await lockGuard(tx, knowledgeBaseId)
        /**
         * Only chunks of documents the connectors still own: a document detachment converted to a
         * standalone upload after the page was read keeps its chunks, and the page skips it.
         */
        const owned = tx
          .select({ id: document.id })
          .from(document)
          .where(
            and(
              inArray(document.id, [...documentIds]),
              eq(document.knowledgeBaseId, knowledgeBaseId),
              isNotNull(document.connectorId)
            )
          )
        const batch = tx
          .select({ id: embedding.id })
          .from(embedding)
          .where(inArray(embedding.documentId, owned))
          .limit(limit)
        const deleted = await tx
          .delete(embedding)
          .where(inArray(embedding.id, batch))
          .returning({ id: embedding.id })
        return deleted.length
      })
    },

    async deleteDocuments(knowledgeBaseId, documentIds, requestId, resetConnectors) {
      return db.transaction(async (tx) => {
        await enterBoundedTransaction(tx, timeouts)
        const owner = await lockGuard(tx, knowledgeBaseId)
        /** Locks the documents against a late indexing commit between the chunk check and the delete. */
        const docs = await tx
          .select({ id: document.id, fileUrl: document.fileUrl })
          .from(document)
          .where(
            and(
              inArray(document.id, [...documentIds]),
              eq(document.knowledgeBaseId, knowledgeBaseId),
              isNotNull(document.connectorId)
            )
          )
          .orderBy(asc(document.id))
          .for('update')
        if (docs.length === 0) {
          return { kind: 'deleted', deleted: 0, storageCleanupQueued: 0 } as const
        }
        const ids = docs.map((doc) => doc.id)
        const [remaining] = await tx
          .select({ id: embedding.id })
          .from(embedding)
          .where(inArray(embedding.documentId, ids))
          .limit(1)
        if (remaining) return { kind: 'chunks-remain' } as const
        const queued = await enqueueKnowledgeStorageCleanup(
          tx,
          docs.map((doc) => ({
            ...doc,
            workspaceId: owner.workspaceId,
            organizationId: owner.organizationId,
            userId: owner.userId,
          })),
          requestId
        )
        const deleted = await tx
          .delete(document)
          .where(inArray(document.id, ids))
          .returning({ id: document.id })
        if (resetConnectors) await resetCursors(tx, knowledgeBaseId, new Date())
        return {
          kind: 'deleted',
          deleted: deleted.length,
          storageCleanupQueued: queued.length,
        } as const
      })
    },

    async pendingStorageCleanup(cap) {
      const pending = db
        .select({ one: sql`1` })
        .from(outboxEvent)
        .where(
          and(
            eq(outboxEvent.status, 'pending'),
            eq(outboxEvent.eventType, KNOWLEDGE_STORAGE_CLEANUP_EVENT)
          )
        )
        .limit(cap)
        .as('pending')
      const [row] = await db.select({ pending: count() }).from(pending)
      return Number(row?.pending ?? 0)
    },

    async projectionMarkCount() {
      const [row] = await db.select({ marks: count() }).from(knowledgeProjectionDirty)
      return Number(row?.marks ?? 0)
    },

    async hasConnectorDocuments(knowledgeBaseId) {
      const [row] = await db
        .select({ id: document.id })
        .from(document)
        .where(and(eq(document.knowledgeBaseId, knowledgeBaseId), isNotNull(document.connectorId)))
        .limit(1)
      return Boolean(row)
    },

    async hasStandaloneDocuments(knowledgeBaseId) {
      const [row] = await db
        .select({ id: document.id })
        .from(document)
        .where(and(eq(document.knowledgeBaseId, knowledgeBaseId), isNull(document.connectorId)))
        .limit(1)
      return Boolean(row)
    },

    async resetConnectorCursors(knowledgeBaseId) {
      return db.transaction(async (tx) => {
        await enterBoundedTransaction(tx, timeouts)
        return resetCursors(tx, knowledgeBaseId, new Date())
      })
    },
  }
}
