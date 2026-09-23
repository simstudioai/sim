import { db } from '@sim/db'
import {
  document,
  embeddingKeywordTin,
  embeddingSearch,
  knowledgeBase,
  knowledgeConnector,
} from '@sim/db/schema'
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  decrementStorageUsageForBillingContextInTx,
  incrementAdmittedStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext,
  type StorageBillingContext,
} from '@/lib/billing/storage'
import {
  continueOutboxHandler,
  enqueueOutboxEvent,
  type OutboxHandler,
} from '@/lib/core/outbox/service'
import type { DbOrTx } from '@/lib/db/types'
import { removeDrainedConnector } from '@/lib/knowledge/connectors/deletion'
import { revokeKnowledgeConnectorCredentialAccess } from '@/lib/knowledge/connectors/member-access'

export const KNOWLEDGE_CONNECTOR_DETACH_EVENT = 'knowledge.connector.detach'
const DOCUMENT_BATCH_SIZE = 100
const PROJECTION_ROW_BATCH_SIZE = 250
const MAX_BATCHES_PER_RUN = 4
const RUN_BUDGET_MS = 30_000

const detachmentPayloadSchema = z
  .object({
    version: z.literal(1),
    knowledgeBaseId: z.string().min(1).max(256),
    connectorId: z.string().min(1).max(256),
    detachedAt: z.iso.datetime(),
    credentialAccess: z
      .object({
        workspaceId: z.string().min(1).max(256),
        credentialGroupId: z.string().min(1).max(256),
        actorUserId: z.string().min(1).max(256),
      })
      .optional(),
  })
  .strict()

type ConnectorDetachmentPayload = z.infer<typeof detachmentPayloadSchema>

/** The detached connector and its durable release intent must commit together. */
export async function enqueueConnectorDetachment(
  tx: DbOrTx,
  payload: Omit<ConnectorDetachmentPayload, 'version'>
): Promise<void> {
  await enqueueOutboxEvent(
    tx,
    KNOWLEDGE_CONNECTOR_DETACH_EVENT,
    detachmentPayloadSchema.parse({ version: 1, ...payload }),
    { maxAttempts: 48 }
  )
}

/**
 * The bytes a connector document is billed for once released. Connector bytes are unmetered until
 * release. Live tombstones are resurrected by the release and billed; archived tombstones stay
 * deleted and nonbillable; legacy skipped rows recorded the remote size without keeping a file.
 */
export function keptDocumentBytes() {
  return sql<number>`CASE
    WHEN (${document.archivedAt} IS NULL OR ${document.deletedAt} IS NULL)
      AND NOT (${document.storageKey} IS NULL AND ${document.fileUrl} = '')
    THEN ${document.fileSize}::bigint
    ELSE 0
  END`
}

const SEARCH_PROJECTIONS = [embeddingSearch, embeddingKeywordTin] as const

/**
 * Settles what is left of a detached connector's reservation: an unreleased remainder is refunded,
 * and an overdraft, released bytes beyond what removal charged, is charged as already admitted.
 * Returns the payer's updated usage when it grew, for a storage-limit notification after commit.
 */
async function settleDetachReservationInTx(
  tx: DbOrTx,
  storageContext: StorageBillingContext,
  reservedBytes: number
): Promise<number | undefined> {
  if (reservedBytes > 0) {
    await decrementStorageUsageForBillingContextInTx(tx, storageContext, reservedBytes)
    return undefined
  }
  if (reservedBytes < 0) {
    return incrementAdmittedStorageUsageForBillingContextInTx(tx, storageContext, -reservedBytes)
  }
  return undefined
}

/**
 * Settles the reservations of detached connectors on knowledge bases about to be hard-deleted.
 *
 * Purging a base cascades its connectors away, and with them the reservation a detached connector
 * still holds for documents it never released; its pending detach job then finds no base and
 * settles nothing. So before the purge deletes the bases' documents, each base's detached
 * connectors are locked in the detach job's order (base, then connector), their net reservation is
 * settled exactly as the job's final transaction would settle it, and zeroed in the same
 * transaction, so a retried purge settles nothing twice.
 *
 * It runs before the documents are deleted because deleting a released document decrements the
 * payer's usage with a floor at zero: an overdrawn (negative) reservation settled afterwards would
 * re-add bytes the floor already discarded. Settling first also means the pending detach job must
 * not release another page before the documents go, so the same transaction re-stamps each
 * connector's `detached_at`; the job's own supersession check then treats its event as obsolete.
 */
export async function settleDetachedConnectorReservations(
  knowledgeBaseIds: string[]
): Promise<void> {
  for (const knowledgeBaseId of knowledgeBaseIds) {
    const [owner] = await db
      .select({ workspaceId: knowledgeBase.workspaceId })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, knowledgeBaseId))
      .limit(1)
    if (!owner?.workspaceId) continue
    const storageContext = await resolveStorageBillingContext(owner.workspaceId)

    const updatedUsage = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`)
      const [lockedOwner] = await tx
        .select({ workspaceId: knowledgeBase.workspaceId })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, knowledgeBaseId))
        .for('share')
        .limit(1)
      if (!lockedOwner) return undefined
      if (lockedOwner.workspaceId !== owner.workspaceId) {
        throw new Error('Knowledge base workspace changed during detach reservation settlement')
      }
      const reserved = await tx
        .select({
          id: knowledgeConnector.id,
          reservedBytes: knowledgeConnector.detachReservedBytes,
        })
        .from(knowledgeConnector)
        .where(
          and(
            eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
            isNotNull(knowledgeConnector.detachedAt)
          )
        )
        .orderBy(asc(knowledgeConnector.id))
        .for('update')
      if (reserved.length === 0) return undefined

      /**
       * One net settlement per base: the ledger lands where settling each connector in turn would
       * leave it, and the notifier sees that final balance rather than one from mid-sequence.
       */
      const netReservedBytes = reserved.reduce((sum, connector) => sum + connector.reservedBytes, 0)
      const grownUsage = await settleDetachReservationInTx(tx, storageContext, netReservedBytes)
      await tx
        .update(knowledgeConnector)
        .set({ detachReservedBytes: 0, detachedAt: new Date() })
        .where(
          inArray(
            knowledgeConnector.id,
            reserved.map(({ id }) => id)
          )
        )
      return grownUsage
    })
    if (updatedUsage !== undefined) {
      await maybeNotifyStorageLimitForBillingContext(storageContext, updatedUsage)
    }
  }
}

/**
 * Releases a detached connector's documents as standalone entries, then deletes the connector.
 *
 * Nulling a document's `connector_id` fires the projection trigger, which rewrites every enabled
 * chunk of it in both search projections, each a fresh index entry. So each transaction first
 * releases at most 250 projection rows per table of the next 100 documents, and flips those
 * documents only once none of their rows still name the connector; the trigger then finds nothing
 * to rewrite. A document larger than one page spans several transactions, and its released rows
 * read as an upload in the meantime, which grants the same access: only workspace-access
 * connectors can keep their documents.
 *
 * The removal request admitted and charged the kept bytes and recorded them on the connector as
 * `detach_reserved_bytes`. Each page consumes the bytes it releases from that reservation in the
 * same transaction, and the transaction that deletes the connector settles whatever is left, such
 * as a document deleted before its release, so the ledger ends exactly at the released documents.
 */
export const detachKnowledgeConnector: OutboxHandler = async (rawPayload, context) => {
  const payload = detachmentPayloadSchema.parse(rawPayload)
  const deadline = Math.min(
    Date.now() + RUN_BUDGET_MS,
    context.deadlineAt ?? Number.POSITIVE_INFINITY
  )
  const [owner] = await db
    .select({ workspaceId: knowledgeBase.workspaceId })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, payload.knowledgeBaseId))
    .limit(1)
  if (!owner) return
  const storageContext = owner.workspaceId
    ? await resolveStorageBillingContext(owner.workspaceId)
    : undefined

  let storageNotification: { context: StorageBillingContext; updatedUsage: number } | undefined
  let outcome: 'progress' | 'complete' | 'obsolete' = 'progress'
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN && outcome === 'progress'; batch++) {
    context.signal.throwIfAborted()
    outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)
      await tx.execute(sql`SET LOCAL statement_timeout = '30s'`)
      /** Match source writes and document deletion: parent KB, connector, then documents. */
      const [lockedOwner] = await tx
        .select({ workspaceId: knowledgeBase.workspaceId })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, payload.knowledgeBaseId))
        .for('share')
        .limit(1)
      if (!lockedOwner) return 'complete'
      if (lockedOwner.workspaceId !== owner.workspaceId) {
        throw new Error('Knowledge base workspace changed during connector detachment')
      }
      const [connector] = await tx
        .select({
          detachedAt: knowledgeConnector.detachedAt,
          reservedBytes: knowledgeConnector.detachReservedBytes,
        })
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
      if (connector.detachedAt?.toISOString() !== payload.detachedAt) return 'obsolete'

      const documentIds = (
        await tx
          .select({ id: document.id })
          .from(document)
          .where(
            and(
              eq(document.connectorId, payload.connectorId),
              eq(document.knowledgeBaseId, payload.knowledgeBaseId)
            )
          )
          .limit(DOCUMENT_BATCH_SIZE)
          .for('update')
      ).map(({ id }) => id)
      if (documentIds.length === 0) {
        const drained = await removeDrainedConnector(
          tx,
          payload,
          eq(knowledgeConnector.detachedAt, new Date(payload.detachedAt)),
          context.signal
        )
        if (drained === 'complete' && storageContext) {
          const updatedUsage = await settleDetachReservationInTx(
            tx,
            storageContext,
            connector.reservedBytes
          )
          if (updatedUsage !== undefined) {
            storageNotification = { context: storageContext, updatedUsage }
          }
        }
        return drained
      }

      let projectionPageFull = false
      for (const projection of SEARCH_PROJECTIONS) {
        const page = tx
          .select({ id: projection.id })
          .from(projection)
          .where(
            and(
              inArray(projection.documentId, documentIds),
              eq(projection.enabled, true),
              isNotNull(projection.connectorId)
            )
          )
          .limit(PROJECTION_ROW_BATCH_SIZE)
        const released = await tx
          .update(projection)
          .set({ connectorId: null })
          .where(inArray(projection.id, page))
          .returning({ id: projection.id })
        if (released.length === PROJECTION_ROW_BATCH_SIZE) projectionPageFull = true
      }
      if (projectionPageFull) return 'progress'

      const releasedDocuments = await tx
        .update(document)
        .set({
          connectorId: null,
          deletedAt: sql`CASE WHEN ${document.archivedAt} IS NULL THEN NULL ELSE ${document.deletedAt} END`,
          fileSize: sql`CASE WHEN ${document.storageKey} IS NULL AND ${document.fileUrl} = '' THEN 0 ELSE ${document.fileSize} END`,
        })
        .where(inArray(document.id, documentIds))
        .returning({ fileSize: document.fileSize, deletedAt: document.deletedAt })
      const releasedBytes = releasedDocuments.reduce(
        (total, released) => (released.deletedAt === null ? total + released.fileSize : total),
        0
      )
      if (storageContext && releasedBytes > 0) {
        await tx
          .update(knowledgeConnector)
          .set({
            detachReservedBytes: sql`${knowledgeConnector.detachReservedBytes} - ${releasedBytes}`,
          })
          .where(eq(knowledgeConnector.id, payload.connectorId))
      }
      context.signal.throwIfAborted()
      return 'progress'
    })
    if (Date.now() >= deadline) break
  }

  if (storageNotification) {
    await maybeNotifyStorageLimitForBillingContext(
      storageNotification.context,
      storageNotification.updatedUsage
    )
  }
  if (outcome === 'obsolete') return
  if (outcome === 'complete') {
    if (payload.credentialAccess) {
      context.signal.throwIfAborted()
      await revokeKnowledgeConnectorCredentialAccess(
        {
          workspaceId: payload.credentialAccess.workspaceId,
          credentialGroupId: payload.credentialAccess.credentialGroupId,
          connectorId: payload.connectorId,
        },
        payload.credentialAccess.actorUserId
      )
    }
    return
  }
  return continueOutboxHandler('Connector detachment released a bounded batch', 1_000)
}
