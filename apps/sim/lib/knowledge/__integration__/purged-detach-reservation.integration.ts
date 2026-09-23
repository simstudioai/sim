/**
 * Real PostgreSQL coverage for a knowledge base purged while one of its sources is still being
 * detached. Removal charges the kept bytes up front as the source's reservation; the purge's
 * cascade deletes the source, so the reservation has to be settled before it, or its bytes stay
 * on the ledger for documents that no longer exist.
 */
import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  organization,
  outboxEvent,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { drainConnectorEvent } from '@/lib/knowledge/__integration__/drain-connector-event'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  KNOWLEDGE_CONNECTOR_DETACH_EVENT,
  settleDetachedConnectorReservations,
} from '@/lib/knowledge/connectors/detachment'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'
import { createSingleDocument, hardDeleteDocuments } from '@/lib/knowledge/documents/service'
import { performDeleteKnowledgeConnector } from '@/lib/knowledge/orchestration/connectors'
import { runCleanupSoftDeletes } from '@/background/cleanup-soft-deletes'

type Fixture = ReturnType<typeof createKnowledgeAclFixtureIds>
const fixtures: Fixture[] = []

/** More documents than one detach run releases (4 pages of 100), so a run can stop mid-source. */
const SOURCE_DOCUMENTS = 450
const RETENTION_HOURS = 720

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

function sourceDocument(ids: Fixture, bytes: number) {
  return {
    id: generateId(),
    knowledgeBaseId: ids.knowledgeBaseId,
    connectorId: ids.connectorId,
    filename: 'source.txt',
    fileUrl: 'data:text/plain;base64,c291cmNl',
    fileSize: bytes,
    mimeType: 'text/plain',
  }
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

async function reservation(ids: Fixture) {
  const [row] = await db
    .select({ reservedBytes: knowledgeConnector.detachReservedBytes })
    .from(knowledgeConnector)
    .where(eq(knowledgeConnector.id, ids.connectorId))
  return row?.reservedBytes
}

/** Removes the source keeping its documents; the release is left to the queued detach job. */
async function disconnect(ids: Fixture) {
  const outcome = await performDeleteKnowledgeConnector({
    knowledgeBase: { id: ids.knowledgeBaseId, name: 'Fixture', workspaceId: ids.workspaceId },
    connectorId: ids.connectorId,
    deleteDocuments: false,
    userId: ids.aliceId,
    source: 'api',
    requestId: generateId(),
    recordSemanticAudit: false,
    recordProductAnalytics: false,
  })
  expect(outcome).toMatchObject({ success: true })
}

/** Runs the queued detach job exactly once, as one outbox worker pass would. */
async function runDetachOnce(ids: Fixture) {
  const [job] = await db
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, KNOWLEDGE_CONNECTOR_DETACH_EVENT),
        eq(outboxEvent.status, 'pending'),
        sql`${outboxEvent.payload}->>'connectorId' = ${ids.connectorId}`
      )
    )
    .limit(1)
  return processOutboxEventById(job.id, knowledgeDocumentProcessingOutboxHandlers)
}

afterAll(async () => {
  for (const ids of fixtures) {
    await db
      .delete(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, KNOWLEDGE_CONNECTOR_DETACH_EVENT),
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

describe('purging a knowledge base with a source still being detached', () => {
  it('settles the reservation before the purge and leaves the late detach job nothing to settle', async () => {
    const ids = await seed()
    const rows = Array.from({ length: SOURCE_DOCUMENTS }, (_, index) =>
      sourceDocument(ids, (index % 7) + 1)
    )
    const keptBytes = rows.reduce((total, row) => total + row.fileSize, 0)
    await db.insert(document).values(rows)

    await disconnect(ids)
    expect(await ledger(ids)).toEqual({ workspaceBytes: keptBytes, payerBytes: keptBytes })
    expect(await reservation(ids)).toBe(keptBytes)

    /** One bounded run releases some documents, which consume their share of the reservation. */
    expect(await runDetachOnce(ids)).toBe('pending')
    const [released] = await db
      .select({ bytes: sql<number>`COALESCE(SUM(${document.fileSize}), 0)::integer` })
      .from(document)
      .where(and(eq(document.knowledgeBaseId, ids.knowledgeBaseId), isNull(document.connectorId)))
    expect(released.bytes).toBeGreaterThan(0)
    expect(released.bytes).toBeLessThan(keptBytes)
    expect(await reservation(ids)).toBe(keptBytes - released.bytes)
    expect(await ledger(ids)).toEqual({ workspaceBytes: keptBytes, payerBytes: keptBytes })

    await db
      .update(knowledgeBase)
      .set({ deletedAt: new Date(Date.now() - 2 * RETENTION_HOURS * 60 * 60 * 1000) })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await runCleanupSoftDeletes({
      label: 'purge-fixture',
      plan: 'free',
      retentionHours: RETENTION_HOURS,
      workspaceIds: [ids.workspaceId],
    })

    expect(
      await db
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    ).toHaveLength(0)
    expect(
      await db
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
    ).toHaveLength(0)
    /** The workspace keeps no files or documents, so a from-scratch recount is zero. */
    expect(await ledger(ids)).toEqual({ workspaceBytes: 0, payerBytes: 0 })

    await drainConnectorEvent(ids.connectorId, KNOWLEDGE_CONNECTOR_DETACH_EVENT)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 0, payerBytes: 0 })
  })

  it('settles an overdrawn reservation before the purge deletes the released documents', async () => {
    const ids = await seed()
    const rows = Array.from({ length: SOURCE_DOCUMENTS }, (_, index) =>
      sourceDocument(ids, (index % 7) + 1)
    )
    const keptBytes = rows.reduce((total, row) => total + row.fileSize, 0)
    await db.insert(document).values(rows)
    await disconnect(ids)
    expect(await ledger(ids)).toEqual({ workspaceBytes: keptBytes, payerBytes: keptBytes })

    /** Documents that grew after removal release more bytes than removal reserved. */
    await db
      .update(document)
      .set({ fileSize: sql`${document.fileSize} + 10` })
      .where(eq(document.connectorId, ids.connectorId))
    expect(await runDetachOnce(ids)).toBe('pending')
    const overdrawn = await reservation(ids)
    expect(overdrawn).toBeLessThan(0)
    /** Removal charged less than the released documents now hold, so the ledger trails them. */
    expect(await ledger(ids)).toEqual({ workspaceBytes: keptBytes, payerBytes: keptBytes })

    await db
      .update(knowledgeBase)
      .set({ deletedAt: new Date(Date.now() - 2 * RETENTION_HOURS * 60 * 60 * 1000) })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await runCleanupSoftDeletes({
      label: 'purge-overdrawn-fixture',
      plan: 'free',
      retentionHours: RETENTION_HOURS,
      workspaceIds: [ids.workspaceId],
    })

    expect(await ledger(ids)).toEqual({ workspaceBytes: 0, payerBytes: 0 })
  })

  it('keeps a positive reservation billed and the detach running when the purge stops before the documents', async () => {
    const ids = await seed()
    const rows = Array.from({ length: SOURCE_DOCUMENTS }, (_, index) =>
      sourceDocument(ids, (index % 7) + 1)
    )
    const keptBytes = rows.reduce((total, row) => total + row.fileSize, 0)
    await db.insert(document).values(rows)
    await disconnect(ids)

    /** The purge settled only overdrawn reservations, then its document deletion failed. */
    await settleDetachedConnectorReservations([ids.knowledgeBaseId], 'overdrawn')
    expect(await reservation(ids)).toBe(keptBytes)
    expect(await ledger(ids)).toEqual({ workspaceBytes: keptBytes, payerBytes: keptBytes })

    /** The detach is not fenced off, so a base restored now still releases its documents. */
    expect(await runDetachOnce(ids)).toBe('pending')
    const [released] = await db
      .select({ bytes: sql<number>`COALESCE(SUM(${document.fileSize}), 0)::integer` })
      .from(document)
      .where(and(eq(document.knowledgeBaseId, ids.knowledgeBaseId), isNull(document.connectorId)))
    expect(released.bytes).toBeGreaterThan(0)
    expect(await ledger(ids)).toEqual({ workspaceBytes: keptBytes, payerBytes: keptBytes })

    /** A retried purge finishes the job and leaves the ledger at a from-scratch recount. */
    await db
      .update(knowledgeBase)
      .set({ deletedAt: new Date(Date.now() - 2 * RETENTION_HOURS * 60 * 60 * 1000) })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await runCleanupSoftDeletes({
      label: 'purge-retry-fixture',
      plan: 'free',
      retentionHours: RETENTION_HOURS,
      workspaceIds: [ids.workspaceId],
    })
    expect(await ledger(ids)).toEqual({ workspaceBytes: 0, payerBytes: 0 })
  })

  it('pauses the release while the base is deleted and resumes it after a restore', async () => {
    const ids = await seed()
    const rows = Array.from({ length: SOURCE_DOCUMENTS }, (_, index) =>
      sourceDocument(ids, (index % 7) + 1)
    )
    const keptBytes = rows.reduce((total, row) => total + row.fileSize, 0)
    await db.insert(document).values(rows)
    await disconnect(ids)
    const releasedDocuments = async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::integer` })
        .from(document)
        .where(and(eq(document.knowledgeBaseId, ids.knowledgeBaseId), isNull(document.connectorId)))
      return row.count
    }

    await db
      .update(knowledgeBase)
      .set({ deletedAt: new Date() })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    expect(await runDetachOnce(ids)).toBe('pending')
    expect(await releasedDocuments()).toBe(0)
    expect(await reservation(ids)).toBe(keptBytes)
    expect(await ledger(ids)).toEqual({ workspaceBytes: keptBytes, payerBytes: keptBytes })

    await db
      .update(knowledgeBase)
      .set({ deletedAt: null })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    /** The paused event rechecks an hour later; the worker would pick it up then. */
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date() })
      .where(
        and(
          eq(outboxEvent.eventType, KNOWLEDGE_CONNECTOR_DETACH_EVENT),
          sql`${outboxEvent.payload}->>'connectorId' = ${ids.connectorId}`
        )
      )
    expect(await runDetachOnce(ids)).toBe('pending')
    expect(await releasedDocuments()).toBeGreaterThan(0)
    expect(await ledger(ids)).toEqual({ workspaceBytes: keptBytes, payerBytes: keptBytes })
  })

  it('zeroes a refunded reservation so a detach run that still reaches the source refunds nothing', async () => {
    const ids = await seed()
    await manualDocument(ids, 29)
    const source = sourceDocument(ids, 37)
    await db.insert(document).values(source)

    await disconnect(ids)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 66, payerBytes: 66 })
    expect(await hardDeleteDocuments([source.id], generateId())).toBe(1)

    await settleDetachedConnectorReservations([ids.knowledgeBaseId], 'remaining')
    expect(await reservation(ids)).toBe(0)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 29, payerBytes: 29 })
    await settleDetachedConnectorReservations([ids.knowledgeBaseId], 'remaining')
    expect(await ledger(ids)).toEqual({ workspaceBytes: 29, payerBytes: 29 })

    await drainConnectorEvent(ids.connectorId, KNOWLEDGE_CONNECTOR_DETACH_EVENT)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 29, payerBytes: 29 })
  })

  it('charges an overdrawn reservation once, as the detach job would', async () => {
    const ids = await seed()
    await manualDocument(ids, 29)
    await disconnect(ids)
    /** Released bytes beyond what removal charged, e.g. a document that grew before its release. */
    await db
      .update(knowledgeConnector)
      .set({ detachReservedBytes: -7 })
      .where(eq(knowledgeConnector.id, ids.connectorId))

    await settleDetachedConnectorReservations([ids.knowledgeBaseId], 'remaining')
    expect(await reservation(ids)).toBe(0)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 36, payerBytes: 36 })

    await drainConnectorEvent(ids.connectorId, KNOWLEDGE_CONNECTOR_DETACH_EVENT)
    expect(await ledger(ids)).toEqual({ workspaceBytes: 36, payerBytes: 36 })
  })
})
