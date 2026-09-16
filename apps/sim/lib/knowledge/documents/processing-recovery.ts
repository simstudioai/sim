import { db } from '@sim/db'
import { document, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  assertBillingAttributionOwner,
  resolveSystemBillingAttribution,
  resolveSystemOrganizationBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import { withinDeadline } from '@/lib/core/utils/deadline'
import { getConnectorFailureDiagnostic } from '@/lib/knowledge/connectors/connector-error'
import {
  createDocumentProcessingPayload,
  createOrganizationDocumentProcessingBillingContext,
  createWorkspaceDocumentProcessingBillingContext,
} from '@/lib/knowledge/documents/processing-payload'
import { documentProcessingRecoveryCondition } from '@/lib/knowledge/documents/processing-recovery-policy'

const logger = createLogger('KnowledgeDocumentRecovery')

export const KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT = 'knowledge.document.processing.recover'
export const DOCUMENT_RECOVERY_BATCH_SIZE = 200
const RECOVERY_RUNTIME_MS = 20_000
const RECOVERABLE_CONNECTOR_STATUSES = ['active', 'error', 'pending', 'syncing']

/**
 * Re-admits bounded, abandoned connector documents from our retained bytes, independently
 * of source sync schedules and credentials. The generation, attempt and outbox event commit
 * together; no provider call or source lease is needed. Paused/deleted sources stay paused.
 */
export async function recoverKnowledgeDocumentProcessing(now = new Date()): Promise<number> {
  const deadlineAt = Date.now() + RECOVERY_RUNTIME_MS
  return withinDeadline((signal) => recoverStoredDocuments(now, deadlineAt, signal), deadlineAt)
}

async function recoverStoredDocuments(
  now: Date,
  deadlineAt: number,
  signal: AbortSignal
): Promise<number> {
  const candidates = await db.transaction(async (tx) => {
    signal.throwIfAborted()
    await tx.execute(
      sql`SELECT set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)`
    )
    signal.throwIfAborted()
    return tx
      .select({
        id: document.id,
        knowledgeBaseId: document.knowledgeBaseId,
        connectorId: document.connectorId,
        workspaceId: knowledgeBase.workspaceId,
        organizationId: knowledgeBase.organizationId,
      })
      .from(document)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, document.knowledgeBaseId))
      .innerJoin(knowledgeConnector, eq(knowledgeConnector.id, document.connectorId))
      .where(
        and(
          documentProcessingRecoveryCondition(now),
          isNull(knowledgeBase.deletedAt),
          isNull(knowledgeConnector.deletedAt),
          isNull(knowledgeConnector.archivedAt),
          inArray(knowledgeConnector.status, RECOVERABLE_CONNECTOR_STATUSES)
        )
      )
      .orderBy(asc(document.uploadedAt), asc(document.id))
      .limit(DOCUMENT_RECOVERY_BATCH_SIZE)
      .for('update', { of: knowledgeBase, skipLocked: true })
  })
  signal.throwIfAborted()

  let recovered = 0
  const groups = new Map<string, typeof candidates>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.knowledgeBaseId) ?? []
    group.push(candidate)
    groups.set(candidate.knowledgeBaseId, group)
  }
  for (const [knowledgeBaseId, group] of groups) {
    if (Date.now() >= deadlineAt) break
    const owner = group[0]
    try {
      signal.throwIfAborted()
      const attribution = owner.organizationId
        ? await resolveSystemOrganizationBillingAttribution(owner.organizationId)
        : owner.workspaceId
          ? await resolveSystemBillingAttribution(owner.workspaceId)
          : undefined
      signal.throwIfAborted()
      if (!attribution) throw new Error('Document recovery requires a canonical owner')
      const billingContext = owner.organizationId
        ? createOrganizationDocumentProcessingBillingContext(attribution)
        : createWorkspaceDocumentProcessingBillingContext(attribution)

      recovered += await db.transaction(async (tx) => {
        signal.throwIfAborted()
        await tx.execute(
          sql`SELECT set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)`
        )
        const [kb] = await tx
          .select({
            workspaceId: knowledgeBase.workspaceId,
            organizationId: knowledgeBase.organizationId,
          })
          .from(knowledgeBase)
          .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
          .for('update', { skipLocked: true })
        signal.throwIfAborted()
        if (!kb) return 0
        assertBillingAttributionOwner(attribution, kb)
        const connectors = await tx
          .select({ id: knowledgeConnector.id })
          .from(knowledgeConnector)
          .where(
            and(
              inArray(knowledgeConnector.id, [
                ...new Set(group.flatMap((row) => (row.connectorId ? [row.connectorId] : []))),
              ]),
              eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
              inArray(knowledgeConnector.status, RECOVERABLE_CONNECTOR_STATUSES),
              isNull(knowledgeConnector.archivedAt),
              isNull(knowledgeConnector.deletedAt)
            )
          )
          .orderBy(asc(knowledgeConnector.id))
          .for('update', { skipLocked: true })
        if (!connectors.length) return 0
        const docs = await tx
          .select({
            id: document.id,
            filename: document.filename,
            fileUrl: document.fileUrl,
            fileSize: document.fileSize,
            mimeType: document.mimeType,
          })
          .from(document)
          .where(
            and(
              inArray(
                document.id,
                group.map((row) => row.id)
              ),
              eq(document.knowledgeBaseId, knowledgeBaseId),
              inArray(
                document.connectorId,
                connectors.map((row) => row.id)
              ),
              documentProcessingRecoveryCondition(now)
            )
          )
          .orderBy(asc(document.id))
          .for('update', { skipLocked: true })
        let enqueued = 0
        for (const doc of docs) {
          signal.throwIfAborted()
          if (Date.now() >= deadlineAt) break
          const token = generateId()
          const queuedAt = new Date()
          const payload = createDocumentProcessingPayload(
            {
              knowledgeBaseId,
              documentId: doc.id,
              docData: {
                filename: doc.filename,
                fileUrl: doc.fileUrl,
                fileSize: doc.fileSize,
                mimeType: doc.mimeType,
              },
              processingOptions: {},
              requestId: token,
              processingQueueToken: token,
              processingQueuedAt: queuedAt.toISOString(),
              chargedAtDispatch: true,
            },
            billingContext
          )
          await tx
            .update(document)
            .set({
              processingStatus: 'pending',
              processingQueueToken: token,
              processingQueuedAt: queuedAt,
              processingStartedAt: null,
              processingDeferredUntil: null,
              processingCompletedAt: null,
              processingError: null,
              processingRecoveryAfter: null,
              processingAttempts: sql`${document.processingAttempts} + 1`,
            })
            .where(eq(document.id, doc.id))
          await enqueueOutboxEvent(tx, KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT, payload, {
            id: token,
          })
          enqueued++
        }
        signal.throwIfAborted()
        return enqueued
      })
    } catch (error) {
      signal.throwIfAborted()
      logger.error('Stored document recovery admission failed', {
        knowledgeBaseId,
        diagnostic: getConnectorFailureDiagnostic(error),
      })
      /** Failed admission must not monopolize the oldest batch; no indexing attempt is spent. */
      await db.transaction(async (tx) => {
        signal.throwIfAborted()
        await tx.execute(
          sql`SELECT set_config('statement_timeout', '5000', true), set_config('lock_timeout', '1000', true)`
        )
        signal.throwIfAborted()
        await tx
          .update(document)
          .set({ processingRecoveryAfter: new Date(now.getTime() + 15 * 60_000) })
          .where(
            and(
              eq(document.knowledgeBaseId, knowledgeBaseId),
              inArray(
                document.id,
                group.map((row) => row.id)
              ),
              documentProcessingRecoveryCondition(now)
            )
          )
        signal.throwIfAborted()
      })
    }
  }
  return recovered
}
