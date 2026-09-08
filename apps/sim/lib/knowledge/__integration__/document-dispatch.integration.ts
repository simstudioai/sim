import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeDocumentDispatch,
  knowledgeDocumentDispatchOwner,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ trigger: vi.fn(), retrieve: vi.fn() }))
vi.mock('@trigger.dev/sdk', () => ({
  tasks: { trigger: transport.trigger },
  runs: { retrieve: transport.retrieve },
}))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: async () => 'us-east-1' }))

import {
  claimDocumentProcessingDispatches,
  completeDocumentProcessingDispatch,
  DOCUMENT_DISPATCH_MAX_OUTSTANDING,
  DOCUMENT_DISPATCH_OWNER_OUTSTANDING,
  dispatchQueuedDocumentProcessing,
  documentDispatchIdempotencyKey,
  documentDispatchOwnerKey,
  enqueueDocumentProcessingContinuation,
  enqueueDocumentProcessingDispatch,
} from '@/lib/knowledge/documents/processing-dispatch-queue'
import {
  createCanonicalDocumentProcessingPayload,
  createDocumentProcessingPayload,
  type DocumentProcessingBillingContext,
  type DocumentProcessingPayload,
} from '@/lib/knowledge/documents/processing-payload'

describe('durable fair document admission', () => {
  const fixtureUsers: string[] = []
  const fixtureOrganizations: string[] = []
  const fixtureWorkspaces: string[] = []
  const fixtureBases: string[] = []
  const fixtureOwners: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    transport.trigger.mockImplementation(async () => ({ id: `run_${generateId()}` }))
    transport.retrieve.mockResolvedValue({ isCompleted: false })
  })

  afterEach(async () => {
    if (fixtureBases.length) {
      await db
        .delete(knowledgeDocumentDispatch)
        .where(inArray(knowledgeDocumentDispatch.knowledgeBaseId, fixtureBases))
      await db.delete(knowledgeBase).where(inArray(knowledgeBase.id, fixtureBases))
    }
    if (fixtureOwners.length)
      await db
        .delete(knowledgeDocumentDispatchOwner)
        .where(inArray(knowledgeDocumentDispatchOwner.ownerKey, fixtureOwners))
    if (fixtureWorkspaces.length)
      await db.delete(workspace).where(inArray(workspace.id, fixtureWorkspaces))
    if (fixtureOrganizations.length)
      await db.delete(organization).where(inArray(organization.id, fixtureOrganizations))
    if (fixtureUsers.length) await db.delete(user).where(inArray(user.id, fixtureUsers))
    fixtureUsers.length =
      fixtureOrganizations.length =
      fixtureWorkspaces.length =
      fixtureBases.length =
      fixtureOwners.length =
        0
  })

  async function createSource(kind: 'organization' | 'workspace' | 'personal' = 'organization') {
    const actorUserId = generateId()
    const organizationId = kind === 'organization' ? generateId() : null
    const workspaceId = kind === 'workspace' ? generateId() : null
    const knowledgeBaseId = generateId()
    fixtureUsers.push(actorUserId)
    fixtureBases.push(knowledgeBaseId)
    await db.insert(user).values({
      id: actorUserId,
      name: 'Dispatch fixture',
      email: `${actorUserId}@fixture.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    if (organizationId) {
      fixtureOrganizations.push(organizationId)
      await db
        .insert(organization)
        .values({ id: organizationId, name: 'Dispatch fixture', slug: organizationId })
    }
    if (workspaceId) {
      fixtureWorkspaces.push(workspaceId)
      await db.insert(workspace).values({
        id: workspaceId,
        name: 'Dispatch fixture',
        ownerId: actorUserId,
        billedAccountUserId: actorUserId,
      })
    }
    await db.insert(knowledgeBase).values({
      id: knowledgeBaseId,
      userId: actorUserId,
      organizationId,
      workspaceId,
      name: 'Dispatch fixture',
    })
    const billingAttribution = {
      actorUserId,
      organizationId,
      workspaceId,
      billedAccountUserId: actorUserId,
      billingEntity: organizationId
        ? { type: 'organization' as const, id: organizationId }
        : { type: 'user' as const, id: actorUserId },
      billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
      payerSubscription: null,
    }
    const context: DocumentProcessingBillingContext = organizationId
      ? {
          billingScope: 'organization',
          actorUserId,
          organizationId,
          workspaceId: null,
          billingAttribution,
        }
      : workspaceId
        ? { billingScope: 'workspace', actorUserId, workspaceId, billingAttribution }
        : { billingScope: 'non-workspace', actorUserId, workspaceId: null }
    const ownerKey = organizationId
      ? `organization:${organizationId}`
      : workspaceId
        ? `workspace:${workspaceId}`
        : `user:${actorUserId}`
    fixtureOwners.push(ownerKey)
    return { knowledgeBaseId, context, ownerKey }
  }

  async function createDocuments(source: Awaited<ReturnType<typeof createSource>>, count: number) {
    const payloads: DocumentProcessingPayload[] = []
    const rows: (typeof document.$inferInsert)[] = []
    for (let index = 0; index < count; index++) {
      const documentId = generateId()
      const requestId = generateId()
      const processingQueuedAt = new Date()
      const docData = {
        filename: `Fixture ${index}.txt`,
        fileUrl: '/api/files/serve/kb%2Ffixture',
        fileSize: 12,
        mimeType: 'text/plain',
      }
      rows.push({
        id: documentId,
        knowledgeBaseId: source.knowledgeBaseId,
        ...docData,
        processingStatus: 'pending',
        processingQueuedAt,
        processingQueueToken: requestId,
      })
      payloads.push(
        createDocumentProcessingPayload(
          {
            knowledgeBaseId: source.knowledgeBaseId,
            documentId,
            requestId,
            processingQueueToken: requestId,
            processingQueuedAt: processingQueuedAt.toISOString(),
            chargedAtDispatch: true,
            docData,
            processingOptions: {},
          },
          source.context
        )
      )
    }
    for (let offset = 0; offset < rows.length; offset += 500) {
      await db.insert(document).values(rows.slice(offset, offset + 500))
    }
    return payloads
  }

  it('enforces owner and global outstanding budgets under concurrent claimers', async () => {
    const sources = await Promise.all([createSource(), createSource(), createSource()])
    for (const source of sources)
      await enqueueDocumentProcessingDispatch(await createDocuments(source, 30))
    await Promise.all(Array.from({ length: 6 }, () => claimDocumentProcessingDispatches()))
    const active = await db
      .select()
      .from(knowledgeDocumentDispatch)
      .where(isNotNull(knowledgeDocumentDispatch.dispatchedAt))
    expect(active).toHaveLength(DOCUMENT_DISPATCH_MAX_OUTSTANDING)
    for (const source of sources) {
      const count = active.filter((row) => row.ownerKey === source.ownerKey).length
      expect(count).toBeGreaterThan(0)
      expect(count).toBeLessThanOrEqual(DOCUMENT_DISPATCH_OWNER_OUTSTANDING)
    }
  })

  it('lets one owner use available workers without queuing its entire corpus ahead of a newcomer', async () => {
    const large = await createSource()
    await enqueueDocumentProcessingDispatch(await createDocuments(large, 10_000))
    await claimDocumentProcessingDispatches()
    const newcomer = await createSource()
    const [newDocument] = await createDocuments(newcomer, 1)
    await enqueueDocumentProcessingDispatch([newDocument])
    await claimDocumentProcessingDispatches()
    const active = await db
      .select()
      .from(knowledgeDocumentDispatch)
      .where(isNotNull(knowledgeDocumentDispatch.dispatchedAt))
    expect(active.filter((row) => row.ownerKey === large.ownerKey)).toHaveLength(
      DOCUMENT_DISPATCH_OWNER_OUTSTANDING
    )
    expect(active.some((row) => row.documentId === newDocument.documentId)).toBe(true)
  })

  it('keeps inline document bytes out of durable intents and Trigger requests', async () => {
    const source = await createSource()
    const [payload] = await createDocuments(source, 1)
    const fileUrl = `data:text/plain;base64,${'a'.repeat(10 * 1024 * 1024 - 64)}`
    payload.docData.fileUrl = fileUrl
    await db.update(document).set({ fileUrl }).where(eq(document.id, payload.documentId))
    await enqueueDocumentProcessingDispatch([payload])
    const [claimed] = await claimDocumentProcessingDispatches()
    expect(claimed.payload).toEqual(createCanonicalDocumentProcessingPayload(payload))
    expect(JSON.stringify(claimed).length).toBeLessThan(3000)
    expect(await dispatchQueuedDocumentProcessing()).toEqual({ dispatched: 1 })
    const [, transmitted] = transport.trigger.mock.calls.find(
      ([name]) => name === 'knowledge-process-document'
    )!
    expect(JSON.stringify(transmitted).length).toBeLessThan(2000)
    expect(transmitted).not.toHaveProperty('docData')
    const [persisted] = await db
      .select({ fileUrlLength: sql<number>`length(${document.fileUrl})::int` })
      .from(document)
      .where(eq(document.id, payload.documentId))
    expect(persisted.fileUrlLength).toBe(fileUrl.length)
  })

  it('bounds stale pruning per owner and rotates stale-only owners ahead of the next pump', async () => {
    const staleOwners = []
    for (let index = 0; index < DOCUMENT_DISPATCH_MAX_OUTSTANDING; index++) {
      const source = await createSource()
      staleOwners.push(source)
      const payloads = await createDocuments(source, DOCUMENT_DISPATCH_OWNER_OUTSTANDING + 5)
      await enqueueDocumentProcessingDispatch(payloads)
      await db
        .update(document)
        .set({ deletedAt: new Date() })
        .where(eq(document.knowledgeBaseId, source.knowledgeBaseId))
    }
    const newcomer = await createSource()
    const [payload] = await createDocuments(newcomer, 1)
    await enqueueDocumentProcessingDispatch([payload])
    expect(await claimDocumentProcessingDispatches()).toEqual([])
    const [{ remaining }] = await db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(knowledgeDocumentDispatch)
      .where(
        inArray(
          knowledgeDocumentDispatch.ownerKey,
          staleOwners.map((owner) => owner.ownerKey)
        )
      )
    expect(remaining).toBe(DOCUMENT_DISPATCH_MAX_OUTSTANDING * 5)
    const rotated = await db
      .select({ at: knowledgeDocumentDispatchOwner.lastDispatchedAt })
      .from(knowledgeDocumentDispatchOwner)
      .where(
        inArray(
          knowledgeDocumentDispatchOwner.ownerKey,
          staleOwners.map((owner) => owner.ownerKey)
        )
      )
    expect(rotated.every((owner) => owner.at !== null)).toBe(true)
    expect(
      (await claimDocumentProcessingDispatches()).some(
        (intent) => intent.documentId === payload.documentId
      )
    ).toBe(true)
  })

  it('records terminal cancellation only for its current generation and preserves a newer continuation', async () => {
    const source = await createSource()
    const [cancelled, superseded] = await createDocuments(source, 2)
    await enqueueDocumentProcessingDispatch([cancelled, superseded])
    const newerAt = new Date(Date.now() + 60_000)
    await db
      .update(document)
      .set({ processingQueuedAt: newerAt })
      .where(eq(document.id, superseded.documentId))
    await completeDocumentProcessingDispatch(cancelled, { failed: true })
    await completeDocumentProcessingDispatch(superseded, { failed: true })
    const rows = await db
      .select({ id: document.id, status: document.processingStatus })
      .from(document)
      .where(inArray(document.id, [cancelled.documentId, superseded.documentId]))
    expect(rows.find((row) => row.id === cancelled.documentId)?.status).toBe('failed')
    expect(rows.find((row) => row.id === superseded.documentId)?.status).toBe('pending')
  })

  it.each(['workspace', 'personal'] as const)(
    'keeps canonical %s ownership and payload intact',
    async (kind) => {
      const source = await createSource(kind)
      const [payload] = await createDocuments(source, 1)
      expect(await enqueueDocumentProcessingDispatch([payload])).toEqual(
        new Set([payload.documentId])
      )
      const [intent] = await db
        .select()
        .from(knowledgeDocumentDispatch)
        .where(eq(knowledgeDocumentDispatch.documentId, payload.documentId))
      expect(intent.ownerKey).toBe(source.ownerKey)
      expect(intent.payload).toEqual(createCanonicalDocumentProcessingPayload(payload))
      expect(documentDispatchOwnerKey(payload)).toBe(source.ownerKey)
    }
  )

  it('rejects another canonical owner even when the supplied billing snapshot is internally consistent', async () => {
    const first = await createSource()
    const other = await createSource()
    const [payload] = await createDocuments(first, 1)
    const wrongOwner = createDocumentProcessingPayload(payload, other.context)
    await expect(enqueueDocumentProcessingDispatch([wrongOwner])).rejects.toThrow(
      'owner does not match'
    )
    expect(await db.select().from(knowledgeDocumentDispatch)).toEqual([])
  })

  it('deduplicates a delayed continuation and releases only the prior generation', async () => {
    const source = await createSource()
    const [payload] = await createDocuments(source, 1)
    await enqueueDocumentProcessingDispatch([payload])
    await claimDocumentProcessingDispatches()
    await db
      .update(document)
      .set({ processingStatus: 'processing' })
      .where(eq(document.id, payload.documentId))
    const continuation = { ...payload, admissionRetryCount: 1 }
    const firstDate = new Date(Date.now() + 60_000)
    const stored = await enqueueDocumentProcessingContinuation(continuation, firstDate)
    const duplicate = await enqueueDocumentProcessingContinuation(
      continuation,
      new Date(firstDate.getTime() + 2000)
    )
    expect(duplicate).toEqual(stored)
    await db
      .update(document)
      .set({
        processingStatus: 'pending',
        processingQueuedAt: stored,
        processingDeferredUntil: stored,
      })
      .where(eq(document.id, payload.documentId))
    await completeDocumentProcessingDispatch(payload)
    const rows = await db
      .select()
      .from(knowledgeDocumentDispatch)
      .where(eq(knowledgeDocumentDispatch.documentId, payload.documentId))
    expect(rows).toHaveLength(1)
    expect(rows[0].idempotencyKey).toBe(documentDispatchIdempotencyKey(continuation))
    expect(await claimDocumentProcessingDispatches()).toEqual([])
    await db
      .update(knowledgeDocumentDispatch)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(knowledgeDocumentDispatch.id, rows[0].id))
    expect(await claimDocumentProcessingDispatches()).toHaveLength(1)
  })

  it('does not admit deleted or superseded queued generations', async () => {
    const source = await createSource()
    const [superseded, deleted] = await createDocuments(source, 2)
    await enqueueDocumentProcessingDispatch([superseded, deleted])
    await db
      .update(document)
      .set({ processingQueueToken: generateId() })
      .where(eq(document.id, superseded.documentId))
    await db
      .update(document)
      .set({ deletedAt: new Date() })
      .where(eq(document.id, deleted.documentId))
    expect(await claimDocumentProcessingDispatches()).toEqual([])
    expect(await enqueueDocumentProcessingDispatch([superseded])).toEqual(new Set())
  })

  it('retains reservations when Trigger acceptance is unknown and retries the identical key', async () => {
    const source = await createSource()
    const [payload] = await createDocuments(source, 1)
    await enqueueDocumentProcessingDispatch([payload])
    transport.trigger.mockRejectedValueOnce(new Error('fixture connection reset after acceptance'))
    expect(await dispatchQueuedDocumentProcessing()).toEqual({ dispatched: 0 })
    const [reserved] = await db
      .select()
      .from(knowledgeDocumentDispatch)
      .where(eq(knowledgeDocumentDispatch.documentId, payload.documentId))
    expect(reserved.dispatchedAt).not.toBeNull()
    expect(reserved.triggerRunId).toBeNull()
    expect(await dispatchQueuedDocumentProcessing()).toEqual({ dispatched: 1 })
    const calls = transport.trigger.mock.calls.filter(
      ([name]) => name === 'knowledge-process-document'
    )
    expect(calls).toHaveLength(2)
    expect(calls[0][2].idempotencyKey).toBe(calls[1][2].idempotencyKey)
    expect(calls.every(([, , options]) => !options.queue && !options.concurrencyKey)).toBe(true)
  })

  it.each(['live', 'unavailable'] as const)(
    'reconciles newer completed runs when the oldest ten remain %s',
    async (oldestState) => {
      const source = await createSource()
      const payloads = await createDocuments(source, 12)
      await enqueueDocumentProcessingDispatch(payloads)
      await dispatchQueuedDocumentProcessing()
      const oldIds = payloads.slice(0, 10).map((payload) => payload.documentId)
      const oldStamp = new Date(Date.now() - 21 * 60_000)
      await db
        .update(knowledgeDocumentDispatch)
        .set({ dispatchedAt: new Date(Date.now() - 20 * 60_000) })
        .where(eq(knowledgeDocumentDispatch.knowledgeBaseId, source.knowledgeBaseId))
      await db
        .update(knowledgeDocumentDispatch)
        .set({ dispatchedAt: oldStamp })
        .where(inArray(knowledgeDocumentDispatch.documentId, oldIds))
      const oldest = await db
        .select({ runId: knowledgeDocumentDispatch.triggerRunId })
        .from(knowledgeDocumentDispatch)
        .where(inArray(knowledgeDocumentDispatch.documentId, oldIds))
      const oldRunIds = new Set(oldest.map((intent) => intent.runId))
      transport.retrieve.mockImplementation(async (runId: string) => {
        if (oldRunIds.has(runId)) {
          if (oldestState === 'unavailable')
            throw new Error('Fixture status temporarily unavailable')
          return { isCompleted: false }
        }
        return { isCompleted: true }
      })
      await dispatchQueuedDocumentProcessing()
      const retained = await db
        .select({
          id: knowledgeDocumentDispatch.documentId,
          at: knowledgeDocumentDispatch.dispatchedAt,
        })
        .from(knowledgeDocumentDispatch)
        .where(eq(knowledgeDocumentDispatch.knowledgeBaseId, source.knowledgeBaseId))
      expect(retained).toHaveLength(10)
      expect(
        retained.every(
          (intent) => oldIds.includes(intent.id) && intent.at?.getTime() === oldStamp.getTime()
        )
      ).toBe(true)
      expect(transport.retrieve).toHaveBeenCalledTimes(12)
    }
  )

  it('repairs missed terminal hooks but preserves a live retry reservation', async () => {
    const source = await createSource()
    const payloads = await createDocuments(source, 2)
    await enqueueDocumentProcessingDispatch(payloads)
    await dispatchQueuedDocumentProcessing()
    await db
      .update(knowledgeDocumentDispatch)
      .set({ dispatchedAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(knowledgeDocumentDispatch.knowledgeBaseId, source.knowledgeBaseId))
    transport.retrieve
      .mockResolvedValueOnce({ isCompleted: true })
      .mockResolvedValueOnce({ isCompleted: false })
    await dispatchQueuedDocumentProcessing()
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeDocumentDispatch)
      .where(
        and(
          eq(knowledgeDocumentDispatch.knowledgeBaseId, source.knowledgeBaseId),
          isNotNull(knowledgeDocumentDispatch.dispatchedAt)
        )
      )
    expect(count).toBe(1)
  })
})
