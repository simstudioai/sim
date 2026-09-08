/** Real PostgreSQL, document storage, parsing, embedding persistence, leases, and ACL observations; only provider APIs are fixtures. */
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  credential,
  credentialGroupEnrollment,
  document,
  embedding,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeConnectorSyncLog,
  knowledgeDocumentObservation,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ storageRoot: '', list: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixture.storageRoot
  },
}))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => ({
    embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
    totalTokens: texts.length,
    billableTokens: 0,
    isBYOK: true,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  }),
}))
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    google_drive: {
      id: 'google_drive',
      name: 'Fixture Drive',
      auth: { mode: 'oauth', provider: 'google-drive' },
      permissionScopedListing: { capFieldIds: [] },
      listDocuments: fixture.list,
      getDocument: fixture.get,
    },
  },
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import {
  readKnowledgeDocument,
  updateKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import * as connectorTokens from '@/lib/knowledge/connectors/access-token'
import { listingFingerprint } from '@/lib/knowledge/connectors/listing-checkpoint'
import * as memberAccess from '@/lib/knowledge/connectors/member-access'
import {
  materializeDocumentAcls,
  recordMemberObservations,
} from '@/lib/knowledge/connectors/member-observations'
import {
  executeMemberSync,
  resumeMembershipRewrites,
} from '@/lib/knowledge/connectors/member-sync-engine'
import { runConnectorContentPass } from '@/lib/knowledge/connectors/sync-content-pass'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import { SOURCE_CONTENT_ERROR } from '@/lib/knowledge/connectors/sync-limits'
import { createContentSyncLease, createMemberSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument } from '@/lib/knowledge/connectors/sync-persistence'
import * as documentService from '@/lib/knowledge/documents/service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import type { ExternalDocument, SyncResult } from '@/connectors/types'

const body =
  'Durable source pagination preserves the checkpoint, indexes each document once, and applies access revocation only after an authoritative complete listing.'
function sourceDoc(externalId: string): ExternalDocument {
  return {
    externalId,
    title: externalId,
    content: body,
    mimeType: 'text/plain',
    contentHash: `hash-${externalId}`,
  }
}
function result(): SyncResult {
  return {
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsSkipped: 0,
    docsFailed: 0,
    processingDispatch: { requested: 0, accepted: 0, failed: 0 },
  }
}

describe('durable source and member cycles in PostgreSQL', () => {
  const ids = createKnowledgeAclFixtureIds()
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>
  beforeAll(async () => {
    fixture.storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-listing-continuation-'))
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected outbound provider request')
    })
    await seedKnowledgeAclFixture(ids)
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    vi.spyOn(memberAccess, 'mintKnowledgeConnectorMemberToken').mockImplementation(async () => ({
      accessToken: 'fixture-token',
      refreshed: false,
    }))
  })
  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(user).where(eq(user.id, ids.aliceId))
    await db.delete(user).where(eq(user.id, ids.bobId))
    await rm(fixture.storageRoot, { recursive: true, force: true })
    await db.$client.end()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  function pagedSource() {
    fixture.list.mockImplementation(async (_token, _source, cursor) => {
      const page = Number(cursor ?? 0)
      return {
        documents: page === 0 ? [sourceDoc('first')] : page === 25 ? [sourceDoc('last')] : [],
        hasMore: page < 25,
        nextCursor: page < 25 ? String(page + 1) : undefined,
      }
    })
  }

  it('reconciles NULL and microsecond timestamp ties across ACL, soft-delete, and hard-delete pages', async () => {
    const connectorId = generateId()
    let runId = generateId()
    const acl = [`u:${ids.aliceId}@fixture.test`]
    const aclRequirements = [[`g:confluence:fixture-tenant:space`]]
    const verifiedAt = new Date()
    const oldTimestamp = sql`'2020-01-01 00:00:00.000123'::timestamp`
    const row = (externalId: string) => ({
      id: generateId(),
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorId,
      externalId,
      filename: externalId,
      fileUrl: '',
      fileSize: 0,
      mimeType: 'text/plain',
      processingStatus: 'completed',
      contentHash: `hash-${externalId}`,
      acl,
      aclRequirements,
      aclVerifiedAt: verifiedAt,
    })
    const oldRows = Array.from({ length: 1_100 }, (_, index) => ({
      ...row(`old-${index}`),
      sourceSeenAt: index < 550 ? null : oldTimestamp,
    }))
    const freshRows = Array.from({ length: 3_300 }, (_, index) => row(`fresh-${index}`))
    const protectedRows = [
      { ...row('excluded-null'), userExcluded: true, sourceSeenAt: null },
      { ...row('excluded-timestamp'), userExcluded: true, sourceSeenAt: oldTimestamp },
      { ...row('archived-null'), archivedAt: verifiedAt, sourceSeenAt: null },
      { ...row('archived-timestamp'), archivedAt: verifiedAt, sourceSeenAt: oldTimestamp },
    ]
    const protectedIds = protectedRows.map((item) => item.id)
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'google_drive',
      sourceConfig: {},
      accessMode: 'admin',
      status: 'syncing',
      syncLockToken: runId,
    })
    const rows = [...oldRows, ...freshRows, ...protectedRows]
    for (let offset = 0; offset < rows.length; offset += 500)
      await db.insert(document).values(rows.slice(offset, offset + 500))
    const protectedBefore = await db
      .select()
      .from(document)
      .where(inArray(document.id, protectedIds))
      .orderBy(document.id)
    const [precision] = await db
      .select({ timestamp: sql<string>`${document.sourceSeenAt}::text` })
      .from(document)
      .where(eq(document.id, oldRows[550]!.id))
    expect(precision.timestamp).toBe('2020-01-01 00:00:00.000123')
    fixture.list.mockImplementation(async (_token, _source, cursor) => {
      const offset = Number(cursor ?? 0)
      const nextOffset = offset + 500
      return {
        documents: freshRows.slice(offset, nextOffset).map((item) => sourceDoc(item.externalId)),
        hasMore: nextOffset < freshRows.length,
        nextCursor: nextOffset < freshRows.length ? String(nextOffset) : undefined,
      }
    })
    const hardDelete = vi.spyOn(documentService, 'hardDeleteDocuments')
    const run = async () => {
      const [connector] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, connectorId))
      const stats = result()
      const pass = await runConnectorContentPass({
        connectorId,
        connector,
        connectorConfig: CONNECTOR_REGISTRY.google_drive,
        sourceConfig: {},
        syncContext: {},
        kbOwner: { userId: ids.aliceId, workspaceId: ids.workspaceId },
        billingAttribution: billing,
        result: stats,
        lease: createContentSyncLease(connectorId, runId),
        leaseKind: 'content',
        runId,
        fingerprint: listingFingerprint({ connectorId }),
        documentAccess: 'admin',
        getAccessToken: async () => 'fixture',
        hydration: { getDocument: fixture.get },
        forceRehydrate: false,
        deadlineAt: Date.now() + 30_000,
      })
      return { pass, stats }
    }
    try {
      const soft = await run()
      expect(soft.pass).toMatchObject({ complete: true, holdNotice: null })
      expect(soft.pass.checkpoint.listedCount).toBe(3_300)
      expect(soft.stats).toMatchObject({ docsUnchanged: 3_300, docsDeleted: 0, docsFailed: 0 })
      expect(hardDelete).not.toHaveBeenCalled()
      const missing = await db
        .select({
          id: document.id,
          acl: document.acl,
          requirements: document.aclRequirements,
          verifiedAt: document.aclVerifiedAt,
          deletedAt: document.deletedAt,
        })
        .from(document)
        .where(
          inArray(
            document.id,
            oldRows.map((item) => item.id)
          )
        )
      expect(missing).toHaveLength(1_100)
      expect(
        missing.every(
          (item) =>
            item.acl.length === 0 &&
            item.requirements.length === 0 &&
            item.verifiedAt === null &&
            item.deletedAt instanceof Date
        )
      ).toBe(true)
      runId = generateId()
      await db
        .update(knowledgeConnector)
        .set({ syncLockToken: runId, listingCheckpoint: null })
        .where(eq(knowledgeConnector.id, connectorId))
      const hard = await run()
      expect(hard.pass).toMatchObject({ complete: true, holdNotice: null })
      expect(hard.stats).toMatchObject({ docsUnchanged: 3_300, docsDeleted: 1_100, docsFailed: 0 })
      expect(hardDelete.mock.calls.map(([batch]) => batch.length)).toEqual(Array(44).fill(25))
      const remaining = await db
        .select()
        .from(document)
        .where(eq(document.connectorId, connectorId))
      expect(new Set(remaining.map((item) => item.id))).toEqual(
        new Set([...freshRows, ...protectedRows].map((item) => item.id))
      )
      for (const item of remaining.filter((item) => item.externalId?.startsWith('fresh-')))
        expect(item).toMatchObject({
          acl,
          aclRequirements,
          aclVerifiedAt: verifiedAt,
          deletedAt: null,
          archivedAt: null,
          sourceSeenAt: new Date(hard.pass.checkpoint.startedAt),
        })
      expect(
        await db
          .select()
          .from(document)
          .where(inArray(document.id, protectedIds))
          .orderBy(document.id)
      ).toEqual(protectedBefore)
    } finally {
      hardDelete.mockRestore()
      await db.delete(document).where(eq(document.connectorId, connectorId))
      await db.delete(knowledgeConnector).where(eq(knowledgeConnector.id, connectorId))
    }
  })

  it('indexes a page, resumes under a new lease, and reconciles absence only after EOF', async () => {
    await db
      .update(knowledgeConnector)
      .set({ accessMode: 'workspace', connectorType: 'google_drive' })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    await addDocument(
      ids.knowledgeBaseId,
      ids.connectorId,
      'google_drive',
      sourceDoc('removed'),
      { userId: ids.aliceId, workspaceId: ids.workspaceId },
      {},
      'workspace',
      createContentSyncLease(ids.connectorId, ids.lockId)
    )
    pagedSource()
    const run = async (runId: string, scope = 'fixture') => {
      const [connector] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
      return runConnectorContentPass({
        connectorId: ids.connectorId,
        connector,
        connectorConfig: CONNECTOR_REGISTRY.google_drive,
        sourceConfig: {},
        syncContext: {},
        kbOwner: { userId: ids.aliceId, workspaceId: ids.workspaceId },
        billingAttribution: billing,
        result: result(),
        lease: createContentSyncLease(ids.connectorId, runId),
        leaseKind: 'content',
        runId,
        fingerprint: listingFingerprint({ source: scope }),
        documentAccess: 'workspace',
        getAccessToken: async () => 'fixture',
        hydration: { getDocument: fixture.get },
        forceRehydrate: false,
        deadlineAt: Date.now() + 60_000,
      })
    }
    const first = await run(ids.lockId)
    expect(first.complete).toBe(false)
    expect(first.checkpoint).toMatchObject({ cursor: '25', listedCount: 1 })
    const [removedBefore] = await db
      .select()
      .from(document)
      .where(and(eq(document.connectorId, ids.connectorId), eq(document.externalId, 'removed')))
    expect(removedBefore.deletedAt).toBeNull()
    const [indexed] = await db
      .select()
      .from(document)
      .where(and(eq(document.connectorId, ids.connectorId), eq(document.externalId, 'first')))
    expect(indexed.processingStatus).toBe('completed')
    expect(
      (await db.select().from(embedding).where(eq(embedding.documentId, indexed.id))).length
    ).toBeGreaterThan(0)
    const nextLease = generateId()
    await db
      .update(knowledgeConnector)
      .set({ syncLockToken: nextLease })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    await expect(run(ids.lockId)).rejects.toThrow('reclaimed')
    const second = await run(nextLease)
    expect(second.complete).toBe(true)
    expect(second.checkpoint.generationId).toBe(first.checkpoint.generationId)
    expect(fixture.list.mock.calls.at(-1)?.[2]).toBe('25')
    const [removedAfter] = await db.select().from(document).where(eq(document.id, removedBefore.id))
    expect(removedAfter.deletedAt).toBeInstanceOf(Date)
    const [firstAfter] = await db.select().from(document).where(eq(document.id, indexed.id))
    expect(firstAfter.sourceSeenAt).toEqual(new Date(first.checkpoint.startedAt))
    fixture.list.mockImplementation(async (_token, _source, cursor) => ({
      documents: cursor
        ? [sourceDoc('beyond-failure')]
        : [
            { ...sourceDoc('first'), content: '' },
            { ...sourceDoc('new-failed'), content: '', contentDeferred: true },
          ],
      hasMore: !cursor,
      nextCursor: cursor ? undefined : 'after-failure',
    }))
    fixture.get.mockRejectedValueOnce(new Error('Source file temporarily unavailable'))
    const failedCycle = await run(nextLease, 'changed-scope')
    expect(failedCycle.complete).toBe(true)
    expect(failedCycle.checkpoint.contentFailures).toBe(true)
    const [failedRefresh] = await db.select().from(document).where(eq(document.id, indexed.id))
    expect(failedRefresh.sourceSeenAt).toEqual(new Date(failedCycle.checkpoint.startedAt))
    expect(failedRefresh.processingStatus).toBe('failed')
    expect(failedRefresh.contentHash).toBeNull()
    expect(failedRefresh.storageKey).toBe(firstAfter.storageKey)
    const [afterFailure] = await db
      .select()
      .from(document)
      .where(
        and(eq(document.connectorId, ids.connectorId), eq(document.externalId, 'beyond-failure'))
      )
    expect(afterFailure.processingStatus).toBe('completed')
    const [placeholder] = await db
      .select()
      .from(document)
      .where(and(eq(document.connectorId, ids.connectorId), eq(document.externalId, 'new-failed')))
    expect(placeholder).toMatchObject({
      storageKey: null,
      fileUrl: '',
      contentHash: null,
      processingStatus: 'failed',
    })
    const accessible = await searchKnowledge.execute({
      principal: { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-alice' },
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Durable',
        topK: 10,
      },
    })
    expect(
      accessible.results.some(
        (row) => row.documentId === indexed.id || row.documentId === placeholder.id
      )
    ).toBe(false)
    expect(accessible.results.some((row) => row.documentId === afterFailure.id)).toBe(true)
    await db
      .update(document)
      .set({ processingError: 'A changed UI error message' })
      .where(eq(document.id, indexed.id))
    const principal = { kind: 'session' as const, userId: ids.aliceId, sessionId: 'fixture-alice' }
    const failedMetadata = await readKnowledgeDocument.execute({
      principal,
      input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: indexed.id },
    })
    expect(failedMetadata.document.processingStatus).toBe('failed')
    await expect(
      updateKnowledgeDocument.execute({
        principal,
        input: {
          knowledgeBaseId: ids.knowledgeBaseId,
          documentId: indexed.id,
          retryProcessing: true,
        },
      })
    ).rejects.toThrow('Sync the connector')
    await expect(
      listKnowledgeChunks.execute({
        principal,
        input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: indexed.id },
      })
    ).rejects.toThrow('not ready')
    await expect(
      downloadFileFromUrl(failedRefresh.fileUrl, {
        userId: ids.aliceId,
        knowledgeAccess: 'user',
      })
    ).rejects.toThrow('Access denied')
    fixture.list.mockImplementation(async (_token, _source, cursor) => ({
      documents: cursor
        ? [sourceDoc('new-failed'), sourceDoc('beyond-failure')]
        : [sourceDoc('first')],
      hasMore: !cursor,
      nextCursor: cursor ? undefined : 'recover-next',
    }))
    const recovered = await run(nextLease, 'retry-after-failure')
    expect(recovered.checkpoint.contentFailures).toBe(false)
    const [restored] = await db.select().from(document).where(eq(document.id, indexed.id))
    expect(restored.processingStatus).toBe('completed')
    expect(restored.processingError).toBeNull()
    expect(restored.contentHash).toBe('hash-first')
    expect(
      (
        await downloadFileFromUrl(restored.fileUrl, {
          userId: ids.aliceId,
          knowledgeAccess: 'user',
        })
      ).toString()
    ).toBe(body)
    const [restoredPlaceholder] = await db
      .select()
      .from(document)
      .where(eq(document.id, placeholder.id))
    expect(restoredPlaceholder.processingStatus).toBe('completed')
    expect(restoredPlaceholder.storageKey).toEqual(expect.any(String))
    await db
      .update(document)
      .set({ connectorId: null, contentHash: null })
      .where(eq(document.id, restoredPlaceholder.id))
    expect(
      (
        await downloadFileFromUrl(restoredPlaceholder.fileUrl, {
          userId: ids.aliceId,
          knowledgeAccess: 'user',
        })
      ).toString()
    ).toBe(body)
  })

  it('resumes within a slow page without repeating hydrated or failed documents', async () => {
    const runId = generateId()
    await db
      .update(knowledgeConnector)
      .set({ syncLockToken: runId, listingCheckpoint: null })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    const documents = Array.from({ length: 6 }, (_, i) => ({
      ...sourceDoc(`slow-${i}`),
      content: '',
      contentDeferred: true,
    }))
    fixture.list.mockResolvedValue({ documents, hasMore: false })
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now')
    const getDocument = vi.fn(async (externalId: string) => {
      clock.mockReturnValue(now + 120_000)
      if (externalId === 'slow-0') throw new Error('Permanent provider failure')
      return sourceDoc(externalId)
    })
    const run = async (leaseId: string, deadlineAt: number) => {
      const [connector] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
      return runConnectorContentPass({
        connectorId: ids.connectorId,
        connector,
        connectorConfig: CONNECTOR_REGISTRY.google_drive,
        sourceConfig: {},
        syncContext: {},
        kbOwner: { userId: ids.aliceId, workspaceId: ids.workspaceId },
        billingAttribution: billing,
        result: result(),
        lease: createContentSyncLease(ids.connectorId, leaseId),
        leaseKind: 'content',
        runId: leaseId,
        fingerprint: listingFingerprint({ source: 'slow-page' }),
        documentAccess: 'workspace',
        getAccessToken: async () => 'fixture',
        hydration: { getDocument },
        forceRehydrate: true,
        deadlineAt,
      })
    }
    try {
      const first = await run(runId, now + 60_000)
      expect(first.complete).toBe(false)
      expect(first.checkpoint).toMatchObject({
        cursor: null,
        listedCount: 0,
        contentFailures: true,
      })
      expect(getDocument).toHaveBeenCalledTimes(1)
      const firstRows = await db
        .select()
        .from(document)
        .where(
          and(
            eq(document.connectorId, ids.connectorId),
            inArray(
              document.externalId,
              documents.map((item) => item.externalId)
            )
          )
        )
      expect(firstRows).toHaveLength(1)
      expect(
        firstRows.every((row) => row.sourceSeenAt?.toISOString() === first.checkpoint.startedAt)
      ).toBe(true)
      const nextLease = generateId()
      /** Simulate a crash before the page checkpoint saved its failure bit: durable document state must retain it. */
      await db
        .update(knowledgeConnector)
        .set({
          syncLockToken: nextLease,
          listingCheckpoint: { ...first.checkpoint, contentFailures: false },
        })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      await expect(run(runId, now + 240_000)).rejects.toThrow('reclaimed')
      getDocument.mockClear()
      getDocument.mockImplementation(async (externalId: string) => {
        clock.mockReturnValue(now + 300_000)
        return sourceDoc(externalId)
      })
      const middle = await run(nextLease, now + 180_000)
      expect(middle.complete).toBe(false)
      expect(getDocument).toHaveBeenCalledExactlyOnceWith('slow-1')
      getDocument.mockClear()
      const resumed = await run(nextLease, now + 600_000)
      expect(resumed.checkpoint).toMatchObject({
        complete: true,
        listedCount: 6,
        contentFailures: true,
      })
      expect(getDocument.mock.calls.map(([externalId]) => externalId)).toEqual([
        'slow-2',
        'slow-3',
        'slow-4',
        'slow-5',
      ])
      const [healthy] = await db
        .select()
        .from(document)
        .where(and(eq(document.connectorId, ids.connectorId), eq(document.externalId, 'slow-5')))
      expect(healthy.processingStatus).toBe('completed')
    } finally {
      clock.mockRestore()
    }
  })

  it('resumes a throttled hydration batch from durable siblings without advancing past deferred sources', async () => {
    let runId = generateId()
    const connectorId = generateId()
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'google_drive',
      status: 'syncing',
      syncLockToken: runId,
      accessMode: 'workspace',
      sourceConfig: {},
    })
    const documents = ['healthy', 'deferred', 'failed'].map((id) => ({
      ...sourceDoc(`paced-${id}`),
      content: '',
      contentDeferred: true,
      estimatedBytes: 100,
    }))
    fixture.list.mockResolvedValue({ documents, hasMore: false })
    const throttle = Object.assign(new Error('Synthetic provider throttle'), {
      status: 429,
      retryAfterMs: 60_000,
    })
    const getDocument = vi.fn(async (externalId: string) => {
      if (externalId === 'paced-deferred') throw throttle
      if (externalId === 'paced-failed') throw new Error('Temporary source failure')
      return sourceDoc(externalId)
    })
    const run = async () => {
      const [connector] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, connectorId))
      return runConnectorContentPass({
        connectorId,
        connector,
        connectorConfig: CONNECTOR_REGISTRY.google_drive,
        sourceConfig: {},
        syncContext: {},
        kbOwner: { userId: ids.aliceId, workspaceId: ids.workspaceId },
        billingAttribution: billing,
        result: result(),
        lease: createContentSyncLease(connectorId, runId),
        leaseKind: 'content',
        runId,
        fingerprint: listingFingerprint({ source: 'paced-page' }),
        documentAccess: 'workspace',
        getAccessToken: async () => 'fixture',
        hydration: { getDocument },
        forceRehydrate: true,
        deadlineAt: Date.now() + 60_000,
      })
    }
    await expect(run()).rejects.toBe(throttle)
    const firstRows = await db.select().from(document).where(eq(document.connectorId, connectorId))
    expect(firstRows.map((row) => row.externalId).sort()).toEqual(['paced-failed', 'paced-healthy'])
    expect(firstRows.find((row) => row.externalId === 'paced-healthy')).toMatchObject({
      processingStatus: 'completed',
      deletedAt: null,
    })
    expect(firstRows.find((row) => row.externalId === 'paced-failed')).toMatchObject({
      processingStatus: 'failed',
      contentHash: null,
      processingAttempts: 0,
      deletedAt: null,
    })
    expect(firstRows.every((row) => row.sourceSeenAt !== null)).toBe(true)
    const [interrupted] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, connectorId))
    expect(interrupted.listingCheckpoint).toMatchObject({
      cursor: null,
      complete: false,
      listedCount: 0,
    })
    runId = generateId()
    await db
      .update(knowledgeConnector)
      .set({ syncLockToken: runId })
      .where(eq(knowledgeConnector.id, connectorId))
    getDocument.mockClear()
    getDocument.mockImplementation(async (externalId: string) => sourceDoc(externalId))
    const resumed = await run()
    expect(getDocument).toHaveBeenCalledExactlyOnceWith('paced-deferred')
    expect(resumed.checkpoint).toMatchObject({
      complete: true,
      listedCount: 3,
      contentFailures: true,
    })
    const completed = await db.select().from(document).where(eq(document.connectorId, connectorId))
    expect(completed.filter((row) => row.processingStatus === 'completed')).toHaveLength(2)
    expect(completed.every((row) => row.deletedAt === null)).toBe(true)
  })

  it('keeps old observations through partial runs and revokes them only when the stable member generation completes', async () => {
    const memberFixture = await seedKnowledgeMemberFixture(ids)
    const [alice, bob] = memberFixture.members
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'revoked' })
      .where(eq(credentialGroupEnrollment.id, bob.enrollmentId))
    await db
      .insert(resourcePolicy)
      .values({
        id: generateId(),
        workspaceId: ids.workspaceId,
        resourceType: 'credential_group',
        resourceId: memberFixture.groupId,
        document: compileCredentialGroupWorkflowAccessPolicy({
          credentialGroupId: memberFixture.groupId,
          allowedWorkflowIds: [],
        }),
        createdBy: ids.aliceId,
        updatedBy: ids.aliceId,
      })
      .onConflictDoNothing()
    await memberAccess.grantKnowledgeConnectorCredentialAccess(
      {
        workspaceId: ids.workspaceId,
        credentialGroupId: memberFixture.groupId,
        credentialGroupOptionId: memberFixture.optionId,
        connectorId: memberFixture.connectorId,
      },
      ids.aliceId
    )
    const old = await addDocument(
      ids.knowledgeBaseId,
      memberFixture.connectorId,
      'google_drive',
      sourceDoc('old-member'),
      { userId: ids.aliceId, workspaceId: ids.workspaceId },
      {},
      'members',
      createMemberSyncLease(memberFixture.connectorId, memberFixture.runId)
    )
    await recordMemberObservations(db, alice.id, [old.documentId], 'old-generation')
    await materializeDocumentAcls(memberFixture.connectorId, [old.documentId])
    await db
      .update(knowledgeConnector)
      .set({ memberSyncStatus: 'idle', memberSyncLockToken: null })
      .where(eq(knowledgeConnector.id, memberFixture.connectorId))
    pagedSource()
    const first = await executeMemberSync(memberFixture.connectorId, {
      billingAttribution: billing,
    })
    expect(first.error).toBeUndefined()
    expect(first.membersIncomplete).toBe(1)
    const [partial] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, alice.id))
    expect(partial.listingCheckpoint).toMatchObject({ cursor: '25', complete: false })
    expect(partial.memberSyncedThrough).toBeNull()
    const [partialConnector] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, memberFixture.connectorId))
    expect(partialConnector.directoryCheckpoint).toMatchObject({ phase: 'complete' })
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.documentId, old.documentId))
    ).toHaveLength(1)
    const second = await executeMemberSync(memberFixture.connectorId, {
      billingAttribution: billing,
    })
    expect(second.error).toBeUndefined()
    expect(second.membersCompleted).toBe(1)
    const [complete] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, alice.id))
    expect(complete.listingCheckpoint).toBeNull()
    const [completeConnector] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, memberFixture.connectorId))
    expect(completeConnector.directoryCheckpoint).toBeNull()
    expect(complete.memberSyncedThrough).toEqual(
      new Date(String(partial.listingCheckpoint!.startedAt))
    )
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.documentId, old.documentId))
    ).toHaveLength(0)
    const observed = await db
      .select()
      .from(knowledgeDocumentObservation)
      .where(eq(knowledgeDocumentObservation.memberId, alice.id))
    expect(observed).toHaveLength(2)
    expect(new Set(observed.map((item) => item.runId)).size).toBe(1)
    const extra = Array.from({ length: 1_001 }, (_, index) => ({
      id: generateId(),
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorId: memberFixture.connectorId,
      externalId: `disconnect-${index}`,
      filename: `Document ${index}`,
      fileUrl: '',
      fileSize: 0,
      mimeType: 'text/plain',
      processingStatus: 'failed',
      acl: [complete.subjectToken],
    }))
    for (let offset = 0; offset < extra.length; offset += 500)
      await db.insert(document).values(extra.slice(offset, offset + 500))
    await recordMemberObservations(
      db,
      alice.id,
      extra.map((row) => row.id),
      'disconnect-fixture'
    )
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'revoked' })
      .where(eq(credentialGroupEnrollment.id, alice.enrollmentId))
    const disconnected = await executeMemberSync(memberFixture.connectorId, {
      billingAttribution: billing,
    })
    expect(disconnected.error).toBeUndefined()
    const remaining = await db
      .select({ acl: document.acl })
      .from(document)
      .where(eq(document.connectorId, memberFixture.connectorId))
    expect(remaining.every((row) => row.acl.length === 0)).toBe(true)
    const [suspended] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, alice.id))
    expect(suspended.status).toBe('suspended')
    expect(suspended.listingCheckpoint).toBeNull()
    const retained = await db
      .select({ id: knowledgeDocumentObservation.documentId })
      .from(knowledgeDocumentObservation)
      .where(eq(knowledgeDocumentObservation.memberId, alice.id))
    expect(retained).toHaveLength(1_003)
    const rewriteRun = generateId()
    await db
      .update(knowledgeConnector)
      .set({ memberSyncStatus: 'running', memberSyncLockToken: rewriteRun })
      .where(eq(knowledgeConnector.id, memberFixture.connectorId))
    await db
      .update(knowledgeConnectorMember)
      .set({ listingCheckpoint: { kind: 'membership', cursor: null, removeMember: true } })
      .where(eq(knowledgeConnectorMember.id, alice.id))
    await db
      .update(document)
      .set({ acl: [complete.subjectToken] })
      .where(
        inArray(
          document.id,
          retained.map((row) => row.id)
        )
      )
    const originalLease = createMemberSyncLease(memberFixture.connectorId, rewriteRun)
    const replay: Parameters<typeof resumeMembershipRewrites>[0] = {
      connectorId: memberFixture.connectorId,
      runId: rewriteRun,
      deadlineAt: Date.now() + 60_000,
      lease: {
        ...originalLease,
        beatIfDue: async () => {
          await originalLease.beatIfDue()
          replay.deadlineAt = Date.now() - 1
        },
      },
    }
    expect(await resumeMembershipRewrites(replay)).toBe(false)
    const [paused] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, alice.id))
    expect(paused.listingCheckpoint).toMatchObject({
      kind: 'membership',
      cursor: expect.any(String),
      removeMember: true,
    })
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.memberId, alice.id))
    ).toHaveLength(1_003)
    const replacementRun = generateId()
    await db
      .update(knowledgeConnector)
      .set({ memberSyncLockToken: replacementRun })
      .where(eq(knowledgeConnector.id, memberFixture.connectorId))
    replay.deadlineAt = Date.now() + 60_000
    await expect(resumeMembershipRewrites(replay)).rejects.toThrow('reclaimed')
    expect(
      await resumeMembershipRewrites({
        connectorId: memberFixture.connectorId,
        runId: replacementRun,
        deadlineAt: Date.now() + 60_000,
        lease: createMemberSyncLease(memberFixture.connectorId, replacementRun),
      })
    ).toBe(true)
    expect(
      await db
        .select()
        .from(knowledgeConnectorMember)
        .where(eq(knowledgeConnectorMember.id, alice.id))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.memberId, alice.id))
    ).toHaveLength(0)
    const rewritten = await db
      .select({ acl: document.acl })
      .from(document)
      .where(eq(document.connectorId, memberFixture.connectorId))
    expect(rewritten.every((row) => row.acl.length === 0)).toBe(true)
  })

  it('continues past a failed per-user download and retries content without discarding confirmed permissions', async () => {
    const memberFixture = await seedKnowledgeMemberFixture(ids)
    const [alice, bob] = memberFixture.members
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'revoked' })
      .where(eq(credentialGroupEnrollment.id, bob.enrollmentId))
    await db
      .insert(resourcePolicy)
      .values({
        id: generateId(),
        workspaceId: ids.workspaceId,
        resourceType: 'credential_group',
        resourceId: memberFixture.groupId,
        document: compileCredentialGroupWorkflowAccessPolicy({
          credentialGroupId: memberFixture.groupId,
          allowedWorkflowIds: [],
        }),
        createdBy: ids.aliceId,
        updatedBy: ids.aliceId,
      })
      .onConflictDoNothing()
    await memberAccess.grantKnowledgeConnectorCredentialAccess(
      {
        workspaceId: ids.workspaceId,
        credentialGroupId: memberFixture.groupId,
        credentialGroupOptionId: memberFixture.optionId,
        connectorId: memberFixture.connectorId,
      },
      ids.aliceId
    )
    await db
      .update(knowledgeConnector)
      .set({ memberSyncStatus: 'idle', memberSyncLockToken: null })
      .where(eq(knowledgeConnector.id, memberFixture.connectorId))
    fixture.list.mockImplementation(async (_token, _source, cursor) => ({
      documents: cursor
        ? [sourceDoc('member-healthy')]
        : [
            {
              ...sourceDoc('member-failed'),
              content: '',
              contentDeferred: true,
            },
          ],
      hasMore: !cursor,
      nextCursor: cursor ? undefined : 'healthy-page',
    }))
    fixture.get.mockRejectedValueOnce(new Error('Temporary provider download failure'))
    const failed = await executeMemberSync(memberFixture.connectorId, {
      billingAttribution: billing,
    })
    expect(failed.error).toBeUndefined()
    expect(failed.docsFailed).toBe(1)
    expect(failed.membersCompleted).toBe(1)
    expect(failed.listingIncomplete).toBe(true)
    const rows = await db
      .select()
      .from(document)
      .where(eq(document.connectorId, memberFixture.connectorId))
    const placeholder = rows.find((row) => row.externalId === 'member-failed')!
    expect(placeholder).toMatchObject({ processingStatus: 'failed', fileUrl: '', storageKey: null })
    expect(rows.find((row) => row.externalId === 'member-healthy')?.processingStatus).toBe(
      'completed'
    )
    const [memberAfterFailure] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, alice.id))
    expect(memberAfterFailure.lastError).toBe(SOURCE_CONTENT_ERROR)
    expect(memberAfterFailure.memberSyncedThrough).toBeInstanceOf(Date)
    expect(memberAfterFailure.listingCheckpoint).toBeNull()
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.memberId, alice.id))
    ).toHaveLength(2)

    await db
      .update(knowledgeConnectorMember)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(knowledgeConnectorMember.id, alice.id))
    fixture.get.mockResolvedValueOnce(sourceDoc('member-failed'))
    fixture.list.mockClear()
    const recovered = await executeMemberSync(memberFixture.connectorId, {
      billingAttribution: billing,
    })
    expect(recovered.error).toBeUndefined()
    expect(recovered.docsFailed).toBe(0)
    expect(fixture.list.mock.calls[0]?.[4]).toBeUndefined()
    const [restored] = await db.select().from(document).where(eq(document.id, placeholder.id))
    expect(restored.processingStatus).toBe('completed')
    expect(restored.processingError).toBeNull()
    expect(restored.contentHash).toBe('hash-member-failed')
    const [memberAfterRecovery] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, alice.id))
    expect(memberAfterRecovery.lastError).toBeNull()
  })
  it('reconciles a multi-page credential directory without removing members after a failed middle page', async () => {
    const memberFixture = await seedKnowledgeMemberFixture(ids)
    await db
      .insert(resourcePolicy)
      .values({
        id: generateId(),
        workspaceId: ids.workspaceId,
        resourceType: 'credential_group',
        resourceId: memberFixture.groupId,
        document: compileCredentialGroupWorkflowAccessPolicy({
          credentialGroupId: memberFixture.groupId,
          allowedWorkflowIds: [],
        }),
        createdBy: ids.aliceId,
        updatedBy: ids.aliceId,
      })
      .onConflictDoNothing()
    await memberAccess.grantKnowledgeConnectorCredentialAccess(
      {
        workspaceId: ids.workspaceId,
        credentialGroupId: memberFixture.groupId,
        credentialGroupOptionId: memberFixture.optionId,
        connectorId: memberFixture.connectorId,
      },
      ids.aliceId
    )
    const additional = Array.from({ length: 101 }, () => ({
      credentialId: generateId(),
      enrollmentId: generateId(),
      subjectId: generateId(),
    }))
    await db.insert(credentialGroupEnrollment).values(
      additional.map((row): typeof credentialGroupEnrollment.$inferInsert => ({
        id: row.enrollmentId,
        credentialGroupId: memberFixture.groupId,
        email: `${row.subjectId}@fixture.test`,
        status: 'completed',
        invitationTokenHash: createHash('sha256').update(generateId()).digest('hex'),
        invitationExpiresAt: new Date(Date.now() + 60_000),
        invitedAt: new Date(),
      }))
    )
    await db.insert(credential).values(
      additional.map((row): typeof credential.$inferInsert => ({
        id: row.credentialId,
        workspaceId: ids.workspaceId,
        type: 'managed_oauth',
        displayName: 'Directory fixture',
        providerId: 'google-drive',
        authorizationAppId: 'fixture-app',
        credentialGroupEnrollmentId: row.enrollmentId,
        credentialGroupOptionId: memberFixture.optionId,
        managedOauthScopeVersion: 1,
        providerSubjectId: row.subjectId,
        providerTenantId: 'fixture-domain',
        managedOauthStatus: 'active',
        grantedScopes: ['drive.readonly'],
        encryptedOauthTokenSet: 'fixture-not-an-oauth-token',
        grantedAt: new Date(),
        createdBy: ids.aliceId,
      }))
    )
    await db
      .update(knowledgeConnector)
      .set({ memberSyncStatus: 'idle', memberSyncLockToken: null })
      .where(eq(knowledgeConnector.id, memberFixture.connectorId))
    const actualList = memberAccess.listKnowledgeConnectorMemberCredentials
    const directory = vi
      .spyOn(memberAccess, 'listKnowledgeConnectorMemberCredentials')
      .mockImplementation(async (input) => {
        if (input.cursor) throw new Error('Directory page temporarily unavailable')
        return actualList(input)
      })
    const failed = await executeMemberSync(memberFixture.connectorId, {
      billingAttribution: billing,
    })
    expect(failed.error).toContain('Directory page temporarily unavailable')
    expect(directory).toHaveBeenCalledTimes(2)
    const [directoryInterrupted] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, memberFixture.connectorId))
    expect(directoryInterrupted.directoryCheckpoint).toMatchObject({
      phase: 'listing',
      cursor: expect.any(String),
    })
    const beforeResume = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.connectorId, memberFixture.connectorId))
    expect(beforeResume).toHaveLength(100)
    expect(
      beforeResume.every((row) => row.status === 'active' && row.listingCheckpoint === null)
    ).toBe(true)
    expect(
      memberFixture.members.every((member) => beforeResume.some((row) => row.id === member.id))
    ).toBe(true)
    directory.mockImplementation(actualList)
    directory.mockClear()
    fixture.list.mockResolvedValue({ documents: [], hasMore: false })
    const recovered = await executeMemberSync(memberFixture.connectorId, {
      billingAttribution: billing,
    })
    expect(recovered.error).toBeUndefined()
    expect(directory.mock.calls[0]?.[0].cursor).toBe(
      directoryInterrupted.directoryCheckpoint!.cursor
    )
    const complete = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.connectorId, memberFixture.connectorId))
    expect(complete).toHaveLength(103)
    expect(complete.every((row) => row.status === 'active')).toBe(true)
    expect(recovered.membersCompleted).toBe(103)
    const [directoryComplete] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, memberFixture.connectorId))
    expect(directoryComplete.directoryCheckpoint).toBeNull()
    directory.mockRestore()
  }, 60_000)
  it.each(['checkpoint', 'page', 'replacement'] as const)(
    'handles an archive at %s without leaving or stealing a lease',
    async (stage) => {
      await db
        .update(knowledgeConnector)
        .set({
          archivedAt: null,
          deletedAt: null,
          status: 'active',
          syncLockToken: null,
          listingCheckpoint: null,
          connectorType: 'google_drive',
          accessMode: 'workspace',
        })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      const replacementToken = generateId()
      let originalToken: string | null = null
      const archive = async () => {
        const [before] = await db
          .select()
          .from(knowledgeConnector)
          .where(eq(knowledgeConnector.id, ids.connectorId))
        originalToken = before.syncLockToken
        await db
          .update(knowledgeConnector)
          .set({
            archivedAt: new Date(),
            ...(stage === 'replacement' ? { syncLockToken: replacementToken } : {}),
          })
          .where(eq(knowledgeConnector.id, ids.connectorId))
      }
      const token = vi
        .spyOn(connectorTokens, 'resolveConnectorAccessToken')
        .mockImplementation(async () => {
          if (stage !== 'page') await archive()
          return { accessToken: 'fixture-token' }
        })
      fixture.list.mockImplementation(async () => {
        await archive()
        return { documents: [], hasMore: false }
      })
      try {
        const outcome = await executeSync(ids.connectorId, { billingAttribution: billing })
        const [after] = await db
          .select()
          .from(knowledgeConnector)
          .where(eq(knowledgeConnector.id, ids.connectorId))
        expect(originalToken).toEqual(expect.any(String))
        if (stage === 'replacement') {
          expect(outcome.skipReason).toBe('sync_superseded')
          expect(after.syncLockToken).toBe(replacementToken)
          expect(after.status).toBe('syncing')
        } else {
          expect(outcome.skipReason).toBe('connector_deleted_during_sync')
          expect(after.syncLockToken).toBeNull()
          expect(after.syncLockLeaseAt).toBeNull()
          expect(after.nextSyncAt).toBeNull()
          expect(after.status).toBe('error')
          const [log] = await db
            .select()
            .from(knowledgeConnectorSyncLog)
            .where(eq(knowledgeConnectorSyncLog.id, originalToken!))
          expect(log.status).toBe('failed')
          expect(log.completedAt).toBeInstanceOf(Date)
        }
      } finally {
        token.mockRestore()
      }
    }
  )
})
