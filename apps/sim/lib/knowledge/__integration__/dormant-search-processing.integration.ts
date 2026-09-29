import { db } from '@sim/db'
import { document, knowledgeBase, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { processDocumentAsync, processDocumentsWithQueue } from '@/lib/knowledge/documents/service'

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
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
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
})
