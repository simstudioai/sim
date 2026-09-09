/**
 * Real source storage, provider admission, parsing, indexing, billing deduplication,
 * delayed outbox execution, and search authorization. Only external HTTP is synthetic.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  member,
  organization,
  outboxEvent,
  rateLimitBucket,
  usageLog,
  user,
  workspace,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import {
  resolveBillingAttribution,
  resolveOrganizationBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import * as egress from '@/lib/core/security/input-validation.server'
import { getMistralCapacityScope } from '@/lib/internal/mistral/capacity'
import { resetHostedEmbeddingFixtureAdmission } from '@/lib/knowledge/__integration__/provider-fixture-state'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { searchScopedKnowledge } from '@/lib/knowledge/application/workspace-search'
import {
  materializeDocumentAcls,
  recordMemberObservations,
} from '@/lib/knowledge/connectors/member-observations'
import { createContentSyncLease, createMemberSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument, persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'
import { KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-continuation-dispatch'
import { knowledgeDocumentProcessingOutboxHandlers } from '@/lib/knowledge/documents/processing-outbox-handler'
import { assertDocumentProcessingPayload } from '@/lib/knowledge/documents/processing-payload'
import * as providerContinuation from '@/lib/knowledge/documents/processing-provider-continuation'
import { processDocumentsWithQueue } from '@/lib/knowledge/documents/service'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
)
const OCR_TEXT =
  'Orion release checklist. Engineers approved the migration plan and verified operational dependencies.'
const WAIT_MS = 600_000

describe('provider throttling resumes the shared indexing pipeline', () => {
  const seeded: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
  const events: string[] = []
  const capacityKeys: string[] = []
  const prior = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    MISTRAL_API_KEY: env.MISTRAL_API_KEY,
    OCR_PROVIDER: env.OCR_PROVIDER,
    TRIGGER_SECRET_KEY: env.TRIGGER_SECRET_KEY,
    MISTRAL_OCR_QUOTA_GROUPS: env.MISTRAL_OCR_QUOTA_GROUPS,
  }

  beforeAll(() => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-provider-recovery-'))
  })
  beforeEach(resetHostedEmbeddingFixtureAdmission)
  afterEach(async () => {
    vi.useRealTimers()
    await resetHostedEmbeddingFixtureAdmission()
  })
  afterAll(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Object.assign(env, prior)
    if (events.length) await db.delete(outboxEvent).where(inArray(outboxEvent.id, events))
    if (capacityKeys.length)
      await db.delete(rateLimitBucket).where(inArray(rateLimitBucket.key, capacityKeys))
    for (const ids of seeded) {
      await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await db.$client.end()
  })

  it.each(['regular KB', 'member source', 'organization Search'] as const)(
    'recovers a %s after Mistral 429 without burning dispatches or charging twice',
    async (scope) => {
      vi.useRealTimers()
      const ids = createKnowledgeAclFixtureIds()
      seeded.push(ids)
      await seedKnowledgeAclFixture(ids)
      let connectorId = ids.connectorId
      let connectorType = 'confluence'
      let lease = createContentSyncLease(connectorId, ids.lockId)
      let memberFixture: Awaited<ReturnType<typeof seedKnowledgeMemberFixture>> | undefined
      if (scope === 'member source') {
        memberFixture = await seedKnowledgeMemberFixture(ids)
        connectorId = memberFixture.connectorId
        connectorType = 'google_drive'
        lease = createMemberSyncLease(connectorId, memberFixture.runId)
      }
      const orgOwned = scope === 'organization Search'
      if (orgOwned) {
        await db.insert(member).values([
          {
            id: generateId(),
            organizationId: ids.organizationId,
            userId: ids.aliceId,
            role: 'owner',
          },
          {
            id: generateId(),
            organizationId: ids.organizationId,
            userId: ids.bobId,
            role: 'member',
          },
        ])
        await db
          .update(knowledgeBase)
          .set({ workspaceId: null, organizationId: ids.organizationId, isSearchIndex: true })
          .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      }

      const file = await addDocument(
        ids.knowledgeBaseId,
        connectorId,
        connectorType,
        {
          externalId: 'orion-scan',
          title: 'Orion scan.png',
          content: '',
          mimeType: 'image/png',
          contentHash: 'synthetic-scan-v1',
          sourceFile: { bytes: PNG, fileName: 'Orion scan.png', mimeType: 'image/png' },
        },
        orgOwned
          ? { userId: ids.aliceId, workspaceId: null, organizationId: ids.organizationId }
          : { userId: ids.aliceId, workspaceId: ids.workspaceId },
        undefined,
        scope === 'member source' ? 'members' : orgOwned ? 'admin' : 'workspace',
        lease
      )
      if (scope === 'regular KB') {
        await db.update(document).set({ connectorId: null }).where(eq(document.id, file.documentId))
      } else if (memberFixture) {
        await recordMemberObservations(
          db,
          memberFixture.members[0].id,
          [file.documentId],
          memberFixture.runId
        )
        await materializeDocumentAcls(connectorId, [file.documentId])
      } else {
        await persistDocumentAcls(
          connectorId,
          new Map([['orion-scan', [`u:${ids.aliceId}@fixture.test`]]])
        )
      }

      let ocrRequests = 0
      let embeddingRequests = 0
      Object.assign(env, {
        OCR_PROVIDER: 'mistral',
        TRIGGER_SECRET_KEY: undefined,
        MISTRAL_API_KEY: `fixture-mistral-${generateId()}`,
        OPENAI_API_KEY: `fixture-openai-${generateId()}`,
      })
      Object.assign(env, {
        MISTRAL_OCR_QUOTA_GROUPS: JSON.stringify({
          [sha256Hex(env.MISTRAL_API_KEY!)]: generateId(),
        }),
      })
      const capacityKey = `provider:ocr:mistral:${getMistralCapacityScope(env.MISTRAL_API_KEY!)}:capacity:v1`
      capacityKeys.push(capacityKey)
      const providerFetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input)
        if (url.origin === 'https://api.mistral.ai' && url.pathname === '/v1/ocr') {
          ocrRequests++
          if (ocrRequests === 1)
            return Response.json(
              { message: 'Synthetic rate limit' },
              {
                status: 429,
                headers: { 'retry-after': String(WAIT_MS / 1000) },
              }
            )
          return Response.json({
            pages: [{ index: 0, markdown: OCR_TEXT }],
            usage_info: { pages_processed: 1 },
          })
        }
        if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/embeddings') {
          embeddingRequests++
          const body = JSON.parse(String(init?.body)) as { input: string | string[] }
          const inputs = Array.isArray(body.input) ? body.input : [body.input]
          return Response.json({
            model: 'text-embedding-3-small',
            data: inputs.map((_, index) => ({
              index,
              embedding: [1, ...Array<number>(1535).fill(0)],
            })),
            usage: { prompt_tokens: inputs.length * 25, total_tokens: inputs.length * 25 },
          })
        }
        throw new Error(`Unexpected outbound fixture request: ${url.origin}${url.pathname}`)
      }
      vi.stubGlobal('fetch', providerFetch)
      vi.spyOn(egress, 'validateUrlWithDNS').mockImplementation(async (url) => {
        if (url !== 'https://api.mistral.ai/v1/ocr')
          throw new Error('Unexpected pinned fixture endpoint')
        return { isValid: true, resolvedIP: '203.0.113.1', originalHostname: 'api.mistral.ai' }
      })
      vi.spyOn(egress, 'secureFetchWithPinnedIP').mockImplementation(async (url, _ip, options) => {
        const response = await providerFetch(url, {
          method: options.method,
          body: typeof options.body === 'string' ? options.body : undefined,
        })
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: new egress.SecureFetchHeaders(Object.fromEntries(response.headers)),
          body: response.body,
          text: () => response.text(),
          json: () => response.json(),
          arrayBuffer: () => response.arrayBuffer(),
        }
      })
      const billing = orgOwned
        ? await resolveOrganizationBillingAttribution({
            actorUserId: ids.aliceId,
            organizationId: ids.organizationId,
          })
        : await resolveBillingAttribution({
            actorUserId: ids.aliceId,
            workspaceId: ids.workspaceId,
          })
      const requestId = generateId()
      const startedAt = Date.now()
      const holdParentHandoff = scope === 'regular KB'
      let releaseParentHandoff!: () => void
      let notifyHandoffScheduled!: () => void
      const parentHandoffGate = new Promise<void>((resolve) => {
        releaseParentHandoff = resolve
      })
      const handoffScheduled = new Promise<void>((resolve) => {
        notifyHandoffScheduled = resolve
      })
      const originalSchedule = providerContinuation.scheduleDocumentProcessingProviderContinuation
      const handoffSpy = holdParentHandoff
        ? vi
            .spyOn(providerContinuation, 'scheduleDocumentProcessingProviderContinuation')
            .mockImplementation(async (...args) => {
              const continuation = await originalSchedule(...args)
              notifyHandoffScheduled()
              await parentHandoffGate
              return continuation
            })
        : undefined
      let initialProcessing: ReturnType<typeof processDocumentsWithQueue> | undefined
      try {
        initialProcessing = processDocumentsWithQueue(
          [file],
          ids.knowledgeBaseId,
          {},
          requestId,
          billing
        )
        if (holdParentHandoff) {
          await Promise.race([
            handoffScheduled,
            initialProcessing.then(() => {
              throw new Error('Expected a durable handoff')
            }),
          ])
        } else {
          expect(await initialProcessing).toMatchObject({ accepted: 1, failed: 0 })
        }
        expect(ocrRequests).toBe(1)
        expect(embeddingRequests).toBe(0)
        const [deferred] = await db.select().from(document).where(eq(document.id, file.documentId))
        expect(deferred).toMatchObject({
          processingStatus: holdParentHandoff ? 'processing' : 'pending',
          processingError: null,
          processingAttempts: holdParentHandoff ? 1 : 0,
          processingQueueToken: holdParentHandoff
            ? requestId
            : `knowledge-provider-${file.documentId}-${requestId}-1`,
        })
        if (!holdParentHandoff)
          expect(deferred.processingDeferredUntil!.getTime()).toBeGreaterThanOrEqual(
            startedAt + WAIT_MS
          )
        const eventId = `knowledge-provider-${file.documentId}-${requestId}-1`
        events.push(eventId)
        const [event] = await db.select().from(outboxEvent).where(eq(outboxEvent.id, eventId))
        expect(event).toMatchObject({
          eventType: KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT,
          status: 'pending',
        })
        expect(assertDocumentProcessingPayload(event.payload)).toMatchObject({
          requestId,
          processingQueueToken: `knowledge-provider-${file.documentId}-${requestId}-1`,
          billingAttribution: billing,
          providerRetryCount: 1,
        })
        expect(
          await processOutboxEventById(eventId, knowledgeDocumentProcessingOutboxHandlers)
        ).toBe('pending')
        expect(ocrRequests).toBe(1)

        if (!holdParentHandoff) {
          /** Replaying a handoff's predecessor cannot steal the same pass from its delayed successor. */
          const predecessorEventId = generateId()
          events.push(predecessorEventId)
          const predecessorPayload = assertDocumentProcessingPayload(event.payload)
          predecessorPayload.processingPredecessorToken = undefined
          predecessorPayload.processingPredecessorCharged = undefined
          predecessorPayload.providerRetryCount = undefined
          predecessorPayload.providerRetryStartedAt = undefined
          predecessorPayload.processingQueueToken = requestId
          predecessorPayload.processingQueuedAt = new Date(startedAt).toISOString()
          await db.insert(outboxEvent).values({
            id: predecessorEventId,
            eventType: KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT,
            payload: predecessorPayload,
            availableAt: new Date(),
          })
          expect(
            await processOutboxEventById(
              predecessorEventId,
              knowledgeDocumentProcessingOutboxHandlers
            )
          ).toBe('completed')
          expect(ocrRequests).toBe(1)
          const [afterPredecessorReplay] = await db
            .select()
            .from(document)
            .where(eq(document.id, file.documentId))
          expect(afterPredecessorReplay).toMatchObject({
            processingStatus: 'pending',
            processingQueueToken: deferred.processingQueueToken,
            processingDeferredUntil: deferred.processingDeferredUntil,
          })
        }

        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(event.availableAt.getTime() + 1)
        /** PostgreSQL owns the capacity clock; model its elapsed cooldown without a ten-minute test sleep. */
        await db
          .update(rateLimitBucket)
          .set({
            capacityState: sql`${rateLimitBucket.capacityState} || '{"cooldownUntil":0,"nextRequestAt":0,"pageTokens":30}'::jsonb`,
          })
          .where(eq(rateLimitBucket.key, capacityKey))
        expect(
          await processOutboxEventById(eventId, knowledgeDocumentProcessingOutboxHandlers)
        ).toBe('completed')
        const [completed] = await db.select().from(document).where(eq(document.id, file.documentId))
        expect(completed).toMatchObject({
          processingStatus: 'completed',
          processingError: null,
          processingAttempts: 0,
          processingQueueToken: null,
          processingDeferredUntil: null,
        })
        if (holdParentHandoff) {
          releaseParentHandoff()
          expect(await initialProcessing).toMatchObject({ accepted: 1, failed: 0 })
          handoffSpy?.mockRestore()
          const [afterLateParentWrite] = await db
            .select()
            .from(document)
            .where(eq(document.id, file.documentId))
          expect(afterLateParentWrite).toMatchObject({
            processingStatus: 'completed',
            processingQueueToken: null,
            processingAttempts: 0,
            processingCompletedAt: completed.processingCompletedAt,
          })
        }
        expect(ocrRequests).toBe(2)
        expect(embeddingRequests).toBe(1)
        expect(
          await db.select().from(embedding).where(eq(embedding.documentId, file.documentId))
        ).toHaveLength(1)
        const charges = () =>
          db
            .select()
            .from(usageLog)
            .where(and(eq(usageLog.userId, ids.aliceId), eq(usageLog.source, 'knowledge-base')))
        expect(await charges()).toHaveLength(1)
        expect(
          await processOutboxEventById(eventId, knowledgeDocumentProcessingOutboxHandlers)
        ).toBe('completed')
        expect(ocrRequests).toBe(2)
        expect(await charges()).toHaveLength(1)
        const principal = { kind: 'session' as const, userId: ids.aliceId, sessionId: generateId() }
        const result = orgOwned
          ? await searchScopedKnowledge.execute({
              principal,
              input: {
                organizationId: ids.organizationId,
                query: 'Orion',
                topK: 3,
                searchMode: 'hybrid',
              },
            })
          : await searchKnowledge.execute({
              principal,
              input: {
                workspaceId: ids.workspaceId,
                knowledgeBaseIds: [ids.knowledgeBaseId],
                query: 'Orion',
                topK: 3,
                searchMode: 'hybrid',
              },
            })
        expect(result.results.map((row) => row.documentId)).toContain(file.documentId)
        if (scope === 'member source') {
          const hidden = await searchKnowledge.execute({
            principal: { ...principal, userId: ids.bobId },
            input: {
              workspaceId: ids.workspaceId,
              knowledgeBaseIds: [ids.knowledgeBaseId],
              query: 'Orion',
              topK: 3,
              searchMode: 'hybrid',
            },
          })
          expect(hidden.results).toEqual([])
        }
        const replacementPass = generateId()
        await db
          .update(document)
          .set({
            processingStatus: 'pending',
            processingQueueToken: replacementPass,
            processingQueuedAt: new Date(),
            processingStartedAt: null,
          })
          .where(eq(document.id, file.documentId))
        const staleEventId = generateId()
        events.push(staleEventId)
        await db.insert(outboxEvent).values({
          id: staleEventId,
          eventType: KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT,
          payload: event.payload,
          availableAt: new Date(),
        })
        expect(
          await processOutboxEventById(staleEventId, knowledgeDocumentProcessingOutboxHandlers)
        ).toBe('completed')
        expect(ocrRequests).toBe(2)
        const [replacement] = await db
          .select()
          .from(document)
          .where(eq(document.id, file.documentId))
        expect(replacement).toMatchObject({
          processingStatus: 'pending',
          processingQueueToken: replacementPass,
        })
        vi.useRealTimers()
      } finally {
        releaseParentHandoff()
        handoffSpy?.mockRestore()
        await initialProcessing?.catch(() => undefined)
        vi.useRealTimers()
      }
    },
    30_000
  )
})
