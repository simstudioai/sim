/** Real storage, token batching, provider admission, durable continuation, index swap and usage deduplication. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  organization,
  outboxEvent,
  usageLog,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { resetHostedEmbeddingFixtureAdmission } from '@/lib/knowledge/__integration__/provider-fixture-state'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument, persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'
import * as embeddingCheckpoints from '@/lib/knowledge/documents/embedding-checkpoints'
import { EMBEDDING_CHECKPOINT_CLEANUP_EVENT } from '@/lib/knowledge/documents/embedding-checkpoints'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'
import { assertDocumentProcessingPayload } from '@/lib/knowledge/documents/processing-payload'
import { processDocumentsWithQueue } from '@/lib/knowledge/documents/service'

describe('embedding progress survives a processing slice', () => {
  const ids = createKnowledgeAclFixtureIds()
  const previous = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    TRIGGER_SECRET_KEY: env.TRIGGER_SECRET_KEY,
  }
  const events: string[] = []
  const priorCheckpointIds = new Set<string>()
  beforeAll(async () => {
    await resetHostedEmbeddingFixtureAdmission()
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-embedding-progress-'))
    for (const row of await db
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(eq(outboxEvent.eventType, EMBEDDING_CHECKPOINT_CLEANUP_EVENT))
      .limit(5000))
      priorCheckpointIds.add(row.id)
    await seedKnowledgeAclFixture(ids)
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await resetHostedEmbeddingFixtureAdmission()
    Object.assign(env, previous)
    if (events.length) await db.delete(outboxEvent).where(inArray(outboxEvent.id, events))
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await db.$client.end()
  })
  it('resumes every completed provider batch, commits every chunk together and deduplicates its charge', async () => {
    Object.assign(env, {
      OPENAI_API_KEY: `fixture-openai-${generateId()}`,
      TRIGGER_SECRET_KEY: undefined,
    })
    const content = Array.from(
      { length: 600 },
      (_, index) =>
        `Orion record ${index}. ${`Testing migration dependency ${index} verified. `.repeat(50)}\n\n`
    ).join('')
    const file = await addDocument(
      ids.knowledgeBaseId,
      ids.connectorId,
      'confluence',
      {
        externalId: 'large-text',
        title: 'Synthetic operations.txt',
        content,
        mimeType: 'text/plain',
        contentHash: 'synthetic-text-v1',
      },
      { userId: ids.aliceId, workspaceId: ids.workspaceId },
      undefined,
      'workspace',
      createContentSyncLease(ids.connectorId, ids.lockId)
    )
    expect(
      await persistDocumentAcls(
        ids.connectorId,
        new Map([['large-text', [`u:${ids.aliceId}@fixture.test`]]])
      )
    ).toEqual({ updated: 1, rejected: 0 })
    const billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    const requestId = generateId()
    let suppliedVectors = 0
    let requests = 0
    let yieldProcessingSlice = true
    let admittedBatches = 0
    const checkpointRoundTrips: boolean[] = []
    const checkpointScopes: string[] = []
    const savedCheckpointKeys = new Set<string>()
    let resumedCheckpointReads = 0
    let resumedCheckpointHits = 0
    const createCheckpoints = embeddingCheckpoints.createEmbeddingCheckpoints
    vi.spyOn(embeddingCheckpoints, 'createEmbeddingCheckpoints').mockImplementation((options) => {
      const checkpoints = createCheckpoints(options)
      const { deadlineAt: _deadlineAt, ...scope } = options
      checkpointScopes.push(JSON.stringify(scope))
      return {
        ...checkpoints,
        async load(identity, signal) {
          const result = await checkpoints.load(identity, signal)
          if (!yieldProcessingSlice && savedCheckpointKeys.has(identity.key)) {
            resumedCheckpointReads++
            if (result) resumedCheckpointHits++
          }
          return result
        },
        async save(identity, result, signal) {
          await checkpoints.save(identity, result, signal)
          if (yieldProcessingSlice) {
            savedCheckpointKeys.add(identity.key)
            checkpointRoundTrips.push(Boolean(await checkpoints.load(identity, signal)))
          }
        },
        beforeRequest() {
          if (yieldProcessingSlice) {
            if (admittedBatches >= 8) {
              throw new ProviderCapacityDeferredError('processing_budget', { retryAfterMs: 1000 })
            }
            admittedBatches++
          }
          checkpoints.beforeRequest()
        },
      }
    })
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.origin !== 'https://api.openai.com' || url.pathname !== '/v1/embeddings')
        throw new Error('Unexpected fixture request')
      const body = JSON.parse(String(init?.body)) as { input: string[] }
      requests++
      suppliedVectors += body.input.length
      return Response.json({
        data: body.input.map((_, index) => ({
          index,
          embedding: [1, ...Array<number>(1535).fill(0)],
        })),
        usage: { total_tokens: body.input.length * 25 },
      })
    })
    expect(
      await processDocumentsWithQueue([file], ids.knowledgeBaseId, {}, requestId, billing)
    ).toMatchObject({ accepted: 1, failed: 0 })
    const [deferred] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(deferred).toMatchObject({
      processingStatus: 'pending',
      processingError: null,
      processingAttempts: 0,
    })
    expect(suppliedVectors).toBeGreaterThan(0)
    expect(requests).toBeLessThanOrEqual(8)
    expect(checkpointRoundTrips).toEqual(Array(requests).fill(true))
    expect(
      await db.select().from(embedding).where(eq(embedding.documentId, file.documentId))
    ).toEqual([])
    expect(await db.select().from(usageLog).where(eq(usageLog.userId, ids.aliceId))).toEqual([])
    const eventId = `knowledge-slice-${file.documentId}-${requestId}-1`
    events.push(eventId)
    const [event] = await db.select().from(outboxEvent).where(eq(outboxEvent.id, eventId))
    expect(assertDocumentProcessingPayload(event.payload)).toMatchObject({
      requestId,
      processingSliceCount: 1,
      billingAttribution: billing,
    })
    const loadNewCheckpoints = async () =>
      (
        await db
          .select()
          .from(outboxEvent)
          .where(eq(outboxEvent.eventType, EMBEDDING_CHECKPOINT_CLEANUP_EVENT))
          .limit(5000)
      ).filter((row) => !priorCheckpointIds.has(row.id))
    const checkpoints = await loadNewCheckpoints()
    events.push(...checkpoints.map((row) => row.id))
    expect(checkpoints.length).toBe(requests)
    expect(JSON.stringify(checkpoints.map((row) => row.payload))).not.toContain('Orion')
    yieldProcessingSlice = false
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date(0) })
      .where(eq(outboxEvent.id, eventId))
    expect(await processOutboxEventById(eventId, knowledgeDocumentProcessingOutboxHandlers)).toBe(
      'completed'
    )
    const [completed] = await db.select().from(document).where(eq(document.id, file.documentId))
    expect(completed).toMatchObject({
      processingStatus: 'completed',
      processingError: null,
      processingAttempts: 0,
    })
    const vectors = await db
      .select({ chunkIndex: embedding.chunkIndex })
      .from(embedding)
      .where(eq(embedding.documentId, file.documentId))
    expect(vectors.length).toBe(completed.chunkCount)
    expect(new Set(checkpointScopes).size).toBe(1)
    expect(resumedCheckpointReads).toBe(savedCheckpointKeys.size)
    expect(resumedCheckpointHits).toBe(savedCheckpointKeys.size)
    expect(suppliedVectors).toBe(completed.chunkCount)
    const charges = await db
      .select()
      .from(usageLog)
      .where(and(eq(usageLog.userId, ids.aliceId), eq(usageLog.source, 'knowledge-base')))
    expect(charges).toHaveLength(1)
    expect(charges[0].metadata).toMatchObject({ inputTokens: completed.chunkCount * 25 })
    const totalRequests = requests
    expect(await processOutboxEventById(eventId, knowledgeDocumentProcessingOutboxHandlers)).toBe(
      'completed'
    )
    expect(requests).toBe(totalRequests)
    const results = await searchKnowledge.execute({
      principal: { kind: 'session', userId: ids.aliceId, sessionId: generateId() },
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Orion',
        searchMode: 'hybrid',
        topK: 3,
      },
    })
    expect(results.results.map((result) => result.documentId)).toContain(file.documentId)
    events.push(...(await loadNewCheckpoints()).map((row) => row.id))
  }, 60000)
})
