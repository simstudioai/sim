/** Real PostgreSQL proof that legacy deferred vector repair survives indexed Search retirement. */
import { db } from '@sim/db'
import {
  hasKnowledgeProjectionWork,
  releaseSettledMarks,
  runKnowledgeProjection,
} from '@sim/db/knowledge-projection'
import {
  document,
  embedding,
  embeddingKeywordSearch,
  embeddingKeywordTin,
  embeddingSearch,
  knowledgeBase,
  knowledgeProjectionDirty,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'

const ids = createKnowledgeAclFixtureIds()
const searchBaseId = generateId()
const documentId = generateId()
const searchDocumentId = generateId()
const vector = Array.from({ length: 1536 }, (_, index) => (index === 511 ? 1 : 0))
let projector: postgres.Sql

function chunkRow(id: string, chunkIndex: number, search = false) {
  return {
    id,
    documentId: search ? searchDocumentId : documentId,
    knowledgeBaseId: search ? searchBaseId : ids.knowledgeBaseId,
    chunkIndex,
    chunkHash: `fixture-hash-${chunkIndex}`,
    content: 'fixture readme',
    contentLength: 14,
    tokenCount: 2,
    startOffset: 0,
    endOffset: 14,
    embeddingModel: 'text-embedding-3-small',
    embedding: vector,
  }
}

/** Reproduces pending writes from the older release that deferred its projections. */
async function defer(
  work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<unknown>
) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('sim.projection_mode', 'async', true)`)
    await work(tx)
  })
}

const markOf = async (id = documentId) => {
  const [row] = await db
    .select()
    .from(knowledgeProjectionDirty)
    .where(eq(knowledgeProjectionDirty.documentId, id))
  return row
}

const vectorsOf = (id = documentId) =>
  db
    .select({
      id: embeddingSearch.id,
      enabled: embeddingSearch.enabled,
      vector512: embeddingSearch.vector512,
      acl: embeddingSearch.acl,
      connectorId: embeddingSearch.connectorId,
    })
    .from(embeddingSearch)
    .where(eq(embeddingSearch.documentId, id))

beforeAll(async () => {
  await seedKnowledgeAclFixture(ids)
  projector = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined })
  await db.insert(knowledgeBase).values({
    id: searchBaseId,
    userId: ids.aliceId,
    workspaceId: ids.workspaceId,
    name: 'Retired projection fixture',
    chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 20 },
  })
})

beforeEach(async () => {
  await db
    .delete(document)
    .where(inArray(document.knowledgeBaseId, [ids.knowledgeBaseId, searchBaseId]))
  await db
    .update(knowledgeBase)
    .set({ isSearchIndex: false })
    .where(inArray(knowledgeBase.id, [ids.knowledgeBaseId, searchBaseId]))
  await db.insert(document).values(
    [
      { id: documentId, knowledgeBaseId: ids.knowledgeBaseId },
      { id: searchDocumentId, knowledgeBaseId: searchBaseId },
    ].map((row) => ({
      ...row,
      filename: 'repair.md',
      fileUrl: 'https://fixture.test/repair',
      fileSize: 12,
      mimeType: 'text/plain',
      processingStatus: 'completed',
    }))
  )
})

afterAll(async () => {
  await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  await projector?.end()
})

describe('ordinary KB vector repair after indexed Search retirement', () => {
  it('repairs deferred vectors in bounded pages without creating copied ACL or keyword rows', async () => {
    const chunks = Array.from({ length: 5 }, (_, index) => chunkRow(generateId(), index))
    await defer((tx) => tx.insert(embedding).values(chunks))
    expect(await vectorsOf()).toEqual([])
    expect(await markOf()).toMatchObject({ content: true })
    const writes: number[] = []
    await runKnowledgeProjection(projector, {
      pageSize: 2,
      onPage: (page) => {
        if (page.documentId === documentId) writes.push(page.written)
      },
    })
    expect(writes).toEqual([2, 2, 1])
    const rows = await vectorsOf()
    expect(rows.map((row) => row.id).sort()).toEqual(chunks.map((row) => row.id).sort())
    expect(
      rows.every(
        (row) => row.vector512?.[511] === 1 && row.acl === null && row.connectorId === null
      )
    ).toBe(true)
    expect(
      await db
        .select()
        .from(embeddingKeywordSearch)
        .where(eq(embeddingKeywordSearch.documentId, documentId))
    ).toEqual([])
    expect(
      await db
        .select()
        .from(embeddingKeywordTin)
        .where(eq(embeddingKeywordTin.documentId, documentId))
    ).toEqual([])
    expect(await markOf()).toBeUndefined()
  })

  it('settles retired Search content marks without recreating any candidate projection', async () => {
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true })
      .where(eq(knowledgeBase.id, searchBaseId))
    await defer((tx) => tx.insert(embedding).values(chunkRow(generateId(), 0, true)))
    expect(await markOf(searchDocumentId)).toMatchObject({ content: true })
    await runKnowledgeProjection(projector, {})
    expect(await vectorsOf(searchDocumentId)).toEqual([])
    expect(
      await db
        .select()
        .from(embeddingKeywordSearch)
        .where(eq(embeddingKeywordSearch.documentId, searchDocumentId))
    ).toEqual([])
    expect(
      await db
        .select()
        .from(embeddingKeywordTin)
        .where(eq(embeddingKeywordTin.documentId, searchDocumentId))
    ).toEqual([])
    expect(await markOf(searchDocumentId)).toBeUndefined()
  })

  it('settles permission-only marks without rewriting vector rows or canonical document access', async () => {
    const chunk = chunkRow(generateId(), 0)
    await db.insert(embedding).values(chunk)
    const [before] =
      await projector`SELECT xmin::text AS version FROM embedding_search WHERE id = ${chunk.id}`
    await defer((tx) => tx.update(document).set({ acl: [] }).where(eq(document.id, documentId)))
    expect(await markOf()).toMatchObject({ content: false })
    await runKnowledgeProjection(projector, {})
    const [after] =
      await projector`SELECT xmin::text AS version FROM embedding_search WHERE id = ${chunk.id}`
    expect(after.version).toBe(before.version)
    const [canonical] = await db
      .select({ acl: document.acl })
      .from(document)
      .where(eq(document.id, documentId))
    expect(canonical.acl).toEqual([])
    expect(await markOf()).toBeUndefined()
  })

  it('keeps a concurrent content change for the next pass instead of settling its newer generation', async () => {
    const chunks = [chunkRow(generateId(), 0), chunkRow(generateId(), 1)]
    await defer((tx) => tx.insert(embedding).values(chunks))
    const before = await markOf()
    let changed = false
    await runKnowledgeProjection(projector, {
      pageSize: 1,
      onPage: async (page) => {
        if (page.documentId !== documentId || changed) return
        changed = true
        await defer((tx) =>
          tx.update(embedding).set({ enabled: false }).where(eq(embedding.id, chunks[0].id))
        )
      },
    })
    expect((await markOf())?.generation).toBe((before?.generation ?? 0) + 1)
    expect((await vectorsOf()).find((row) => row.id === chunks[0].id)?.enabled).toBe(true)
    await runKnowledgeProjection(projector, {})
    expect((await vectorsOf()).find((row) => row.id === chunks[0].id)?.enabled).toBe(false)
    expect(await markOf()).toBeUndefined()
  })

  it('stops repairing a base marked as Search between committed pages', async () => {
    await defer((tx) =>
      tx
        .insert(embedding)
        .values(Array.from({ length: 3 }, (_, index) => chunkRow(generateId(), index)))
    )
    let changed = false
    await runKnowledgeProjection(projector, {
      pageSize: 1,
      onPage: async (page) => {
        if (page.documentId !== documentId || changed) return
        changed = true
        await db
          .update(knowledgeBase)
          .set({ isSearchIndex: true })
          .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      },
    })
    expect(await vectorsOf()).toHaveLength(1)
    expect(await markOf()).toBeUndefined()
  })

  it('does not resurrect a document deleted after the first page commits', async () => {
    await defer((tx) =>
      tx
        .insert(embedding)
        .values(Array.from({ length: 3 }, (_, index) => chunkRow(generateId(), index)))
    )
    await runKnowledgeProjection(projector, {
      pageSize: 1,
      onPage: async (page) => {
        if (page.documentId === documentId)
          await db.delete(document).where(eq(document.id, documentId))
      },
    })
    expect(await vectorsOf()).toEqual([])
    expect(await markOf()).toBeUndefined()
  })

  it('preserves work held by another pass until its advisory lock is released', async () => {
    await defer((tx) => tx.insert(embedding).values(chunkRow(generateId(), 0)))
    const other = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined })
    try {
      await other`SELECT pg_advisory_lock(hashtextextended('knowledge_projection:' || ${documentId}, 0))`
      await runKnowledgeProjection(projector, {})
      expect(await vectorsOf()).toEqual([])
      expect(await markOf()).toMatchObject({ content: true })
      await other`SELECT pg_advisory_unlock(hashtextextended('knowledge_projection:' || ${documentId}, 0))`
      await runKnowledgeProjection(projector, {})
      expect(await vectorsOf()).toHaveLength(1)
      expect(await markOf()).toBeUndefined()
    } finally {
      await other.end()
    }
  })

  it('yields after one thousand deferred documents without losing any pending marks', async () => {
    const documentIds = Array.from({ length: 1_001 }, () => generateId())
    await db.insert(document).values(
      documentIds.map((id) => ({
        id,
        knowledgeBaseId: ids.knowledgeBaseId,
        filename: 'deferred.md',
        fileUrl: 'https://fixture.test/deferred',
        fileSize: 12,
        mimeType: 'text/plain',
        processingStatus: 'completed',
      }))
    )
    await db
      .insert(knowledgeProjectionDirty)
      .values(documentIds.map((documentId) => ({ documentId, content: true })))
    const other = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined })
    try {
      await other`
        SELECT pg_advisory_lock(hashtextextended('knowledge_projection:' || id, 0))
        FROM unnest(${documentIds}::text[]) AS locked(id)`
      expect(await runKnowledgeProjection(projector, {})).toMatchObject({
        deferred: 1_000,
        written: 0,
        remaining: true,
      })
      const [pending] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(knowledgeProjectionDirty)
        .where(inArray(knowledgeProjectionDirty.documentId, documentIds))
      expect(pending.count).toBe(1_001)
    } finally {
      await other.end()
    }
  })

  it('resumes a bounded pass without rewriting an already current page', async () => {
    const chunks = Array.from({ length: 3 }, (_, index) => chunkRow(generateId(), index))
    await defer((tx) => tx.insert(embedding).values(chunks))
    const startedAt = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(startedAt)
    try {
      await runKnowledgeProjection(projector, {
        pageSize: 1,
        budgetMs: 1_000,
        onPage: (page) => {
          if (page.documentId === documentId) clock.mockReturnValue(startedAt + 1_000)
        },
      })
    } finally {
      clock.mockRestore()
    }
    expect(await vectorsOf()).toHaveLength(1)
    expect(await markOf()).toMatchObject({ content: true })
    const [before] =
      await projector`SELECT xmin::text AS version FROM embedding_search WHERE id = ${chunks[0].id}`
    await runKnowledgeProjection(projector, { pageSize: 1 })
    const [after] =
      await projector`SELECT xmin::text AS version FROM embedding_search WHERE id = ${chunks[0].id}`
    expect(after.version).toBe(before.version)
    expect(await vectorsOf()).toHaveLength(3)
    expect(await markOf()).toBeUndefined()
  })

  it('releases retired Search marks while retaining ordinary content repair for admission', async () => {
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true })
      .where(eq(knowledgeBase.id, searchBaseId))
    await defer((tx) =>
      tx.insert(embedding).values([chunkRow(generateId(), 0), chunkRow(generateId(), 0, true)])
    )
    await releaseSettledMarks(projector, Date.now() + 10_000)
    expect(await markOf(searchDocumentId)).toBeUndefined()
    expect(await markOf()).toMatchObject({ content: true })
    expect(await hasKnowledgeProjectionWork(projector)).toBe(true)
    expect(await vectorsOf(searchDocumentId)).toEqual([])
  })
})
