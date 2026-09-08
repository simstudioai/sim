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
import type { ConnectorDocumentFilter } from '@/lib/api/contracts/knowledge/connectors'
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

describe('connector document filename search and document sets', () => {
  const fixture = createKnowledgeAclFixtureIds()
  const viewer = { kind: 'session' as const, userId: fixture.aliceId, sessionId: 'fixture-search' }
  const otherViewer = { ...viewer, userId: fixture.bobId }
  const planIds = [generateId(), generateId()].sort()
  const excludedId = generateId()
  const failureId = generateId()
  const privateId = generateId()
  const literalId = generateId()
  const quoteId = generateId()
  const scope = { knowledgeBaseId: fixture.knowledgeBaseId, connectorId: fixture.connectorId }

  beforeAll(async () => {
    await seedKnowledgeAclFixture(fixture)
    const rows: Array<Partial<typeof document.$inferInsert> & { id: string; filename: string }> = [
      ...Array.from({ length: 221 }, (_, index) => ({
        id: generateId(),
        filename: `aaa-${String(index).padStart(3, '0')}.md`,
      })),
      ...planIds.map((id) => ({ id, filename: 'zNeedle plan.md' })),
      { id: failureId, filename: 'zNeedle failure.md', processingStatus: 'failed' },
      {
        id: excludedId,
        filename: 'zNeedle excluded.md',
        processingStatus: 'failed',
        userExcluded: true,
      },
      {
        id: privateId,
        filename: 'zNeedle private.md',
        processingStatus: 'failed',
        acl: [`u:${fixture.bobId}@fixture.test`],
      },
      { id: generateId(), filename: 'zNeedle deleted.md', deletedAt: new Date() },
      { id: generateId(), filename: 'zNeedle archived.md', archivedAt: new Date() },
      { id: literalId, filename: 'Literal 50%_\\Team.md' },
      { id: generateId(), filename: 'Literal 500ABC Team.md' },
      { id: quoteId, filename: "O'Brien.md" },
    ]
    await db.insert(document).values(
      rows.map((row) => ({
        knowledgeBaseId: fixture.knowledgeBaseId,
        connectorId: fixture.connectorId,
        externalId: row.id,
        fileUrl: `https://fixture.test/${row.id}`,
        fileSize: 10,
        mimeType: 'text/plain',
        processingStatus: 'completed',
        acl: [`u:${fixture.aliceId}@fixture.test`],
        aclVerifiedAt: new Date(),
        ...row,
      }))
    )
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, fixture.workspaceId))
    await db.delete(organization).where(eq(organization.id, fixture.organizationId))
    await db.delete(user).where(eq(user.id, fixture.aliceId))
    await db.delete(user).where(eq(user.id, fixture.bobId))
  })

  it('finds documents beyond the first page and returns all searched counts for every set', async () => {
    const firstPage = await listKnowledgeConnectorDocuments.execute({
      principal: viewer,
      input: { ...scope, filter: 'active', limit: 200 },
    })
    expect(firstPage.documents).toHaveLength(200)
    expect(firstPage.hasMore).toBe(true)
    expect(firstPage.documents.every((row) => row.filename.startsWith('aaa-'))).toBe(true)

    const expectedIds: Record<ConnectorDocumentFilter, string[]> = {
      active: [failureId, ...planIds],
      excluded: [excludedId],
      failed: [failureId],
    }
    for (const filter of ['active', 'excluded', 'failed'] as const) {
      const result = await listKnowledgeConnectorDocuments.execute({
        principal: viewer,
        input: { ...scope, filter, search: '  nEeDle  ' },
      })
      expect(result.documents.map((row) => row.id)).toEqual(expectedIds[filter])
      expect(result.counts).toEqual({ active: 3, excluded: 1, failed: 1 })
      expect(result.hasMore).toBe(false)
    }
  })

  it('paginates within matching filenames with a stable ID tie-breaker', async () => {
    const results = []
    for (const offset of [0, 1]) {
      results.push(
        await listKnowledgeConnectorDocuments.execute({
          principal: viewer,
          input: { ...scope, filter: 'active', search: 'needle plan', limit: 1, offset },
        })
      )
    }
    expect(results.flatMap((result) => result.documents.map((row) => row.id))).toEqual(planIds)
    expect(results.map((result) => result.hasMore)).toEqual([true, false])
    expect(results.map((result) => result.counts.active)).toEqual([2, 2])
  })

  it('treats SQL pattern characters and quotes literally', async () => {
    for (const [search, id] of [
      ['50%_\\', literalId],
      ["O'Brien", quoteId],
    ] as const) {
      const result = await listKnowledgeConnectorDocuments.execute({
        principal: viewer,
        input: { ...scope, filter: 'active', search },
      })
      expect(result.documents.map((row) => row.id)).toEqual([id])
      expect(result.counts).toEqual({ active: 1, excluded: 0, failed: 0 })
    }
  })

  it('keeps legacy flags and limits both results and counts to current document access', async () => {
    const mixed = await listKnowledgeConnectorDocuments.execute({
      principal: viewer,
      input: { ...scope, search: 'needle', includeExcluded: true },
    })
    expect(mixed.documents.map((row) => row.id)).toEqual([failureId, ...planIds, excludedId])
    const failures = await listKnowledgeConnectorDocuments.execute({
      principal: viewer,
      input: { ...scope, search: 'needle', includeExcluded: true, failedOnly: true },
    })
    expect(failures.documents.map((row) => row.id)).toEqual([failureId])
    const override = await listKnowledgeConnectorDocuments.execute({
      principal: viewer,
      input: { ...scope, search: 'needle', filter: 'excluded', failedOnly: true },
    })
    expect(override.documents.map((row) => row.id)).toEqual([excludedId])
    const privateResult = await listKnowledgeConnectorDocuments.execute({
      principal: otherViewer,
      input: { ...scope, filter: 'active', search: 'needle' },
    })
    expect(privateResult.documents.map((row) => row.id)).toEqual([privateId])
    expect(privateResult.counts).toEqual({ active: 1, excluded: 0, failed: 1 })

    await db
      .delete(permissions)
      .where(
        and(eq(permissions.entityId, fixture.workspaceId), eq(permissions.userId, fixture.bobId))
      )
    await expect(
      listKnowledgeConnectorDocuments.execute({
        principal: otherViewer,
        input: { ...scope, filter: 'active', search: 'needle' },
      })
    ).rejects.toThrow('Insufficient workspace permissions')
  })
})
