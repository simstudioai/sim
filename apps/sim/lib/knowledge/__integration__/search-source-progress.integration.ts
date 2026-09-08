import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  organization,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listKnowledgeConnectorDocuments } from '@/lib/knowledge/application/connectors'
import { readSearchSourceProgress } from '@/lib/knowledge/application/search-source-progress'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'

const ids = createKnowledgeAclFixtureIds()
const alice = { kind: 'session' as const, userId: ids.aliceId, sessionId: 'fixture-alice' }
const bob = { kind: 'session' as const, userId: ids.bobId, sessionId: 'fixture-bob' }
const failedId = generateId()
const pendingId = generateId()
const input = { workspaceId: ids.workspaceId, connectorIds: [ids.connectorId] }

beforeAll(async () => {
  await seedKnowledgeAclFixture(ids)
  await db
    .update(knowledgeBase)
    .set({ isSearchIndex: true })
    .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
  await db
    .update(knowledgeConnector)
    .set({ status: 'active', syncLockToken: null })
    .where(eq(knowledgeConnector.id, ids.connectorId))
  await db.insert(document).values(
    [
      { id: failedId, status: 'failed', owner: ids.aliceId },
      { id: pendingId, status: 'pending', owner: ids.bobId },
    ].map((row) => ({
      id: row.id,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorId: ids.connectorId,
      externalId: row.id,
      filename: `${row.status}.txt`,
      fileUrl: `https://fixture.test/${row.id}`,
      fileSize: 10,
      mimeType: 'text/plain',
      processingStatus: row.status,
      acl: [`u:${row.owner}@fixture.test`],
      aclVerifiedAt: new Date(),
    }))
  )
})
afterAll(async () => {
  await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(eq(user.id, ids.aliceId))
  await db.delete(user).where(eq(user.id, ids.bobId))
})

describe('viewer-isolated indexing progress and recovery lists', () => {
  it('keeps failed and pending state scoped to the viewer, including admins', async () => {
    expect((await readSearchSourceProgress.execute({ principal: alice, input })).sources).toEqual([
      {
        connectorId: ids.connectorId,
        isSyncing: false,
        hasSyncError: false,
        hasIndexingError: true,
      },
    ])
    expect((await readSearchSourceProgress.execute({ principal: bob, input })).sources).toEqual([
      {
        connectorId: ids.connectorId,
        isSyncing: true,
        hasSyncError: false,
        hasIndexingError: false,
      },
    ])
    const [aliceSources, bobSources] = await Promise.all(
      [alice, bob].map((principal) =>
        listSearchSources.execute({ principal, input: { workspaceId: ids.workspaceId } })
      )
    )
    expect(aliceSources.sources[0].viewerFailedDocumentCount).toBe(1)
    expect(bobSources.sources[0].viewerFailedDocumentCount).toBe(0)
  })
  it('only lists accessible failures, with authoritative filtered pagination', async () => {
    const read = (principal: typeof alice) =>
      listKnowledgeConnectorDocuments.execute({
        principal,
        input: {
          knowledgeBaseId: ids.knowledgeBaseId,
          connectorId: ids.connectorId,
          failedOnly: true,
          limit: 1,
        },
      })
    const result = await read(alice)
    expect(result.documents.map((doc) => doc.id)).toEqual([failedId])
    expect(result.counts.failed).toBe(1)
    expect(result.hasMore).toBe(false)
    expect((await read(bob)).documents).toEqual([])
  })
  it('does not report excluded or deleted failures as actionable', async () => {
    await db.update(document).set({ userExcluded: true }).where(eq(document.id, failedId))
    expect(
      (await readSearchSourceProgress.execute({ principal: alice, input })).sources[0]
        .hasIndexingError
    ).toBe(false)
    await db
      .update(document)
      .set({ userExcluded: false, deletedAt: new Date() })
      .where(eq(document.id, failedId))
    expect(
      (await readSearchSourceProgress.execute({ principal: alice, input })).sources[0]
        .hasIndexingError
    ).toBe(false)
  })
  it('rechecks membership before showing progress', async () => {
    await db
      .delete(permissions)
      .where(and(eq(permissions.entityId, ids.workspaceId), eq(permissions.userId, ids.bobId)))
    await expect(readSearchSourceProgress.execute({ principal: bob, input })).rejects.toThrow(
      'Insufficient workspace permissions'
    )
  })
})
