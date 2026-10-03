/** Real PostgreSQL coverage for workspace deletion and knowledge base ownership. */
import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mcp/pubsub', () => ({ mcpPubSub: null }))
vi.mock('@/lib/mcp/service', () => ({
  mcpService: { clearCache: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/lib/workflows/lifecycle', () => ({
  archiveWorkflowsForWorkspace: vi.fn().mockResolvedValue(0),
}))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  createAuthorizedKnowledgeBase,
  restoreKnowledgeBase,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import { archiveWorkspace } from '@/lib/workspaces/lifecycle'

describe('workspace knowledge lifecycle in PostgreSQL', () => {
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
      processingStatus: 'completed',
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

  it.each([false, true])(
    'deletes child KBs when workspace was already archived: %s',
    async (alreadyArchived) => {
      const ids = await seed()
      const other = await seed()
      const previousArchive = new Date('2025-01-01T00:00:00.000Z')
      if (alreadyArchived) {
        await db
          .update(workspace)
          .set({ archivedAt: previousArchive })
          .where(eq(workspace.id, ids.workspaceId))
      }

      expect(
        await archiveWorkspace(ids.workspaceId, { requestId: 'lifecycle-fixture' })
      ).toMatchObject({
        archived: !alreadyArchived,
      })

      const [ws] = await db.select().from(workspace).where(eq(workspace.id, ids.workspaceId))
      const [kb] = await db
        .select()
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      const [doc] = await db.select().from(document).where(eq(document.id, ids.documentId))
      const [connector] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
      expect(ws.archivedAt).toBeInstanceOf(Date)
      expect(kb).toMatchObject({ workspaceId: ids.workspaceId, deletedAt: ws.archivedAt })
      expect(doc).toMatchObject({ archivedAt: ws.archivedAt, deletedAt: null })
      expect(connector).toMatchObject({ archivedAt: ws.archivedAt, status: 'paused' })
      if (alreadyArchived) expect(ws.archivedAt).toEqual(previousArchive)

      await expect(
        restoreKnowledgeBase(ids.knowledgeBaseId, 'lifecycle-fixture')
      ).rejects.toMatchObject({
        code: 'conflict',
        message: 'Cannot restore knowledge base into an archived workspace',
      })
      await archiveWorkspace(ids.workspaceId, { requestId: 'lifecycle-retry' })
      const [unchanged] = await db
        .select()
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      expect(unchanged.deletedAt).toEqual(kb.deletedAt)
      const [otherKb] = await db
        .select()
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, other.knowledgeBaseId))
      expect(otherKb.deletedAt).toBeNull()
      const [otherDoc] = await db.select().from(document).where(eq(document.id, other.documentId))
      expect(otherDoc.archivedAt).toBeNull()
    }
  )

  it('hard deletion cascades to KBs, documents, and connectors', async () => {
    const ids = await seed()
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))

    expect(
      await db
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    ).toEqual([])
    expect(
      await db.select({ id: document.id }).from(document).where(eq(document.id, ids.documentId))
    ).toEqual([])
    expect(
      await db
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, ids.connectorId))
    ).toEqual([])
  })

  it('refuses owner detachment without changing the KB or its documents', async () => {
    const ids = await seed()
    await expect(
      /** @ts-expect-error Exercise a caller bypassing the HTTP contract. */
      updateKnowledgeBase(ids.knowledgeBaseId, { workspaceId: null }, 'lifecycle-fixture', {
        actorUserId: ids.aliceId,
      })
    ).rejects.toMatchObject({ code: 'validation' })
    const [kb] = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    expect(kb).toMatchObject({ workspaceId: ids.workspaceId, deletedAt: null })
    const [doc] = await db.select().from(document).where(eq(document.id, ids.documentId))
    expect(doc.archivedAt).toBeNull()
  })

  it('requires an owner for creation while allowing organization-owned indexes', async () => {
    const ids = await seed()
    const data = {
      name: 'Organization search',
      userId: ids.aliceId,
      embeddingModel: 'text-embedding-3-small',
      embeddingDimension: 1536 as const,
      chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 20 },
      isSearchIndex: true,
    }
    await expect(createAuthorizedKnowledgeBase(data, 'lifecycle-fixture')).rejects.toThrow(
      'Resource requires exactly one workspace or organization owner'
    )
    const kb = await createAuthorizedKnowledgeBase(
      { ...data, organizationId: ids.organizationId },
      'lifecycle-fixture'
    )
    expect(kb).toMatchObject({ workspaceId: null, organizationId: ids.organizationId })
  })
})
