import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeConnectorMemberSyncLog,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  continueOutboxHandler,
  enqueueOutboxEvent,
  type OutboxHandler,
} from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import { revokeKnowledgeConnectorCredentialAccess } from '@/lib/knowledge/connectors/member-access'
import { enqueueKnowledgeStorageCleanup } from '@/lib/knowledge/documents/storage-cleanup'
import { cleanupUnusedTagDefinitions } from '@/lib/knowledge/tags/service'

export const KNOWLEDGE_CONNECTOR_CLEANUP_EVENT = 'knowledge.connector.cleanup'
const DOCUMENT_BATCH_SIZE = 250
const EMBEDDING_BATCH_SIZE = 1_000
const RELATED_ROW_BATCH_SIZE = 1_000
const MAX_BATCHES_PER_RUN = 4
const RUN_BUDGET_MS = 30_000

const deletionPayloadSchema = z
  .object({
    version: z.literal(1),
    knowledgeBaseId: z.string().min(1).max(256),
    connectorId: z.string().min(1).max(256),
    deletedAt: z.iso.datetime(),
    credentialAccess: z
      .object({
        workspaceId: z.string().min(1).max(256),
        credentialGroupId: z.string().min(1).max(256),
        actorUserId: z.string().min(1).max(256),
      })
      .optional(),
  })
  .strict()

type ConnectorDeletionPayload = z.infer<typeof deletionPayloadSchema>

/** The tombstone and its durable cleanup intent must commit together. */
export async function enqueueConnectorDeletion(
  tx: DbOrTx,
  payload: Omit<ConnectorDeletionPayload, 'version'>
): Promise<void> {
  await enqueueOutboxEvent(
    tx,
    KNOWLEDGE_CONNECTOR_CLEANUP_EVENT,
    deletionPayloadSchema.parse({ version: 1, ...payload }),
    { maxAttempts: 48 }
  )
}

/**
 * Final phase of both connector removals, once no document references the connector: deletes one
 * bounded page of its sync history and member rows per call, then the connector row itself. The
 * row delete is guarded by the removal's own tombstone so a superseded event cannot delete it.
 */
export async function removeDrainedConnector(
  tx: DbOrTx,
  target: { connectorId: string; knowledgeBaseId: string },
  retiredBy: SQL,
  signal: AbortSignal
): Promise<'progress' | 'complete'> {
  for (const table of [
    knowledgeConnectorSyncLog,
    knowledgeConnectorMemberSyncLog,
    knowledgeConnectorMember,
  ]) {
    const rows = await tx
      .select({ id: table.id })
      .from(table)
      .where(eq(table.connectorId, target.connectorId))
      .limit(RELATED_ROW_BATCH_SIZE)
    if (rows.length === 0) continue
    await tx.delete(table).where(
      inArray(
        table.id,
        rows.map(({ id }) => id)
      )
    )
    signal.throwIfAborted()
    return 'progress'
  }
  await tx
    .delete(knowledgeConnector)
    .where(
      and(
        eq(knowledgeConnector.id, target.connectorId),
        eq(knowledgeConnector.knowledgeBaseId, target.knowledgeBaseId),
        retiredBy
      )
    )
  return 'complete'
}

/**
 * Each transaction releases at most 250 documents or 1,000 chunks. Locks prevent a late
 * indexing commit from inserting chunks between the final chunk scan and document deletion.
 * The connector stays attached until every document is gone, preserving storage accounting
 * and preventing removed content from becoming a standalone workspace document.
 */
export const cleanupKnowledgeConnector: OutboxHandler = async (rawPayload, context) => {
  const payload = deletionPayloadSchema.parse(rawPayload)
  const deadline = Math.min(
    Date.now() + RUN_BUDGET_MS,
    context.deadlineAt ?? Number.POSITIVE_INFINITY
  )
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    context.signal.throwIfAborted()
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`)
      const [owner] = await tx
        .select({
          workspaceId: knowledgeBase.workspaceId,
          organizationId: knowledgeBase.organizationId,
          userId: knowledgeBase.userId,
        })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, payload.knowledgeBaseId))
        .for('share')
        .limit(1)
      if (!owner) return 'complete'
      const [connector] = await tx
        .select({ deletedAt: knowledgeConnector.deletedAt })
        .from(knowledgeConnector)
        .where(
          and(
            eq(knowledgeConnector.id, payload.connectorId),
            eq(knowledgeConnector.knowledgeBaseId, payload.knowledgeBaseId)
          )
        )
        .for('update')
        .limit(1)
      if (!connector) return 'complete'
      if (connector.deletedAt?.toISOString() !== payload.deletedAt) return 'obsolete'

      /** Drain the indexed connector bucket; sorting the whole remaining corpus on every batch is unnecessary. */
      const docs = await tx
        .select({ id: document.id, fileUrl: document.fileUrl })
        .from(document)
        .where(
          and(
            eq(document.connectorId, payload.connectorId),
            eq(document.knowledgeBaseId, payload.knowledgeBaseId)
          )
        )
        .limit(DOCUMENT_BATCH_SIZE)
        .for('update')
      context.signal.throwIfAborted()
      if (docs.length === 0) {
        return removeDrainedConnector(
          tx,
          payload,
          eq(knowledgeConnector.deletedAt, new Date(payload.deletedAt)),
          context.signal
        )
      }
      const documentIds = docs.map(({ id }) => id)
      const chunks = await tx
        .select({ id: embedding.id })
        .from(embedding)
        .where(inArray(embedding.documentId, documentIds))
        .limit(EMBEDDING_BATCH_SIZE)
      if (chunks.length > 0) {
        await tx.delete(embedding).where(
          inArray(
            embedding.id,
            chunks.map(({ id }) => id)
          )
        )
      } else {
        await enqueueKnowledgeStorageCleanup(
          tx,
          docs.map((doc) => ({ ...doc, ...owner })),
          context.eventId
        )
        await tx.delete(document).where(inArray(document.id, documentIds))
      }
      context.signal.throwIfAborted()
      return 'progress'
    })
    if (outcome === 'obsolete') return
    if (outcome === 'complete') {
      context.signal.throwIfAborted()
      if (payload.credentialAccess) {
        await revokeKnowledgeConnectorCredentialAccess(
          {
            workspaceId: payload.credentialAccess.workspaceId,
            credentialGroupId: payload.credentialAccess.credentialGroupId,
            connectorId: payload.connectorId,
          },
          payload.credentialAccess.actorUserId
        )
      }
      context.signal.throwIfAborted()
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)
        await tx.execute(sql`SET LOCAL statement_timeout = '10s'`)
        await tx
          .select({ id: knowledgeBase.id })
          .from(knowledgeBase)
          .where(eq(knowledgeBase.id, payload.knowledgeBaseId))
          .for('no key update')
        await cleanupUnusedTagDefinitions(payload.knowledgeBaseId, context.eventId, {
          executor: tx,
          signal: context.signal,
        })
        context.signal.throwIfAborted()
      })
      return
    }
    if (Date.now() >= deadline) break
  }
  return continueOutboxHandler('Connector cleanup committed a bounded batch', 1_000)
}
