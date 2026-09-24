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
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import {
  enqueueKnowledgeStorageCleanup,
  KNOWLEDGE_STORAGE_CLEANUP_EVENT,
} from '@/lib/knowledge/documents/storage-cleanup'
import {
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

    async deleteChunkBatch(documentIds, limit) {
      return db.transaction(async (tx) => {
        await enterBoundedTransaction(tx, timeouts)
        const batch = tx
          .select({ id: embedding.id })
          .from(embedding)
          .where(inArray(embedding.documentId, [...documentIds]))
          .limit(limit)
        const deleted = await tx
          .delete(embedding)
          .where(inArray(embedding.id, batch))
          .returning({ id: embedding.id })
        return deleted.length
      })
    },

    async deleteDocuments(knowledgeBaseId, documentIds, requestId) {
      return db.transaction(async (tx) => {
        await enterBoundedTransaction(tx, timeouts)
        const [owner] = await tx
          .select({
            workspaceId: knowledgeBase.workspaceId,
            organizationId: knowledgeBase.organizationId,
            userId: knowledgeBase.userId,
            isSearchIndex: knowledgeBase.isSearchIndex,
          })
          .from(knowledgeBase)
          .where(eq(knowledgeBase.id, knowledgeBaseId))
          .for('share')
          .limit(1)
        if (!owner?.isSearchIndex) {
          throw new Error('The knowledge base stopped being a search index during the run')
        }
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
        const now = new Date()
        /**
         * The same columns the app clears when a connector must list everything again (an access
         * mode switch, a source change), limited to stopped connectors no sync holds.
         */
        const connectors = await tx
          .update(knowledgeConnector)
          .set({
            lastSyncAt: null,
            lastSyncDocCount: null,
            listingCheckpoint: null,
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
              isNull(knowledgeConnector.memberSyncLockToken)
            )
          )
          .returning({ id: knowledgeConnector.id })
        if (connectors.length === 0) return { connectors: 0, members: 0 }
        const members = await tx
          .update(knowledgeConnectorMember)
          .set({
            listingCheckpoint: null,
            changeCursor: null,
            memberSyncedThrough: null,
            lastCompleteListingAt: null,
            lastListedCount: null,
            updatedAt: now,
          })
          .where(
            inArray(
              knowledgeConnectorMember.connectorId,
              connectors.map((connector) => connector.id)
            )
          )
          .returning({ id: knowledgeConnectorMember.id })
        return { connectors: connectors.length, members: members.length }
      })
    },
  }
}
