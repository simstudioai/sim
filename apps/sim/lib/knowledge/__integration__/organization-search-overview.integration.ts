import { db } from '@sim/db'
import {
  account,
  credential,
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeConnectorMemberSyncLog,
  knowledgeConnectorSyncLog,
  member,
  organization,
  organizationSearchIntegration,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { readOrganizationSearchOverview } from '@/lib/knowledge/application/organization-search-overview'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'

const ids = createKnowledgeAclFixtureIds()
const indexId = generateId()
const driveId = generateId()
const pausedDriveId = generateId()
const gmailId = generateId()
const credentialId = generateId()
const accountId = generateId()
const memberId = generateId()
const documentId = generateId()
const sourceIds = [driveId, pausedDriveId, gmailId]
const principal = { kind: 'session', userId: ids.aliceId, sessionId: 'overview-admin' } as const
const input = { organizationId: ids.organizationId }

beforeAll(async () => {
  await seedKnowledgeAclFixture(ids)
  await db.insert(member).values([
    { id: generateId(), organizationId: ids.organizationId, userId: ids.aliceId, role: 'admin' },
    { id: generateId(), organizationId: ids.organizationId, userId: ids.bobId, role: 'member' },
  ])
  await db.insert(knowledgeBase).values({
    id: indexId,
    userId: ids.aliceId,
    organizationId: ids.organizationId,
    name: 'Overview fixture',
    isSearchIndex: true,
  })
  await db.insert(knowledgeConnector).values([
    {
      id: driveId,
      knowledgeBaseId: indexId,
      connectorType: 'google_drive',
      accessMode: 'admin',
      sourceConfig: {},
    },
    {
      id: pausedDriveId,
      knowledgeBaseId: indexId,
      connectorType: 'google_drive',
      accessMode: 'admin',
      sourceConfig: {},
    },
    {
      id: gmailId,
      knowledgeBaseId: indexId,
      connectorType: 'gmail',
      accessMode: 'members',
      sourceConfig: {},
    },
  ])
  await db.insert(account).values({
    id: accountId,
    accountId: ids.bobId,
    userId: ids.bobId,
    providerId: 'google-email',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(credential).values({
    id: credentialId,
    organizationId: ids.organizationId,
    type: 'oauth',
    displayName: 'Fixture connection',
    providerId: 'google-email',
    accountId,
    createdBy: ids.bobId,
  })
  await db.insert(knowledgeConnectorMember).values({
    id: memberId,
    organizationId: ids.organizationId,
    connectorId: gmailId,
    credentialId,
    subjectToken: `s:google-email:fixture:${ids.bobId}`,
  })
  await db.insert(document).values({
    id: documentId,
    knowledgeBaseId: indexId,
    connectorId: driveId,
    externalId: 'private-fixture',
    filename: 'private-title.txt',
    fileUrl: 'https://fixture.test/private',
    fileSize: 5,
    mimeType: 'text/plain',
    processingStatus: 'completed',
    acl: ['u:someone-else@fixture.test'],
    aclVerifiedAt: new Date(),
  })
})

beforeEach(async () => {
  await db
    .delete(organizationSearchIntegration)
    .where(eq(organizationSearchIntegration.organizationId, ids.organizationId))
  await db
    .delete(knowledgeConnectorMemberSyncLog)
    .where(inArray(knowledgeConnectorMemberSyncLog.connectorId, sourceIds))
  await db
    .delete(knowledgeConnectorSyncLog)
    .where(inArray(knowledgeConnectorSyncLog.connectorId, sourceIds))
  await db
    .update(knowledgeConnector)
    .set({
      status: 'active',
      memberSyncStatus: 'idle',
      lastSyncAt: new Date(),
      lastMemberSyncAt: new Date(),
      lastSyncError: null,
      lastMemberSyncError: null,
      listingCheckpoint: null,
      directoryCheckpoint: null,
      nextMemberSyncAt: null,
    })
    .where(inArray(knowledgeConnector.id, sourceIds))
  await db
    .update(knowledgeConnector)
    .set({ status: 'paused' })
    .where(eq(knowledgeConnector.id, pausedDriveId))
  await db
    .update(knowledgeConnectorMember)
    .set({
      status: 'active',
      lastCompleteListingAt: new Date(),
      memberSyncedThrough: new Date(),
      lastError: null,
      consecutiveFailures: 0,
      listingCheckpoint: null,
    })
    .where(eq(knowledgeConnectorMember.id, memberId))
  await db
    .update(document)
    .set({ processingStatus: 'completed', enabled: true, userExcluded: false })
    .where(eq(document.id, documentId))
})

afterAll(async () => {
  await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
})

async function provider(connectorType: string) {
  return (await readOrganizationSearchOverview.execute({ principal, input })).providers.find(
    (item) => item.connectorType === connectorType
  )
}

describe('organization operational overview with real SQL', () => {
  it('counts configured sources independently of viewer ACLs, and excludes workspace and untouched providers', async () => {
    const result = await readOrganizationSearchOverview.execute({ principal, input })
    expect(result.providers).toEqual(
      expect.arrayContaining([
        {
          connectorType: 'google_drive',
          sourceCount: 2,
          approved: true,
          status: 'active',
          isSyncing: false,
        },
        {
          connectorType: 'gmail',
          sourceCount: 1,
          approved: true,
          status: 'active',
          isSyncing: false,
        },
      ])
    )
    expect(result.providers).toHaveLength(2)
    expect(JSON.stringify(result)).not.toMatch(/private-title|someone-else|fixture connection/i)
    const visible = await listSearchSources.execute({
      principal,
      input: { ...input, connectorType: 'google_drive' },
    })
    expect(visible.sources).toHaveLength(2)
    expect(visible.sources.every((source) => source.viewerDocumentCount === 0)).toBe(true)
  })
  it('keeps explicit approvals and deactivations visible before source creation', async () => {
    await db.insert(organizationSearchIntegration).values([
      { organizationId: ids.organizationId, connectorType: 'github', approved: true },
      { organizationId: ids.organizationId, connectorType: 'confluence', approved: false },
      { organizationId: ids.organizationId, connectorType: 'notion', approved: true },
    ])
    expect(await provider('github')).toMatchObject({
      sourceCount: 0,
      approved: true,
      status: 'waiting_for_connections',
    })
    expect(await provider('confluence')).toMatchObject({
      sourceCount: 0,
      approved: false,
      status: 'paused',
    })
    expect(await provider('notion')).toBeUndefined()
  })
  it('reports waiting accounts despite an empty member run having a completion timestamp', async () => {
    await db
      .update(knowledgeConnectorMember)
      .set({ status: 'disabled' })
      .where(eq(knowledgeConnectorMember.id, memberId))
    await db
      .update(knowledgeConnector)
      .set({ memberSyncStatus: 'pending' })
      .where(eq(knowledgeConnector.id, gmailId))
    expect(await provider('gmail')).toMatchObject({ status: 'waiting_for_connections' })
  })
  it('distinguishes normal member continuation from partial failure without treating idle as success', async () => {
    await db
      .update(knowledgeConnectorMember)
      .set({ listingCheckpoint: { cursor: 'fixture' } })
      .where(eq(knowledgeConnectorMember.id, memberId))
    const logId = generateId()
    await db.insert(knowledgeConnectorMemberSyncLog).values({
      id: logId,
      connectorId: gmailId,
      status: 'partial',
      membersIncomplete: 1,
      completedAt: new Date(),
    })
    expect(await provider('gmail')).toMatchObject({ status: 'indexing' })
    await db
      .update(knowledgeConnectorMemberSyncLog)
      .set({ membersFailed: 1 })
      .where(eq(knowledgeConnectorMemberSyncLog.id, logId))
    expect(await provider('gmail')).toMatchObject({ status: 'needs_attention' })
    await db
      .update(knowledgeConnectorMemberSyncLog)
      .set({ membersFailed: 0 })
      .where(eq(knowledgeConnectorMemberSyncLog.id, logId))
    await db
      .update(knowledgeConnectorMember)
      .set({ listingCheckpoint: null })
      .where(eq(knowledgeConnectorMember.id, memberId))
    expect(await provider('gmail')).toMatchObject({ status: 'needs_attention' })
    await db
      .update(knowledgeConnector)
      .set({ nextMemberSyncAt: new Date() })
      .where(eq(knowledgeConnector.id, gmailId))
    expect(await provider('gmail')).toMatchObject({ status: 'indexing' })
    await db
      .update(knowledgeConnector)
      .set({ nextMemberSyncAt: null })
      .where(eq(knowledgeConnector.id, gmailId))
    await db.insert(knowledgeConnectorMemberSyncLog).values({
      id: generateId(),
      connectorId: gmailId,
      status: 'completed',
      startedAt: new Date(Date.now() + 1000),
      completedAt: new Date(),
    })
    expect(await provider('gmail')).toMatchObject({ status: 'active' })
  })
  it('reports inaccessible processing failures without exposing documents, and ignores excluded failures', async () => {
    await db.update(document).set({ processingStatus: 'failed' }).where(eq(document.id, documentId))
    expect(await provider('google_drive')).toMatchObject({ status: 'needs_attention' })
    await db.update(document).set({ userExcluded: true }).where(eq(document.id, documentId))
    expect(await provider('google_drive')).toMatchObject({ status: 'active' })
    await db
      .update(document)
      .set({ userExcluded: false, processingStatus: 'processing' })
      .where(eq(document.id, documentId))
    expect(await provider('google_drive')).toMatchObject({ status: 'indexing' })
    await db
      .update(knowledgeConnector)
      .set({ lastSyncError: 'previous sync failed' })
      .where(eq(knowledgeConnector.id, driveId))
    expect(await provider('google_drive')).toMatchObject({
      status: 'needs_attention',
      isSyncing: true,
    })
  })
  it('surfaces retained source errors and stale member permissions, while pause and deactivation take precedence', async () => {
    await db
      .update(knowledgeConnector)
      .set({ lastSyncError: 'private-provider-error' })
      .where(eq(knowledgeConnector.id, driveId))
    expect(await provider('google_drive')).toMatchObject({ status: 'needs_attention' })
    await db
      .update(knowledgeConnectorMember)
      .set({
        memberSyncedThrough: new Date(Date.now() - 3 * 86_400_000),
        lastCompleteListingAt: new Date(Date.now() - 3 * 86_400_000),
      })
      .where(eq(knowledgeConnectorMember.id, memberId))
    expect(await provider('gmail')).toMatchObject({ status: 'needs_attention' })
    await db
      .update(knowledgeConnector)
      .set({ status: 'paused' })
      .where(eq(knowledgeConnector.id, driveId))
    expect(await provider('google_drive')).toMatchObject({ status: 'paused' })
    await db
      .insert(organizationSearchIntegration)
      .values({ organizationId: ids.organizationId, connectorType: 'gmail', approved: false })
    expect(await provider('gmail')).toMatchObject({
      approved: false,
      status: 'paused',
      isSyncing: false,
    })
  })
  it('requires a current organization admin even for a workspace administrator', async () => {
    await expect(
      readOrganizationSearchOverview.execute({
        principal: { ...principal, userId: ids.bobId },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      readOrganizationSearchOverview.execute({ principal, input: { organizationId: generateId() } })
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})
