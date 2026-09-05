/** Real database coverage for search-index visibility and destructive operation boundaries. */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { document, folder, knowledgeBase, permissions, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { bulkDeleteKnowledgeItems } from '@/lib/knowledge/application/bulk'
import {
  listKnowledgeDocuments,
  readKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { deleteKnowledgeFolder } from '@/lib/knowledge/application/folders'
import {
  bulkDeleteKnowledgeBases,
  deleteInternalKnowledgeBase,
  deleteKnowledgeBaseOperation,
  listInternalKnowledgeBases,
  listKnowledgeBases,
  readInternalKnowledgeBase,
  readKnowledgeBase,
  restoreKnowledgeBase,
} from '@/lib/knowledge/application/knowledge-bases'
import { deleteKnowledgeBaseByVfsPath } from '@/lib/knowledge/application/knowledge-vfs'
import { deleteKnowledgeBase, updateKnowledgeBase } from '@/lib/knowledge/service'

const ids = createKnowledgeAclFixtureIds()
const input = { knowledgeBaseId: ids.knowledgeBaseId, assertedWorkspaceId: ids.workspaceId }
const admin: Principal = { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-admin' }
const writer: Principal = { kind: 'session', userId: ids.bobId, sessionId: 'fixture-writer' }
const workspaceKey: Principal = {
  kind: 'workspace_api_key',
  workspaceId: ids.workspaceId,
  keyId: 'fixture-key',
}
const privateId = generateId()
const sharedId = generateId()
const folderId = generateId()
const childId = generateId()
const indexName = 'Renamed shared search index'

function copilot(userId: string): Principal {
  return {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: userId,
    workspaceId: ids.workspaceId,
    delegationId: 'fixture-delegation',
    audience: 'sim:knowledge',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  }
}

async function expectIndexActive() {
  const [row] = await db
    .select({ deletedAt: knowledgeBase.deletedAt })
    .from(knowledgeBase)
    .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
  expect(row.deletedAt).toBeNull()
}

describe('canonical search knowledge-base policy', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected provider request in index policy tests')
    })
    await seedKnowledgeAclFixture(ids)
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true, name: indexName, userId: ids.bobId })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db
      .update(permissions)
      .set({ permissionType: 'write' })
      .where(and(eq(permissions.userId, ids.bobId), eq(permissions.entityId, ids.workspaceId)))
    await db.insert(document).values([
      {
        id: sharedId,
        knowledgeBaseId: ids.knowledgeBaseId,
        filename: 'Workspace handbook',
        fileUrl: 'https://fixture.test/shared',
        fileSize: 10,
        mimeType: 'text/plain',
        tokenCount: 10,
        processingStatus: 'completed',
      },
      {
        id: privateId,
        knowledgeBaseId: ids.knowledgeBaseId,
        filename: 'Private source document',
        fileUrl: 'https://fixture.test/private',
        fileSize: 20,
        mimeType: 'text/plain',
        tokenCount: 20,
        processingStatus: 'completed',
        connectorId: ids.connectorId,
        externalId: 'private-fixture',
        contentHash: 'fixture',
        acl: [`u:${ids.aliceId}@fixture.test`],
        aclVerifiedAt: new Date(),
      },
    ])
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(user).where(eq(user.id, ids.aliceId))
    await db.delete(user).where(eq(user.id, ids.bobId))
    vi.unstubAllGlobals()
  })

  it('projects document and token totals through the same caller ACL on UI and API reads', async () => {
    for (const [principal, docCount, tokenCount] of [
      [admin, 2, 30],
      [writer, 1, 10],
      [workspaceKey, 1, 10],
    ] as const) {
      const detail = await readKnowledgeBase.execute({ principal, input })
      expect(detail.knowledgeBase).toMatchObject({ isSearchIndex: true, docCount, tokenCount })
      const list = await listKnowledgeBases.execute({
        principal,
        input: { workspaceId: ids.workspaceId },
      })
      expect(list.knowledgeBases[0].knowledgeBase).toMatchObject({
        isSearchIndex: true,
        docCount,
        tokenCount,
      })
      if (principal.kind === 'session') {
        expect(
          (await readInternalKnowledgeBase.execute({ principal, input })).knowledgeBase
        ).toMatchObject({ isSearchIndex: true, docCount, tokenCount })
        expect(
          (
            await listInternalKnowledgeBases.execute({
              principal,
              input: { workspaceId: ids.workspaceId, scope: 'active' },
            })
          ).knowledgeBases[0]
        ).toMatchObject({ isSearchIndex: true, docCount, tokenCount })
      }
    }
  })

  it('hides inaccessible document names, filtered totals, and direct URLs', async () => {
    const listing = await listKnowledgeDocuments.execute({
      principal: writer,
      input: { ...input, search: 'Private' },
    })
    expect(listing.documents).toEqual([])
    expect(listing.pagination.total).toBe(0)
    await expect(
      readKnowledgeDocument.execute({
        principal: writer,
        input: { ...input, documentId: privateId },
      })
    ).rejects.toThrow('Document not found')
    await db
      .update(document)
      .set({ aclVerifiedAt: new Date(0) })
      .where(eq(document.id, privateId))
    expect(
      (await readKnowledgeBase.execute({ principal: admin, input })).knowledgeBase
    ).toMatchObject({ docCount: 1, tokenCount: 10 })
    await db.update(document).set({ aclVerifiedAt: new Date() }).where(eq(document.id, privateId))
  })

  it('refuses write-role deletion even when the writer created the index', async () => {
    await expect(deleteInternalKnowledgeBase.execute({ principal: writer, input })).rejects.toThrow(
      'Insufficient workspace permissions'
    )
    for (const principal of [
      writer,
      { kind: 'personal_api_key', userId: ids.bobId, keyId: 'fixture-personal' },
      workspaceKey,
      copilot(ids.bobId),
    ] as Principal[]) {
      await expect(deleteKnowledgeBaseOperation.execute({ principal, input })).rejects.toThrow()
    }
    await expect(
      deleteKnowledgeBaseByVfsPath.execute({
        principal: copilot(ids.bobId),
        input: { workspaceId: ids.workspaceId, sourceName: indexName },
      })
    ).rejects.toThrow('Insufficient workspace permissions')
    await expectIndexActive()
  })

  it('reports canonical-index bulk refusals without deleting it', async () => {
    const selection = {
      assertedWorkspaceId: ids.workspaceId,
      knowledgeBaseIds: [ids.knowledgeBaseId],
    }
    const bases = await bulkDeleteKnowledgeBases.execute({ principal: writer, input: selection })
    expect(bases.deleted).toEqual([])
    expect(bases.notFound).toEqual([ids.knowledgeBaseId])
    const items = await bulkDeleteKnowledgeItems.execute({
      principal: workspaceKey,
      input: { ...selection, folderIds: [] },
    })
    expect(items.deleted).toEqual([])
    expect(items.notFound).toEqual([{ kind: 'knowledgeBase', id: ids.knowledgeBaseId }])
    await expectIndexActive()
  })

  it('retains ordinary knowledge-base deletion for workspace writers', async () => {
    const ordinaryId = generateId()
    await db.insert(knowledgeBase).values({
      id: ordinaryId,
      name: 'Ordinary fixture',
      workspaceId: ids.workspaceId,
      userId: ids.aliceId,
    })
    await deleteKnowledgeBaseOperation.execute({
      principal: writer,
      input: { knowledgeBaseId: ordinaryId },
    })
    const [row] = await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, ordinaryId))
    expect(row.deletedAt).not.toBeNull()
  })

  it('refuses incidental folder cascades before deleting any child', async () => {
    await db.insert(folder).values({
      id: folderId,
      resourceType: 'knowledge_base',
      name: 'Index fixture folder',
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    await db.insert(knowledgeBase).values({
      id: childId,
      name: 'Sibling fixture',
      workspaceId: ids.workspaceId,
      userId: ids.aliceId,
      folderId,
    })
    await updateKnowledgeBase(ids.knowledgeBaseId, { folderId }, 'fixture-folder', {
      assertedWorkspaceId: ids.workspaceId,
    })
    for (const principal of [admin, writer]) {
      await expect(
        deleteKnowledgeFolder.execute({
          principal,
          input: {
            workspaceId: ids.workspaceId,
            path: '/Index%20fixture%20folder',
            recursive: true,
          },
        })
      ).rejects.toThrow('Delete the search knowledge base')
    }
    const bulk = await bulkDeleteKnowledgeItems.execute({
      principal: admin,
      input: { assertedWorkspaceId: ids.workspaceId, knowledgeBaseIds: [], folderIds: [folderId] },
    })
    expect(bulk.deleted).toEqual([])
    expect(bulk.failed).toHaveLength(1)
    expect(
      (await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, childId)))[0].deletedAt
    ).toBeNull()
    expect((await db.select().from(folder).where(eq(folder.id, folderId)))[0].deletedAt).toBeNull()
    await expectIndexActive()
  })

  it('enforces the canonical marker under the deletion lock and prevents detaching the index', async () => {
    await expect(
      deleteKnowledgeBase(ids.knowledgeBaseId, 'fixture-unguarded', {
        assertedWorkspaceId: ids.workspaceId,
      })
    ).rejects.toThrow('Only workspace admins')
    await expect(
      updateKnowledgeBase(ids.knowledgeBaseId, { workspaceId: null }, 'fixture-detach', {
        assertedWorkspaceId: ids.workspaceId,
        actorUserId: ids.bobId,
      })
    ).rejects.toThrow('The search index must stay in its workspace')
    await expectIndexActive()
  })

  it('allows explicit deletion by a current workspace admin and archives the document graph', async () => {
    await deleteInternalKnowledgeBase.execute({ principal: admin, input })
    expect(
      (await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId)))[0]
        .deletedAt
    ).not.toBeNull()
    for (const row of await db
      .select()
      .from(document)
      .where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))) {
      expect(row.archivedAt).not.toBeNull()
    }
  })

  it('refuses restoring a second canonical index without retrying name changes or reviving its children', async () => {
    const replacementId = generateId()
    await db.insert(knowledgeBase).values({
      id: replacementId,
      name: 'Replacement search index',
      workspaceId: ids.workspaceId,
      userId: ids.aliceId,
      isSearchIndex: true,
    })
    await expect(
      restoreKnowledgeBase.execute({ principal: admin, input: { ...input, source: 'ui' } })
    ).rejects.toThrow('This workspace already has an active search index')
    expect(
      (await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId)))[0]
        .deletedAt
    ).not.toBeNull()
    await deleteKnowledgeBaseOperation.execute({
      principal: { kind: 'personal_api_key', userId: ids.aliceId, keyId: 'fixture-admin-key' },
      input: { knowledgeBaseId: replacementId },
    })
    const restored = await restoreKnowledgeBase.execute({
      principal: admin,
      input: { ...input, source: 'ui' },
    })
    expect(restored.knowledgeBase).toMatchObject({
      isSearchIndex: true,
      docCount: 2,
      tokenCount: 30,
    })
    await expectIndexActive()
  })
})
