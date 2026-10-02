import { db } from '@sim/db'
import { document, knowledgeBase, organization, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  createDocumentRecords,
  createSingleDocument,
  processDocumentAsync,
  processDocumentsWithQueue,
} from '@/lib/knowledge/documents/service'

/** Queued work cannot revive dormant Search before retirement reaches its documents. */
describe('dormant Search document processing', () => {
  const ids = createKnowledgeAclFixtureIds()
  const documentId = generateId()
  const source = {
    filename: 'fixture.txt',
    fileUrl: 'data:text/plain,fixture',
    fileSize: 7,
    mimeType: 'text/plain',
  }

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db
      .insert(document)
      .values({ id: documentId, knowledgeBaseId: ids.knowledgeBaseId, ...source })
  })

  afterAll(async () => {
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  })

  it('rejects uploads before creating documents in a dormant Search KB', async () => {
    await expect(
      createDocumentRecords([source], ids.knowledgeBaseId, generateId())
    ).rejects.toThrow('inactive')
    await expect(createSingleDocument(source, ids.knowledgeBaseId, generateId())).rejects.toThrow(
      'inactive'
    )
    const documents = await db
      .select({ id: document.id })
      .from(document)
      .where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))
    expect(documents).toEqual([{ id: documentId }])
  })

  it('refuses dispatch before stamping or charging a pending Search document', async () => {
    const result = await processDocumentsWithQueue(
      [{ documentId, ...source }],
      ids.knowledgeBaseId,
      {},
      generateId(),
      undefined,
      'backfill'
    )
    expect(result).toEqual({
      requested: 1,
      accepted: 0,
      failed: 1,
      failedDocumentIds: [documentId],
    })
    const [stored] = await db
      .select({ token: document.processingQueueToken, queuedAt: document.processingQueuedAt })
      .from(document)
      .where(eq(document.id, documentId))
    expect(stored).toEqual({ token: null, queuedAt: null })
  })

  it('skips an old worker payload before claiming the document or requiring billing', async () => {
    expect(await processDocumentAsync(ids.knowledgeBaseId, documentId, source)).toEqual({
      outcome: 'skipped',
      reason: 'unavailable',
    })
    const [stored] = await db
      .select({ status: document.processingStatus })
      .from(document)
      .where(eq(document.id, documentId))
    expect(stored.status).toBe('pending')
  })

  it('withdraws its own queued generation and refunds the charged attempt once', async () => {
    const queuedAt = new Date('2026-09-29T00:00:00.000Z')
    const token = generateId()
    await db
      .update(document)
      .set({ processingQueueToken: token, processingQueuedAt: queuedAt, processingAttempts: 2 })
      .where(eq(document.id, documentId))
    const attempt = {
      chargedAtDispatch: true,
      processingQueueToken: token,
      processingQueuedAt: queuedAt,
    }
    for (const _ of [1, 2]) {
      expect(
        await processDocumentAsync(
          ids.knowledgeBaseId,
          documentId,
          source,
          {},
          undefined,
          'pass',
          attempt
        )
      ).toEqual({ outcome: 'skipped', reason: 'unavailable' })
    }
    const [stored] = await db
      .select({
        status: document.processingStatus,
        token: document.processingQueueToken,
        queuedAt: document.processingQueuedAt,
        attempts: document.processingAttempts,
      })
      .from(document)
      .where(eq(document.id, documentId))
    expect(stored).toEqual({ status: 'pending', token, queuedAt: null, attempts: 1 })
  })

  it('leaves a newer queued generation untouched, even under a reused token', async () => {
    const queuedAt = new Date('2026-09-29T01:00:00.000Z')
    const newer = generateId()
    await db
      .update(document)
      .set({ processingQueueToken: newer, processingQueuedAt: queuedAt, processingAttempts: 1 })
      .where(eq(document.id, documentId))
    await processDocumentAsync(ids.knowledgeBaseId, documentId, source, {}, undefined, 'pass', {
      chargedAtDispatch: true,
      processingQueueToken: generateId(),
    })
    await processDocumentAsync(ids.knowledgeBaseId, documentId, source, {}, undefined, 'pass', {
      chargedAtDispatch: true,
      processingQueueToken: newer,
      processingQueuedAt: new Date('2026-09-29T00:30:00.000Z'),
    })
    const [stored] = await db
      .select({
        token: document.processingQueueToken,
        queuedAt: document.processingQueuedAt,
        attempts: document.processingAttempts,
      })
      .from(document)
      .where(eq(document.id, documentId))
    expect(stored).toEqual({ token: newer, queuedAt, attempts: 1 })
  })
})
