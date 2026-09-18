import { db } from '@sim/db'
import { document, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
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
import {
  documentProcessingRecoveryCondition,
  releaseUnclaimedDispatchAttempt,
} from '@/lib/knowledge/documents/processing-recovery-policy'

const logger = createLogger('KnowledgeDocumentRecovery')

export const KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT = 'knowledge.document.processing.recover'
export const DOCUMENT_RECOVERY_BATCH_SIZE = 200
const RECOVERY_RUNTIME_MS = 20_000
const MAX_RECOVERY_CANDIDATE_BATCHES = 4
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
  let recovered = 0
  const blockedKnowledgeBases = new Set<string>()
  const attemptedConnectors = new Set<string>()
  for (let batch = 0; batch < MAX_RECOVERY_CANDIDATE_BATCHES; batch++) {
    if (recovered >= DOCUMENT_RECOVERY_BATCH_SIZE || Date.now() >= deadlineAt) break
    const connectorsBefore = attemptedConnectors.size
    recovered += await recoverStoredDocumentBatch(
      now,
      deadlineAt,
      signal,
      blockedKnowledgeBases,
      attemptedConnectors,
      DOCUMENT_RECOVERY_BATCH_SIZE - recovered
    )
    if (attemptedConnectors.size === connectorsBefore) break
  }
  return recovered
}

async function recoverStoredDocumentBatch(
  now: Date,
  deadlineAt: number,
  signal: AbortSignal,
  blockedKnowledgeBases: Set<string>,
  attemptedConnectors: Set<string>,
  limit: number
): Promise<number> {
  /** Discovery does not claim work. Ownership is rechecked under lifecycle locks below. */
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
        connectorId: knowledgeConnector.id,
        workspaceId: knowledgeBase.workspaceId,
        organizationId: knowledgeBase.organizationId,
      })
      .from(document)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, document.knowledgeBaseId))
      .innerJoin(knowledgeConnector, eq(knowledgeConnector.id, document.connectorId))
      .where(
        and(
          documentProcessingRecoveryCondition(now),
          blockedKnowledgeBases.size > 0
            ? notInArray(document.knowledgeBaseId, [...blockedKnowledgeBases])
            : undefined,
          attemptedConnectors.size > 0
            ? notInArray(document.connectorId, [...attemptedConnectors])
            : undefined,
          isNull(knowledgeBase.deletedAt),
          isNull(knowledgeConnector.deletedAt),
          isNull(knowledgeConnector.archivedAt),
          inArray(knowledgeConnector.status, RECOVERABLE_CONNECTOR_STATUSES)
        )
      )
      .orderBy(asc(document.uploadedAt), asc(document.id))
      .limit(limit)
  })
  signal.throwIfAborted()
  if (candidates.length === 0) return 0

  let recovered = 0
  const groups = new Map<string, typeof candidates>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.knowledgeBaseId) ?? []
    group.push(candidate)
    groups.set(candidate.knowledgeBaseId, group)
  }
  for (const [knowledgeBaseId, group] of groups) {
    if (Date.now() >= deadlineAt) break
    const connectorIds = [...new Set(group.map((row) => row.connectorId))]
    for (const connectorId of connectorIds) attemptedConnectors.add(connectorId)
    const owner = group[0]
    let ownerVerified = false
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
          .for('share', { skipLocked: true })
        signal.throwIfAborted()
        if (!kb) {
          blockedKnowledgeBases.add(knowledgeBaseId)
          return 0
        }
        assertBillingAttributionOwner(attribution, kb)
        ownerVerified = true
        const connectors = await tx
          .select({ id: knowledgeConnector.id })
          .from(knowledgeConnector)
          .where(
            and(
              inArray(knowledgeConnector.id, connectorIds),
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
              /** This sweep only selects connector-owned documents. */
              processingLane: 'backfill',
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
              processingAttempts: sql`${releaseUnclaimedDispatchAttempt(now)} + 1`,
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
      if (!ownerVerified) blockedKnowledgeBases.add(knowledgeBaseId)
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
