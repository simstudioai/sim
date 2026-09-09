/** Real recovery admission, outbox delivery, stored bytes, indexing, and authorized search. */
import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  member,
  organization,
  outboxEvent,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ root: '', embeddingCalls: 0 }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixture.root
  },
}))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => {
    fixture.embeddingCalls++
    return {
      embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
      totalTokens: texts.length,
      billableTokens: 0,
      isBYOK: true,
      modelName: 'text-embedding-3-small',
      pricingId: 'text-embedding-3-small',
    }
  },
}))

import * as billingAttribution from '@/lib/billing/core/billing-attribution'
import { resolveSystemBillingAttribution } from '@/lib/billing/core/billing-attribution'
import * as outbox from '@/lib/core/outbox/service'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { searchScopedKnowledge } from '@/lib/knowledge/application/workspace-search'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument } from '@/lib/knowledge/connectors/sync-persistence'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'
import {
  DOCUMENT_RECOVERY_BATCH_SIZE,
  KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT,
  recoverKnowledgeDocumentProcessing,
} from '@/lib/knowledge/documents/processing-recovery'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { MAX_PROCESSING_ATTEMPTS, QUEUED_DISPATCH_GRACE_MS } from '@/lib/knowledge/documents/types'

const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
const old = () => new Date(Date.now() - QUEUED_DISPATCH_GRACE_MS - 60_000)
async function seed() {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  await seedKnowledgeAclFixture(ids)
  return ids
}
async function eventsFor(ids: ReturnType<typeof createKnowledgeAclFixtureIds>) {
  return db
    .select()
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT),
        sql`${outboxEvent.payload}->>'knowledgeBaseId' = ${ids.knowledgeBaseId}`
      )
    )
}
async function failedFile(
  ids: ReturnType<typeof createKnowledgeAclFixtureIds>,
  organizationOwned = false
) {
  const file = await addDocument(
    ids.knowledgeBaseId,
    ids.connectorId,
    'confluence',
    {
      externalId: generateId(),
      title: 'Retained fixture.txt',
      content: 'Orion recovery retains the complete source and its authorized search visibility.',
      mimeType: 'text/plain',
      contentHash: 'fixture-retained-v1',
    },
    organizationOwned
      ? { userId: ids.aliceId, workspaceId: null, organizationId: ids.organizationId }
      : { userId: ids.aliceId, workspaceId: ids.workspaceId },
    undefined,
    'admin',
    createContentSyncLease(ids.connectorId, ids.lockId)
  )
  await db
    .update(document)
    .set({
      processingStatus: 'failed',
      processingAttempts: 1,
      uploadedAt: old(),
      processingCompletedAt: old(),
      processingQueuedAt: old(),
      processingQueueToken: 'old-fixture-generation',
      processingError: 'Synthetic prior provider admission timeout',
      acl: [`u:${ids.aliceId}@fixture.test`],
      aclVerifiedAt: new Date(),
    })
    .where(eq(document.id, file.documentId))
  return file
}

beforeAll(() => {
  fixture.root = mkdtempSync(path.join(tmpdir(), 'sim-stored-recovery-'))
})
afterAll(async () => {
  vi.restoreAllMocks()
  for (const ids of fixtures) {
    await db
      .delete(outboxEvent)
      .where(sql`${outboxEvent.payload}->>'knowledgeBaseId' = ${ids.knowledgeBaseId}`)
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  }
  await rm(fixture.root, { recursive: true, force: true })
  await db.$client.end()
})

describe('independent recovery of retained connector documents', () => {
  it('uses the organization owner and preserves Search visibility during source backoff', async () => {
    const ids = await seed()
    await db.insert(member).values({
      id: generateId(),
      organizationId: ids.organizationId,
      userId: ids.aliceId,
      role: 'owner',
    })
    await db
      .update(knowledgeBase)
      .set({ workspaceId: null, organizationId: ids.organizationId, isSearchIndex: true })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    const file = await failedFile(ids, true)
    await db
      .update(knowledgeConnector)
      .set({ status: 'error', nextSyncAt: new Date(Date.now() + 3_600_000) })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    expect(await recoverKnowledgeDocumentProcessing()).toBe(1)
    const [event] = await eventsFor(ids)
    expect(event.payload).toMatchObject({
      billingScope: 'organization',
      workspaceId: null,
      organizationId: ids.organizationId,
    })
    expect(
      await outbox.processOutboxEventById(event.id, knowledgeDocumentProcessingOutboxHandlers)
    ).toBe('completed')
    const [indexed] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(indexed.processingStatus, indexed.processingError ?? undefined).toBe('completed')
    const result = await searchScopedKnowledge.execute({
      principal: { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-session' },
      input: {
        organizationId: ids.organizationId,
        query: 'Orion',
        topK: 3,
      },
    })
    expect(result.results.some((row) => row.documentId === file.documentId)).toBe(true)
  })
  it('recovers while the source is deferred, fences its old worker, and indexes exactly once', async () => {
    const ids = await seed()
    const file = await failedFile(ids)
    const nextSyncAt = new Date(Date.now() + 3_600_000)
    await db
      .update(knowledgeConnector)
      .set({ status: 'error', nextSyncAt, lastSyncError: 'Waiting for provider capacity' })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    const results = await Promise.all([
      recoverKnowledgeDocumentProcessing(),
      recoverKnowledgeDocumentProcessing(),
    ])
    expect(results.reduce((sum, count) => sum + count, 0)).toBe(1)
    const events = await eventsFor(ids)
    expect(events).toHaveLength(1)
    const [admitted] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(admitted.processingAttempts).toBe(2)
    expect(admitted.processingQueueToken).toBe(events[0].id)
    const before = fixture.embeddingCalls
    await processDocumentAsync(
      ids.knowledgeBaseId,
      file.documentId,
      file,
      {},
      await resolveSystemBillingAttribution(ids.workspaceId),
      'old-fixture-generation',
      {
        processingQueueToken: 'old-fixture-generation',
        processingQueuedAt: old(),
        chargedAtDispatch: true,
      }
    )
    expect(fixture.embeddingCalls).toBe(before)
    expect(
      await outbox.processOutboxEventById(events[0].id, knowledgeDocumentProcessingOutboxHandlers)
    ).toBe('completed')
    expect(
      await outbox.processOutboxEventById(events[0].id, knowledgeDocumentProcessingOutboxHandlers)
    ).toBe('completed')
    expect(fixture.embeddingCalls).toBe(before + 1)
    const [indexed] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(indexed.processingStatus, indexed.processingError ?? undefined).toBe('completed')
    expect(indexed.processingAttempts).toBe(0)
    const [source] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, ids.connectorId))
    expect(source.nextSyncAt).toEqual(nextSyncAt)
    expect(source.status).toBe('error')
    for (const [userId, allowed] of [
      [ids.aliceId, true],
      [ids.bobId, false],
    ] as const) {
      const result = await searchKnowledge.execute({
        principal: { kind: 'session', userId, sessionId: 'fixture-session' },
        input: {
          workspaceId: ids.workspaceId,
          knowledgeBaseIds: [ids.knowledgeBaseId],
          query: 'Orion',
          searchMode: 'hybrid',
          topK: 10,
        },
      })
      expect(result.results.some((row) => row.documentId === file.documentId)).toBe(allowed)
    }
  })

  it('keeps permanent, excluded, paused, fresh, deferred, and expired work out of automatic recovery', async () => {
    const ids = await seed()
    const file = await failedFile(ids)
    const variants = [
      { processingAttempts: MAX_PROCESSING_ATTEMPTS },
      { userExcluded: true },
      { archivedAt: new Date() },
      { deletedAt: new Date() },
      { contentHash: null },
      { storageKey: null },
      { processingStatus: 'completed' },
      { processingStatus: 'pending', processingQueuedAt: new Date() },
      { processingStatus: 'pending', processingDeferredUntil: new Date(Date.now() + 60_000) },
      { processingStatus: 'processing', processingStartedAt: new Date() },
      { uploadedAt: new Date(Date.now() - 8 * 24 * 3_600_000) },
    ]
    const [original] = await db.select().from(document).where(eq(document.id, file.documentId))
    for (const variant of variants) {
      await db
        .update(document)
        .set({ ...original, ...variant })
        .where(eq(document.id, file.documentId))
      expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
    }
    await db.update(document).set(original).where(eq(document.id, file.documentId))
    await db
      .update(knowledgeConnector)
      .set({ status: 'paused' })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
    expect(await eventsFor(ids)).toEqual([])
  })

  it('rolls the generation and attempt back if durable enqueue fails', async () => {
    const ids = await seed()
    const file = await failedFile(ids)
    const enqueue = vi
      .spyOn(outbox, 'enqueueOutboxEvent')
      .mockRejectedValueOnce(new Error('Synthetic admission failure'))
    try {
      expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
    } finally {
      enqueue.mockRestore()
    }
    const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(row.processingQueueToken).toBe('old-fixture-generation')
    expect(row.processingAttempts).toBe(1)
    expect(row.processingStatus).toBe('failed')
    expect(await eventsFor(ids)).toEqual([])
    expect(row.processingRecoveryAfter).not.toBeNull()
    expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
    expect(await recoverKnowledgeDocumentProcessing(new Date(Date.now() + 16 * 60_000))).toBe(1)
  })

  it('drains a backlog over bounded ticks instead of loading or dispatching every document', async () => {
    const ids = await seed()
    const file = await failedFile(ids)
    const [original] = await db.select().from(document).where(eq(document.id, file.documentId))
    await db.insert(document).values(
      Array.from({ length: DOCUMENT_RECOVERY_BATCH_SIZE }, () => ({
        ...original,
        id: generateId(),
        externalId: generateId(),
        secretProvenanceVersion: null,
      }))
    )
    expect(await recoverKnowledgeDocumentProcessing()).toBe(DOCUMENT_RECOVERY_BATCH_SIZE)
    expect(await recoverKnowledgeDocumentProcessing()).toBe(1)
    expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
    expect(await eventsFor(ids)).toHaveLength(DOCUMENT_RECOVERY_BATCH_SIZE + 1)
  })

  it.each(['billing', 'lock'] as const)(
    'a %s-blocked oldest batch does not starve another owner',
    async (kind) => {
      const blocked = await seed()
      const file = await failedFile(blocked)
      const [original] = await db.select().from(document).where(eq(document.id, file.documentId))
      await db.insert(document).values(
        Array.from({ length: DOCUMENT_RECOVERY_BATCH_SIZE - 1 }, () => ({
          ...original,
          id: generateId(),
          externalId: generateId(),
          secretProvenanceVersion: null,
        }))
      )
      const healthy = await seed()
      await failedFile(healthy)
      if (kind === 'billing') {
        const resolve = billingAttribution.resolveSystemBillingAttribution
        const spy = vi
          .spyOn(billingAttribution, 'resolveSystemBillingAttribution')
          .mockImplementation((id) => {
            if (id === blocked.workspaceId) throw new Error('Synthetic payer unavailable')
            return resolve(id)
          })
        try {
          expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
          expect(await recoverKnowledgeDocumentProcessing()).toBe(1)
        } finally {
          spy.mockRestore()
        }
        const [deferred] = await db.select().from(document).where(eq(document.id, file.documentId))
        expect(deferred.processingAttempts).toBe(1)
        expect(deferred.processingError).toBe(original.processingError)
        expect(deferred.processingRecoveryAfter!.getTime()).toBeGreaterThan(Date.now())
      } else {
        let unlock!: () => void
        let locked!: () => void
        const release = new Promise<void>((resolve) => {
          unlock = resolve
        })
        const acquired = new Promise<void>((resolve) => {
          locked = resolve
        })
        const holder = db.transaction(async (tx) => {
          await tx
            .select({ id: knowledgeBase.id })
            .from(knowledgeBase)
            .where(eq(knowledgeBase.id, blocked.knowledgeBaseId))
            .for('update')
          locked()
          await release
        })
        await acquired
        try {
          expect(await recoverKnowledgeDocumentProcessing()).toBe(1)
        } finally {
          unlock()
          await holder
        }
        await db
          .update(knowledgeConnector)
          .set({ status: 'paused' })
          .where(eq(knowledgeConnector.id, blocked.connectorId))
      }
      expect(await eventsFor(blocked)).toHaveLength(0)
      expect(await eventsFor(healthy)).toHaveLength(1)
    }
  )

  it('replays the additive migration and leaves the concurrent recovery index valid', async () => {
    const migration = readFileSync(
      path.resolve(
        process.cwd(),
        '../../packages/db/migrations/0336_knowledge_processing_recovery.sql'
      ),
      'utf8'
    )
    const connection = await db.$client.reserve()
    try {
      for (let replay = 0; replay < 2; replay++) {
        for (const statement of migration.split('--> statement-breakpoint')) {
          if (statement.trim()) await connection.unsafe(statement)
        }
      }
      const [index] = await connection.unsafe<{ indisvalid: boolean }[]>(
        "SELECT indisvalid FROM pg_index WHERE indexrelid = 'doc_processing_recovery_idx'::regclass"
      )
      expect(index.indisvalid).toBe(true)
    } finally {
      connection.release()
    }
  })
})
