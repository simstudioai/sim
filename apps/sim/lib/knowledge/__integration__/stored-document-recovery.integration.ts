/** Real recovery admission, outbox delivery, stored bytes, indexing, and authorized search. */
import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  embedding,
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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  root: '',
  embeddingCalls: 0,
  useTrigger: false,
  listRuns: vi.fn(),
  batchTrigger: vi.fn(),
}))
vi.mock('@/lib/core/config/trigger-runtime', () => ({
  isInsideTriggerRun: () => fixture.useTrigger,
}))
vi.mock('@trigger.dev/core/v3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@trigger.dev/core/v3')>()),
  apiClientManager: {
    clientOrThrow: () => ({ baseUrl: 'https://api.trigger.dev', getHeaders: () => ({}) }),
  },
}))
vi.mock('@trigger.dev/core/v3/zodfetch', () => ({
  zodfetchCursorPage: (_schema: unknown, _url: string, params: { query: URLSearchParams }) =>
    fixture.listRuns({ tag: params.query.get('filter[tag]') }),
}))
vi.mock('@trigger.dev/sdk', async (importOriginal) => {
  const original = await importOriginal<typeof import('@trigger.dev/sdk')>()
  return {
    ...original,
    tasks: { ...original.tasks, batchTrigger: fixture.batchTrigger },
  }
})
vi.mock('@/lib/core/async-jobs/region', () => ({
  resolveTriggerRegion: async () => 'us-east-1',
}))
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
import { sweepStuckDocuments } from '@/lib/knowledge/connectors/sync-primitives'
import { DEFERRED_RETRY_LOST_ERROR } from '@/lib/knowledge/documents/deferred-retry-check'
import {
  enqueueKnowledgeDocumentProcessing,
  KNOWLEDGE_DOCUMENT_DEFERRED_RETRY_CHECK_EVENT,
} from '@/lib/knowledge/documents/processing-outbox-event'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'
import {
  DOCUMENT_RECOVERY_BATCH_SIZE,
  KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT,
  recoverKnowledgeDocumentProcessing,
} from '@/lib/knowledge/documents/processing-recovery'
import {
  processDocumentAsync,
  processDocumentsWithQueue,
  retryDocumentProcessing,
} from '@/lib/knowledge/documents/service'
import { MAX_PROCESSING_ATTEMPTS, QUEUED_DISPATCH_GRACE_MS } from '@/lib/knowledge/documents/types'
import type { SyncResult } from '@/connectors/types'

const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
const old = () => new Date(Date.now() - QUEUED_DISPATCH_GRACE_MS - 60_000)
async function seed() {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
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
    'google_drive',
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

afterEach(() => {
  fixture.useTrigger = false
  fixture.listRuns.mockReset()
  fixture.batchTrigger.mockReset()
})

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

async function recoverFixture(
  ids: ReturnType<typeof createKnowledgeAclFixtureIds>,
  mode: 'independent' | 'connector'
) {
  if (mode === 'independent') return recoverKnowledgeDocumentProcessing()
  const result: SyncResult = {
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsSkipped: 0,
    docsFailed: 0,
    processingDispatch: { requested: 0, accepted: 0, failed: 0 },
  }
  await sweepStuckDocuments({
    connectorId: ids.connectorId,
    knowledgeBaseId: ids.knowledgeBaseId,
    syncStartedAt: new Date(),
    retryCutoff: new Date(Date.now() - 7 * 24 * 60 * 60_000),
    billingAttribution: await resolveSystemBillingAttribution(ids.workspaceId),
    result,
    lease: createContentSyncLease(ids.connectorId, ids.lockId),
  })
  return result.processingDispatch.requested
}

describe('independent recovery of retained connector documents', () => {
  it.each(['independent', 'connector'] as const)(
    '%s recovery preserves a job queued beyond the grace period',
    async (mode) => {
      const ids = await seed()
      const file = await failedFile(ids)
      await db
        .update(document)
        .set({ processingStatus: 'pending' })
        .where(eq(document.id, file.documentId))
      fixture.useTrigger = true
      fixture.listRuns.mockResolvedValue({
        data: [{ id: 'run-queued', status: 'QUEUED' }],
        hasNextPage: () => false,
      })
      expect(await recoverFixture(ids, mode)).toBe(0)
      const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(row.processingAttempts).toBe(1)
      expect(row.processingQueueToken).toBe('old-fixture-generation')
      expect(row.processingRecoveryAfter).not.toBeNull()
      expect(await eventsFor(ids)).toHaveLength(0)
      await db
        .update(knowledgeConnector)
        .set({ status: 'paused' })
        .where(eq(knowledgeConnector.id, ids.connectorId))
    }
  )

  it.each(['independent', 'connector'] as const)(
    '%s recovery rechecks the generation after its remote lookup',
    async (mode) => {
      const ids = await seed()
      const file = await failedFile(ids)
      fixture.useTrigger = true
      fixture.listRuns.mockImplementation(async () => {
        await db
          .update(document)
          .set({ processingQueueToken: 'replacement-generation' })
          .where(eq(document.id, file.documentId))
        return { data: [], hasNextPage: () => false }
      })
      expect(await recoverFixture(ids, mode)).toBe(0)
      const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(row.processingAttempts).toBe(1)
      expect(row.processingQueueToken).toBe('replacement-generation')
      expect(await eventsFor(ids)).toHaveLength(0)
      await db
        .update(knowledgeConnector)
        .set({ status: 'paused' })
        .where(eq(knowledgeConnector.id, ids.connectorId))
    }
  )

  it.each(['pending', 'processing'])(
    'does not replace an aged %s outbox continuation',
    async (status) => {
      const ids = await seed()
      const file = await failedFile(ids)
      const token = generateId()
      await db
        .update(document)
        .set({ processingQueueToken: token })
        .where(eq(document.id, file.documentId))
      await db.insert(outboxEvent).values({
        id: token,
        eventType: 'knowledge.document.processing.resume',
        payload: { knowledgeBaseId: ids.knowledgeBaseId, documentId: file.documentId },
        status,
        availableAt: old(),
      })
      expect(await recoverFixture(ids, 'independent')).toBe(0)
      expect(await recoverFixture(ids, 'connector')).toBe(0)
      const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(row.processingAttempts).toBe(1)
      expect(row.processingQueueToken).toBe(token)
    }
  )

  it.each(['manual', 'redelivery'])(
    'respects a concurrent liveness cooldown before %s replacement',
    async (path) => {
      const ids = await seed()
      const file = await failedFile(ids)
      await db
        .update(document)
        .set({ processingStatus: 'pending' })
        .where(eq(document.id, file.documentId))
      const [original] = await db.select().from(document).where(eq(document.id, file.documentId))
      const protectedUntil = new Date(Date.now() + 60_000)
      fixture.useTrigger = true
      fixture.batchTrigger.mockResolvedValue({ batchId: 'fixture-batch' })
      fixture.listRuns.mockImplementation(async () => {
        await db
          .update(document)
          .set({ processingRecoveryAfter: protectedUntil })
          .where(eq(document.id, file.documentId))
        return { data: [], hasNextPage: () => false }
      })
      const billing = await resolveSystemBillingAttribution(ids.workspaceId)
      const docData = {
        documentId: file.documentId,
        filename: original.filename,
        fileUrl: original.fileUrl,
        fileSize: original.fileSize,
        mimeType: original.mimeType,
      }
      if (path === 'manual') {
        const result = await retryDocumentProcessing(
          ids.knowledgeBaseId,
          file.documentId,
          docData,
          generateId(),
          billing
        )
        expect(result.message).toContain('already queued')
      } else {
        const result = await processDocumentsWithQueue(
          [docData],
          ids.knowledgeBaseId,
          {},
          generateId(),
          billing,
          'interactive'
        )
        expect(result).toMatchObject({ accepted: 0, failed: 1 })
      }
      expect(fixture.batchTrigger).not.toHaveBeenCalled()
      const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(row.processingQueueToken).toBe(original.processingQueueToken)
      expect(row.processingAttempts).toBe(1)
      expect(row.processingRecoveryAfter).toEqual(protectedUntil)
      await db
        .update(knowledgeConnector)
        .set({ status: 'paused' })
        .where(eq(knowledgeConnector.id, ids.connectorId))
    }
  )

  it.each([null, 'abandoned-generation'])(
    'redelivers an abandoned upload with token %s without spending another admission',
    async (processingQueueToken) => {
      const ids = await seed()
      const file = await failedFile(ids)
      const queuedAt = old()
      await db
        .update(document)
        .set({
          connectorId: null,
          processingStatus: 'pending',
          processingQueueToken,
          processingQueuedAt: queuedAt,
          processingCompletedAt: null,
        })
        .where(eq(document.id, file.documentId))
      const eventId = await enqueueKnowledgeDocumentProcessing(db, {
        knowledgeBaseId: ids.knowledgeBaseId,
        documentId: file.documentId,
        processingOptions: {},
        billingAttribution: await resolveSystemBillingAttribution(ids.workspaceId),
        processingLane: 'interactive',
      })
      fixture.useTrigger = true
      fixture.listRuns.mockResolvedValue({ data: [], hasNextPage: () => false })
      fixture.batchTrigger.mockResolvedValue({ batchId: 'fixture-batch' })
      expect(
        await outbox.processOutboxEventById(eventId, knowledgeDocumentProcessingOutboxHandlers)
      ).toBe('completed')
      expect(fixture.batchTrigger).toHaveBeenCalledOnce()
      expect(fixture.batchTrigger.mock.calls[0][1][0].payload).toMatchObject({
        documentId: file.documentId,
        processingQueueToken: eventId,
        processingQueuedAt: queuedAt.toISOString(),
        chargedAtDispatch: false,
      })
      const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(row.processingQueueToken).toBe(eventId)
      expect(row.processingAttempts).toBe(1)
    }
  )

  it.each(['live', 'unknown', 'race'])(
    'does not adopt a legacy upload when its processing is %s',
    async (state) => {
      const ids = await seed()
      const file = await failedFile(ids)
      await db
        .update(document)
        .set({
          connectorId: null,
          processingStatus: 'pending',
          processingQueueToken: null,
          processingCompletedAt: null,
        })
        .where(eq(document.id, file.documentId))
      const eventId = await enqueueKnowledgeDocumentProcessing(db, {
        knowledgeBaseId: ids.knowledgeBaseId,
        documentId: file.documentId,
        processingOptions: {},
        billingAttribution: await resolveSystemBillingAttribution(ids.workspaceId),
        processingLane: 'interactive',
      })
      fixture.useTrigger = true
      if (state === 'unknown')
        fixture.listRuns.mockRejectedValue(new Error('Synthetic lookup failure'))
      else if (state === 'live')
        fixture.listRuns.mockResolvedValue({
          data: [{ status: 'QUEUED' }],
          hasNextPage: () => false,
        })
      else
        fixture.listRuns.mockImplementation(async () => {
          await db
            .update(document)
            .set({ processingQueueToken: 'winning-generation', processingQueuedAt: new Date() })
            .where(eq(document.id, file.documentId))
          return { data: [], hasNextPage: () => false }
        })
      expect(
        await outbox.processOutboxEventById(eventId, knowledgeDocumentProcessingOutboxHandlers)
      ).toBe(state === 'live' ? 'completed' : 'pending')
      expect(fixture.batchTrigger).not.toHaveBeenCalled()
      const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(row.processingQueueToken).toBe(state === 'race' ? 'winning-generation' : null)
      expect(row.processingAttempts).toBe(1)
    }
  )

  it.each(['QUEUED', 'DELAYED', 'WAITING'])(
    'preserves a seven-hour %s run and its existing attempt',
    async (status) => {
      const ids = await seed()
      const file = await failedFile(ids)
      const queuedAt = new Date(Date.now() - 7 * 60 * 60_000)
      await db
        .update(document)
        .set({
          processingStatus: 'pending',
          processingQueuedAt: queuedAt,
          processingCompletedAt: null,
        })
        .where(eq(document.id, file.documentId))
      fixture.useTrigger = true
      fixture.listRuns.mockResolvedValue({ data: [{ status }], hasNextPage: () => false })
      expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
      const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(row).toMatchObject({
        processingStatus: 'pending',
        processingAttempts: 1,
        processingQueueToken: 'old-fixture-generation',
        processingQueuedAt: queuedAt,
      })
      expect(row.processingRecoveryAfter!.getTime()).toBeGreaterThan(Date.now())
      expect(await eventsFor(ids)).toHaveLength(0)
      await db
        .update(knowledgeConnector)
        .set({ status: 'paused' })
        .where(eq(knowledgeConnector.id, ids.connectorId))
    }
  )

  it.each(['pending', 'processing'])(
    'preserves a %s outbox carrier without replacing its generation',
    async (status) => {
      const ids = await seed()
      const file = await failedFile(ids)
      const token = generateId()
      await db
        .update(document)
        .set({ processingStatus: 'pending', processingQueueToken: token })
        .where(eq(document.id, file.documentId))
      await db.insert(outboxEvent).values({
        id: token,
        status,
        eventType: 'knowledge.document.processing',
        payload: { knowledgeBaseId: ids.knowledgeBaseId },
      })
      expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
      const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(row.processingQueueToken).toBe(token)
      expect(row.processingAttempts).toBe(1)
      expect(await eventsFor(ids)).toHaveLength(0)
      await db
        .update(knowledgeConnector)
        .set({ status: 'paused' })
        .where(eq(knowledgeConnector.id, ids.connectorId))
    }
  )

  it.each(['processing', 'completed', 'pending'])(
    'does not replace a concurrent %s transition after inspecting work',
    async (status) => {
      const ids = await seed()
      const file = await failedFile(ids)
      fixture.useTrigger = true
      fixture.listRuns.mockImplementation(async () => {
        await db
          .update(document)
          .set({
            processingStatus: status,
            processingQueueToken: 'winning-generation',
            processingStartedAt: new Date(),
          })
          .where(eq(document.id, file.documentId))
        return { data: [], hasNextPage: () => false }
      })
      expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
      const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(row.processingQueueToken).toBe('winning-generation')
      expect(row.processingAttempts).toBe(1)
      expect(await eventsFor(ids)).toHaveLength(0)
      await db
        .update(knowledgeConnector)
        .set({ status: 'paused' })
        .where(eq(knowledgeConnector.id, ids.connectorId))
    }
  )

  it.each(['manual', 'connector'] as const)(
    'preserves live work through the %s retry path',
    async (path) => {
      const ids = await seed()
      const file = await failedFile(ids)
      await db
        .update(document)
        .set({ processingStatus: 'pending' })
        .where(eq(document.id, file.documentId))
      const [original] = await db.select().from(document).where(eq(document.id, file.documentId))
      fixture.useTrigger = true
      fixture.listRuns.mockResolvedValue({ data: [{ status: 'QUEUED' }], hasNextPage: () => false })
      const billing = await resolveSystemBillingAttribution(ids.workspaceId)
      if (path === 'manual') {
        const result = await retryDocumentProcessing(
          ids.knowledgeBaseId,
          file.documentId,
          {
            filename: original.filename,
            fileUrl: original.fileUrl,
            fileSize: original.fileSize,
            mimeType: original.mimeType,
          },
          generateId(),
          billing
        )
        expect(result.message).toContain('already queued')
      } else {
        const result = {
          docsAdded: 0,
          docsUpdated: 0,
          docsDeleted: 0,
          docsUnchanged: 0,
          docsSkipped: 0,
          docsFailed: 0,
          processingDispatch: { requested: 0, accepted: 0, failed: 0 },
        }
        await sweepStuckDocuments({
          connectorId: ids.connectorId,
          knowledgeBaseId: ids.knowledgeBaseId,
          syncStartedAt: new Date(),
          retryCutoff: new Date(Date.now() - 7 * 24 * 60 * 60_000),
          billingAttribution: billing,
          result,
          lease: createContentSyncLease(ids.connectorId, ids.lockId),
        })
        expect(result.processingDispatch.requested).toBe(0)
      }
      const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(row.processingAttempts).toBe(original.processingAttempts)
      expect(row.processingQueueToken).toBe(original.processingQueueToken)
      expect(await eventsFor(ids)).toHaveLength(0)
      await db
        .update(knowledgeConnector)
        .set({ status: 'paused' })
        .where(eq(knowledgeConnector.id, ids.connectorId))
    }
  )

  it('continues past a protected batch while its cooldown is active', async () => {
    const ids = await seed()
    const file = await failedFile(ids)
    const [original] = await db.select().from(document).where(eq(document.id, file.documentId))
    await db.insert(document).values(
      Array.from({ length: DOCUMENT_RECOVERY_BATCH_SIZE - 1 }, () => ({
        ...original,
        id: generateId(),
        externalId: generateId(),
        secretProvenanceVersion: null,
      }))
    )
    const abandoned = await failedFile(ids)
    await db
      .update(document)
      .set({ uploadedAt: new Date(original.uploadedAt.getTime() + 1) })
      .where(eq(document.id, abandoned.documentId))
    fixture.useTrigger = true
    fixture.listRuns.mockImplementation(async ({ tag }: { tag: string }) => ({
      data: tag === `documentId:${abandoned.documentId}` ? [] : [{ status: 'QUEUED' }],
      hasNextPage: () => false,
    }))
    expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
    expect(await recoverKnowledgeDocumentProcessing()).toBe(1)
    expect((await eventsFor(ids))[0].payload).toMatchObject({ documentId: abandoned.documentId })
    await db
      .update(knowledgeConnector)
      .set({ status: 'paused' })
      .where(eq(knowledgeConnector.id, ids.connectorId))
  })

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
          expect(await recoverKnowledgeDocumentProcessing()).toBe(1)
          expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
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

  it('recovers a sibling connector when the oldest candidate batch belongs to a locked connector', async () => {
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
    const healthy = { ...blocked, connectorId: generateId(), lockId: generateId() }
    await db.insert(knowledgeConnector).values({
      id: healthy.connectorId,
      knowledgeBaseId: healthy.knowledgeBaseId,
      connectorType: 'google_drive',
      sourceConfig: {},
      accessMode: 'admin',
      status: 'syncing',
      syncLockToken: healthy.lockId,
    })
    const healthyFile = await failedFile(healthy)
    await db
      .update(document)
      .set({ uploadedAt: new Date(original.uploadedAt.getTime() + 1) })
      .where(eq(document.id, healthyFile.documentId))

    let release!: () => void
    let acquired!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const locked = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const holder = db.transaction(async (tx) => {
      await tx
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, blocked.knowledgeBaseId))
        .for('share')
      await tx
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, blocked.connectorId))
        .for('update')
      acquired()
      await released
    })
    await locked
    try {
      expect(await recoverKnowledgeDocumentProcessing()).toBe(1)
      const events = await eventsFor(blocked)
      expect(events).toHaveLength(1)
      expect(events[0].payload).toMatchObject({ documentId: healthyFile.documentId })
      const [admitted] = await db
        .select()
        .from(document)
        .where(eq(document.id, healthyFile.documentId))
      expect(admitted.processingAttempts).toBe(2)
      expect(admitted.processingQueueToken).toBe(events[0].id)
      const untouched = await db
        .select()
        .from(document)
        .where(eq(document.connectorId, blocked.connectorId))
      expect(untouched).toHaveLength(DOCUMENT_RECOVERY_BATCH_SIZE)
      for (const row of untouched) {
        expect(row).toMatchObject({
          processingStatus: original.processingStatus,
          processingAttempts: original.processingAttempts,
          processingQueueToken: original.processingQueueToken,
          processingQueuedAt: original.processingQueuedAt,
          processingError: original.processingError,
          processingRecoveryAfter: original.processingRecoveryAfter,
        })
      }
    } finally {
      release()
      await holder
      await db
        .update(knowledgeConnector)
        .set({ status: 'paused' })
        .where(inArray(knowledgeConnector.id, [blocked.connectorId, healthy.connectorId]))
    }
  })

  it('recovers another document while an index transaction holds the same KB foreign-key lock', async () => {
    const ids = await seed()
    const file = await failedFile(ids)
    const indexedId = generateId()
    await db.insert(document).values({
      id: indexedId,
      knowledgeBaseId: ids.knowledgeBaseId,
      filename: 'Concurrent index.txt',
      fileUrl: 'data:text/plain,fixture',
      fileSize: 7,
      mimeType: 'text/plain',
      processingStatus: 'completed',
    })
    let release!: () => void
    let acquired!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const locked = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const indexing = db.transaction(async (tx) => {
      await tx.insert(embedding).values({
        id: generateId(),
        knowledgeBaseId: ids.knowledgeBaseId,
        documentId: indexedId,
        chunkIndex: 0,
        chunkHash: 'fixture',
        content: 'fixture',
        contentLength: 7,
        tokenCount: 1,
        startOffset: 0,
        endOffset: 7,
        embedding: [1, ...Array<number>(1535).fill(0)],
      })
      acquired()
      await released
    })
    await locked
    try {
      expect(await recoverKnowledgeDocumentProcessing()).toBe(1)
      expect(await eventsFor(ids)).toHaveLength(1)
      const [admitted] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(admitted.processingAttempts).toBe(2)
    } finally {
      release()
      await indexing
    }
  })

  it('does not claim work while a KB soft deletion is committing', async () => {
    const ids = await seed()
    const file = await failedFile(ids)
    let release!: () => void
    let acquired!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const locked = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const deletion = db.transaction(async (tx) => {
      await tx
        .update(knowledgeBase)
        .set({ deletedAt: new Date() })
        .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      acquired()
      await released
    })
    await locked
    try {
      expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
    } finally {
      release()
      await deletion
    }
    expect(await recoverKnowledgeDocumentProcessing()).toBe(0)
    expect(await eventsFor(ids)).toHaveLength(0)
    const [original] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(original.processingAttempts).toBe(1)
    expect(original.processingQueueToken).toBe('old-fixture-generation')
  })

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

describe('uploaded documents whose scheduled database retry is lost', () => {
  const GENERATION = 'deferred-upload-generation'

  async function retryChecksFor(documentId: string) {
    return db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, KNOWLEDGE_DOCUMENT_DEFERRED_RETRY_CHECK_EVENT),
          sql`${outboxEvent.payload}->>'documentId' = ${documentId}`
        )
      )
  }

  /** Throws once, right after the claim, the way a database capacity window fails a run. */
  function failNextRunAfterClaim(error: Error) {
    return vi
      .spyOn(billingAttribution, 'assertBillingAttributionOwner')
      .mockImplementationOnce(() => {
        throw error
      })
  }

  /** An uploaded document whose run hit a lock timeout and scheduled a retry of the same run. */
  async function deferredUpload(queuedAt: Date | null) {
    const ids = await seed()
    const file = await failedFile(ids)
    await db
      .update(document)
      .set({
        connectorId: null,
        processingStatus: 'pending',
        processingQueueToken: GENERATION,
        processingQueuedAt: queuedAt,
        processingCompletedAt: null,
        processingError: null,
        uploadedAt: new Date(),
      })
      .where(eq(document.id, file.documentId))
    const billing = await resolveSystemBillingAttribution(ids.workspaceId)
    const retryAt = new Date(Date.now() + 120_000)
    const runRetry = (options: { onClaimed?: () => void } = {}) =>
      processDocumentAsync(ids.knowledgeBaseId, file.documentId, file, {}, billing, GENERATION, {
        processingQueueToken: GENERATION,
        chargedAtDispatch: false,
        scheduleDatabaseRetry: () => retryAt,
        ...options,
      })
    const spy = failNextRunAfterClaim(
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
    )
    try {
      await expect(runRetry()).rejects.toMatchObject({ code: '55P03' })
    } finally {
      spy.mockRestore()
    }
    const [check] = await retryChecksFor(file.documentId)
    return { ids, file, billing, retryAt, check, runRetry }
  }

  async function runCheckAt(eventId: string, at: number) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at)
    try {
      return await outbox.processOutboxEventById(eventId, knowledgeDocumentProcessingOutboxHandlers)
    } finally {
      vi.useRealTimers()
    }
  }

  const overdue = (retryAt: Date) => retryAt.getTime() + QUEUED_DISPATCH_GRACE_MS + 60_000

  it('commits the deferral and its check together, due once the retry is past the grace', async () => {
    const { file, retryAt, check } = await deferredUpload(new Date())
    const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(row).toMatchObject({ processingStatus: 'pending', processingDeferredUntil: retryAt })
    expect(check.availableAt).toEqual(new Date(retryAt.getTime() + QUEUED_DISPATCH_GRACE_MS))
    expect(check.payload).toMatchObject({
      documentId: file.documentId,
      processingQueueToken: GENERATION,
      processingDeferredUntil: retryAt.toISOString(),
    })
    expect(
      await outbox.processOutboxEventById(check.id, knowledgeDocumentProcessingOutboxHandlers)
    ).toBe('pending')
  })

  it('fails the document once its scheduled retry is overdue and no run is live', async () => {
    const { file, retryAt, check } = await deferredUpload(new Date())
    expect(await runCheckAt(check.id, overdue(retryAt))).toBe('completed')
    const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(row).toMatchObject({
      processingStatus: 'failed',
      processingError: DEFERRED_RETRY_LOST_ERROR,
      processingDeferredUntil: null,
      processingQueueToken: GENERATION,
    })
    expect(row.processingCompletedAt).not.toBeNull()
  })

  it('checks again later, without spending an attempt, while the retry run is live', async () => {
    const { file, retryAt, check } = await deferredUpload(new Date())
    fixture.useTrigger = true
    fixture.listRuns.mockResolvedValue({
      data: [{ id: 'run-delayed', status: 'DELAYED' }],
      hasNextPage: () => false,
    })
    expect(await runCheckAt(check.id, overdue(retryAt))).toBe('pending')
    const [event] = await retryChecksFor(file.documentId)
    expect(event.attempts).toBe(0)
    const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(row).toMatchObject({ processingStatus: 'pending', processingDeferredUntil: retryAt })
  })

  it.each([
    ['claims', { processingStatus: 'processing', processingStartedAt: new Date() }],
    ['claims and re-defers', { processingDeferredUntil: new Date(Date.now() + 600_000) }],
  ] as const)(
    'never overwrites a retry that %s the document while the check inspects it',
    async (_label, change) => {
      const { file, retryAt, check } = await deferredUpload(new Date())
      fixture.useTrigger = true
      fixture.listRuns.mockImplementation(async () => {
        await db.update(document).set(change).where(eq(document.id, file.documentId))
        return { data: [], hasNextPage: () => false }
      })
      expect(await runCheckAt(check.id, overdue(retryAt))).toBe('completed')
      const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(row).toMatchObject(change)
      expect(row.processingStatus).not.toBe('failed')
    }
  )

  it('schedules no check for a connector document, which the recovery sweep covers', async () => {
    const ids = await seed()
    const file = await failedFile(ids)
    await db
      .update(document)
      .set({ processingStatus: 'pending', processingQueueToken: GENERATION })
      .where(eq(document.id, file.documentId))
    const spy = failNextRunAfterClaim(
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
    )
    try {
      await expect(
        processDocumentAsync(
          ids.knowledgeBaseId,
          file.documentId,
          file,
          {},
          await resolveSystemBillingAttribution(ids.workspaceId),
          GENERATION,
          {
            processingQueueToken: GENERATION,
            chargedAtDispatch: false,
            scheduleDatabaseRetry: () => new Date(Date.now() + 120_000),
          }
        )
      ).rejects.toMatchObject({ code: '55P03' })
    } finally {
      spy.mockRestore()
    }
    const [row] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(row.processingStatus).toBe('pending')
    expect(await retryChecksFor(file.documentId)).toHaveLength(0)
  })

  it('keeps a dispatch from claiming a deferred run that was never stamped, and the retry still claims it', async () => {
    const { ids, file, billing, retryAt, runRetry } = await deferredUpload(null)
    const [deferred] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(deferred.processingQueuedAt).toEqual(retryAt)

    await processDocumentsWithQueue(
      [
        {
          documentId: file.documentId,
          filename: deferred.filename,
          fileUrl: deferred.fileUrl,
          fileSize: deferred.fileSize,
          mimeType: deferred.mimeType,
        },
      ],
      ids.knowledgeBaseId,
      {},
      generateId(),
      billing,
      'interactive'
    )
    const [afterDispatch] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(afterDispatch).toMatchObject({
      processingStatus: 'pending',
      processingQueueToken: GENERATION,
      processingAttempts: deferred.processingAttempts,
      processingDeferredUntil: retryAt,
    })

    const onClaimed = vi.fn()
    const spy = failNextRunAfterClaim(new Error('Synthetic failure after the retry claimed'))
    try {
      await runRetry({ onClaimed }).catch(() => undefined)
    } finally {
      spy.mockRestore()
    }
    expect(onClaimed).toHaveBeenCalledTimes(1)
  })
})
