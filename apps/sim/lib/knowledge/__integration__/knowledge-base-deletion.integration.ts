/** Real PostgreSQL coverage for soft deletion racing with document publication. */
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { deleteKnowledgeBase } from '@/lib/knowledge/service'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function blockedBackend(blockingPid: number) {
  const [row] = await db.execute<{ pid: number }>(sql`
    SELECT pid FROM pg_stat_activity
    WHERE ${blockingPid} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock'
    LIMIT 1
  `)
  return row?.pid
}

describe('knowledge base deletion in PostgreSQL', () => {
  const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []

  async function seed() {
    const ids = createKnowledgeAclFixtureIds()
    fixtures.push(ids)
    await seedKnowledgeAclFixture(ids)
    const documentId = generateId()
    await db.insert(document).values({
      id: documentId,
      knowledgeBaseId: ids.knowledgeBaseId,
      filename: 'fixture.txt',
      fileUrl: 'data:text/plain,fixture',
      fileSize: 7,
      mimeType: 'text/plain',
      processingStatus: 'processing',
    })
    return { ...ids, documentId }
  }

  afterEach(async () => {
    for (const ids of fixtures.splice(0)) {
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
  })

  it('lets in-flight embeddings commit before archiving children and serializes competing deletes', async () => {
    const ids = await seed()
    const other = await seed()
    const archivedAt = new Date('2025-01-01T00:00:00.000Z')
    const documentLocked = deferred<number>()
    const publish = deferred<void>()

    /** Match processing's document lock followed by the embedding foreign-key checks. */
    const processing = db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`)
      const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      const active = await tx
        .select({ id: document.id })
        .from(document)
        .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
        .where(
          and(
            eq(document.id, ids.documentId),
            eq(document.processingStatus, 'processing'),
            isNull(document.archivedAt),
            isNull(document.deletedAt),
            isNull(knowledgeBase.deletedAt)
          )
        )
        .for('update', { of: document })
        .limit(1)
      expect(active).toEqual([{ id: ids.documentId }])
      documentLocked.resolve(backend.pid)
      await publish.promise
      await tx.insert(embedding).values({
        id: generateId(),
        knowledgeBaseId: ids.knowledgeBaseId,
        documentId: ids.documentId,
        chunkIndex: 0,
        chunkHash: 'fixture',
        content: 'fixture',
        contentLength: 7,
        tokenCount: 1,
        startOffset: 0,
        endOffset: 7,
        embedding: Array.from({ length: 1536 }, () => 0.01),
      })
      await tx
        .update(document)
        .set({ processingStatus: 'completed', chunkCount: 1 })
        .where(eq(document.id, ids.documentId))
    })
    const processingResult = Promise.allSettled([processing])
    void processing.catch(documentLocked.reject)
    let deletions: Promise<PromiseSettledResult<void>[]> | undefined

    try {
      const processingPid = await documentLocked.promise
      const deletion = deleteKnowledgeBase(ids.knowledgeBaseId, 'delete-fixture', {
        archivedAt,
        assertedWorkspaceId: ids.workspaceId,
      })
      deletions = Promise.allSettled([deletion])

      /** Observe the actual lock wait instead of relying on transaction scheduling delays. */
      await expect.poll(() => blockedBackend(processingPid), { timeout: 5000 }).toBeDefined()
      const deletionPid = await blockedBackend(processingPid)
      expect(deletionPid).toBeDefined()

      const competingDeletion = deleteKnowledgeBase(ids.knowledgeBaseId, 'competing-delete', {
        archivedAt: new Date(archivedAt.getTime() + 1000),
        assertedWorkspaceId: ids.workspaceId,
      })
      deletions = Promise.allSettled([deletion, competingDeletion])
      await expect.poll(() => blockedBackend(deletionPid!), { timeout: 5000 }).toBeDefined()

      publish.resolve()
      expect(await processingResult).toEqual([{ status: 'fulfilled', value: undefined }])
      expect(await deletions).toMatchObject([
        { status: 'fulfilled', value: undefined },
        { status: 'rejected', reason: { code: 'not_found' } },
      ])
    } finally {
      publish.resolve()
      await processingResult
      await deletions
    }

    const [kb] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    const [doc] = await db.select().from(document).where(eq(document.id, ids.documentId))
    const [connector] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, ids.connectorId))
    expect(kb).toMatchObject({ deletedAt: archivedAt, updatedAt: archivedAt })
    expect(doc).toMatchObject({
      archivedAt,
      deletedAt: null,
      processingStatus: 'completed',
      chunkCount: 1,
    })
    expect(connector).toMatchObject({ archivedAt, deletedAt: null, status: 'paused' })
    expect(
      await db
        .select({ id: embedding.id })
        .from(embedding)
        .where(eq(embedding.documentId, ids.documentId))
    ).toHaveLength(1)
    const [otherDoc] = await db.select().from(document).where(eq(document.id, other.documentId))
    expect(otherDoc.archivedAt).toBeNull()
  })

  it.each(['wrong workspace', 'search index'] as const)(
    'preserves the %s guard without archiving children',
    async (guard) => {
      const ids = await seed()
      if (guard === 'search index') {
        await db
          .update(knowledgeBase)
          .set({ isSearchIndex: true })
          .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      }
      await expect(
        deleteKnowledgeBase(ids.knowledgeBaseId, 'guard-fixture', {
          assertedWorkspaceId: guard === 'wrong workspace' ? generateId() : ids.workspaceId,
        })
      ).rejects.toMatchObject({ code: guard === 'wrong workspace' ? 'not_found' : 'forbidden' })
      const [kb] = await db
        .select()
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      const [doc] = await db.select().from(document).where(eq(document.id, ids.documentId))
      const [connector] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
      expect(kb.deletedAt).toBeNull()
      expect(doc.archivedAt).toBeNull()
      expect(connector.archivedAt).toBeNull()
    }
  )
})
