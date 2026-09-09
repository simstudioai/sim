import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  member,
  organization,
  organizationSearchIntegration,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { readSearchSourceOverview } from '@/lib/knowledge/application/search-source-overview'
import { readSearchSourceProgress } from '@/lib/knowledge/application/search-source-progress'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'

const ids = createKnowledgeAclFixtureIds()
const alice = { kind: 'session' as const, userId: ids.aliceId, sessionId: 'fixture-alice' }
const bob = { kind: 'session' as const, userId: ids.bobId, sessionId: 'fixture-bob' }
const sourceIds = Array.from({ length: 105 }, () => generateId())
  .sort()
  .reverse()
const olderSourceId = generateId()
const documentId = generateId()
const embeddingId = generateId()
const input = { workspaceId: ids.workspaceId }

beforeAll(async () => {
  await seedKnowledgeAclFixture(ids)
  await db
    .update(knowledgeBase)
    .set({ isSearchIndex: true })
    .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
  await db
    .update(knowledgeConnector)
    .set({ archivedAt: new Date() })
    .where(eq(knowledgeConnector.id, ids.connectorId))
  await db.insert(knowledgeConnector).values(
    sourceIds.map((id) => ({
      id,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'confluence',
      sourceConfig: { domain: 'fixture.atlassian.net', spaceKey: 'ENG' },
      accessMode: 'admin',
      status: 'active',
    }))
  )
  await db
    .update(knowledgeConnector)
    .set({ createdAt: sql`'2026-01-01 00:00:00.123456'::timestamp` })
    .where(inArray(knowledgeConnector.id, sourceIds))
  await db.insert(knowledgeConnector).values({
    id: olderSourceId,
    knowledgeBaseId: ids.knowledgeBaseId,
    connectorType: 'google_drive',
    sourceConfig: { folderId: 'opaque-fixture-id' },
    accessMode: 'admin',
    status: 'active',
    createdAt: new Date('2025-12-31T00:00:00Z'),
  })
  await db.insert(document).values({
    id: documentId,
    connectorId: olderSourceId,
    knowledgeBaseId: ids.knowledgeBaseId,
    externalId: 'fixture',
    filename: 'readable.txt',
    fileUrl: 'https://fixture.test/readable',
    fileSize: 12,
    mimeType: 'text/plain',
    processingStatus: 'completed',
    acl: [`u:${ids.aliceId}@fixture.test`],
    aclVerifiedAt: new Date(),
  })
  await db.insert(embedding).values({
    id: embeddingId,
    documentId,
    knowledgeBaseId: ids.knowledgeBaseId,
    chunkIndex: 0,
    chunkHash: 'fixture-hash',
    content: 'Fixture text',
    contentLength: 12,
    tokenCount: 3,
    startOffset: 0,
    endOffset: 12,
    embeddingModel: 'text-embedding-3-small',
    embedding: [1, ...Array<number>(1535).fill(0)],
  })
})

afterAll(async () => {
  await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(eq(user.id, ids.aliceId))
  await db.delete(user).where(eq(user.id, ids.bobId))
})

describe('bounded source pagination and provider overview', () => {
  it('finds a provider beyond the unfiltered candidate bound on its first filtered page', async () => {
    const result = await listSearchSources.execute({
      principal: alice,
      input: { ...input, connectorType: 'google_drive' },
    })
    expect(result.sources.map((source) => source.connectorId)).toEqual([olderSourceId])
    expect(result.nextCursor).toBeNull()
  })
  it('walks tied microsecond timestamps without duplicating or skipping sources', async () => {
    const found: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 5; page++) {
      const result = await listSearchSources.execute({
        principal: alice,
        input: { ...input, cursor },
      })
      expect(result.sources.length).toBeLessThanOrEqual(25)
      found.push(...result.sources.map((source) => source.connectorId))
      cursor = result.nextCursor ?? undefined
      if (!cursor) break
    }
    expect(cursor).toBeUndefined()
    expect(found).toEqual([...sourceIds, olderSourceId])
    expect(new Set(found).size).toBe(106)
  })
  it('continues after a sparse filtered page to find sources beyond the candidate bound', async () => {
    const first = await listSearchSources.execute({
      principal: alice,
      input: { ...input, search: 'Google Drive' },
    })
    expect(first.sources).toEqual([])
    expect(first.nextCursor).not.toBeNull()
    const second = await listSearchSources.execute({
      principal: alice,
      input: { ...input, search: ' google drive ', cursor: first.nextCursor! },
    })
    expect(second.sources.map((source) => source.connectorId)).toEqual([olderSourceId])
    expect(second.nextCursor).toBeNull()
  })
  it('includes providers beyond the loaded page and requires viewer-readable indexed content', async () => {
    const first = await listSearchSources.execute({ principal: alice, input })
    expect(first.sources.every((source) => source.connectorType === 'confluence')).toBe(true)
    const [aliceOverview, bobOverview] = await Promise.all(
      [alice, bob].map((principal) => readSearchSourceOverview.execute({ principal, input }))
    )
    expect(aliceOverview.providers).toEqual(
      expect.arrayContaining([{ connectorType: 'google_drive', isSyncing: false }])
    )
    expect(aliceOverview.hasSearchableDocuments).toBe(true)
    expect(bobOverview.hasSearchableDocuments).toBe(false)
  })
  it('keeps paused but readable sources complete and ignores disabled chunks', async () => {
    await db
      .update(knowledgeConnector)
      .set({ status: 'paused' })
      .where(eq(knowledgeConnector.id, olderSourceId))
    const paused = await readSearchSourceOverview.execute({ principal: alice, input })
    expect(paused.hasSearchableDocuments).toBe(true)
    expect(paused.providers.every((provider) => !provider.isSyncing)).toBe(true)
    await db.update(embedding).set({ enabled: false }).where(eq(embedding.id, embeddingId))
    expect(
      (await readSearchSourceOverview.execute({ principal: alice, input })).hasSearchableDocuments
    ).toBe(false)
  })
  it('shows a newly created source on the first-page refresh so enrollment can observe completion', async () => {
    const before = await listSearchSources.execute({ principal: alice, input })
    expect(before.sources[0].connectorId).toBe(sourceIds[0])
    const newSourceId = generateId()
    await db.insert(knowledgeConnector).values({
      id: newSourceId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'confluence',
      sourceConfig: { domain: 'fixture.atlassian.net', spaceKey: 'NEW' },
      accessMode: 'admin',
      status: 'pending',
    })
    const refreshed = await listSearchSources.execute({ principal: alice, input })
    expect(refreshed.sources[0]).toMatchObject({ connectorId: newSourceId, isSyncing: true })
    expect(refreshed.sources.map((source) => source.connectorId)).toEqual([
      newSourceId,
      ...sourceIds.slice(0, 24),
    ])
    const next = await listSearchSources.execute({
      principal: alice,
      input: { ...input, cursor: refreshed.nextCursor! },
    })
    expect(next.sources.map((source) => source.connectorId)).toEqual(sourceIds.slice(24, 49))
  })
  it('does not report deactivated pending sources as indexing in any read model', async () => {
    await db.insert(member).values({
      id: generateId(),
      organizationId: ids.organizationId,
      userId: ids.aliceId,
      role: 'admin',
      createdAt: new Date(),
    })
    await db
      .update(knowledgeBase)
      .set({ workspaceId: null, organizationId: ids.organizationId })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    const approvalSourceId = generateId()
    await db.insert(knowledgeConnector).values({
      id: approvalSourceId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'google_drive',
      sourceConfig: {},
      accessMode: 'admin',
      status: 'pending',
    })
    await db.insert(organizationSearchIntegration).values({
      organizationId: ids.organizationId,
      connectorType: 'google_drive',
      approved: false,
    })
    const owner = { organizationId: ids.organizationId }
    const [progress, overview, summary] = await Promise.all([
      readSearchSourceProgress.execute({
        principal: alice,
        input: { ...owner, connectorIds: [approvalSourceId] },
      }),
      readSearchSourceOverview.execute({ principal: alice, input: owner }),
      listSearchSources.execute({ principal: alice, input: owner }),
    ])
    expect(progress.sources[0].isSyncing).toBe(false)
    expect(
      overview.providers.find((provider) => provider.connectorType === 'google_drive')?.isSyncing
    ).toBe(false)
    expect(summary.sources[0]).toMatchObject({
      connectorId: approvalSourceId,
      approved: false,
      isSyncing: false,
    })
  })
})
