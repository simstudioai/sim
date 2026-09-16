/** Real PostgreSQL, member observations, authorization, and restoration; provider calls are fixtures. */
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  organization,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const provider = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), changes: vi.fn() }))
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    google_drive: {
      id: 'google_drive',
      name: 'Fixture Drive',
      auth: { mode: 'oauth', provider: 'google-drive' },
      permissionScopedListing: { capFieldIds: [] },
      listDocuments: provider.list,
      getDocument: provider.get,
      getChangeCursor: async () => 'fixture-start',
      listChanges: provider.changes,
    },
  },
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  listKnowledgeConnectorDocuments,
  updateKnowledgeConnectorDocuments,
} from '@/lib/knowledge/application/connectors'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import * as memberAccess from '@/lib/knowledge/connectors/member-access'
import { recordMemberObservations } from '@/lib/knowledge/connectors/member-observations'
import { executeMemberSync } from '@/lib/knowledge/connectors/member-sync-engine'

describe('excluded member documents retain current source authorization', () => {
  let ids: ReturnType<typeof createKnowledgeAclFixtureIds>
  let members: Awaited<ReturnType<typeof seedKnowledgeMemberFixture>>
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>
  let documentId: string
  const principal = () => ({
    kind: 'session' as const,
    userId: ids.aliceId,
    sessionId: 'excluded-member-fixture',
  })
  const target = () => ({ knowledgeBaseId: ids.knowledgeBaseId, connectorId: members.connectorId })
  const mutate = (operation: 'exclude' | 'restore') =>
    updateKnowledgeConnectorDocuments.execute({
      principal: principal(),
      input: { ...target(), operation, documentIds: [documentId] },
    })
  const excluded = () =>
    listKnowledgeConnectorDocuments.execute({
      principal: principal(),
      input: { ...target(), filter: 'excluded' },
    })
  const search = async () => {
    const result = await searchKnowledge.execute({
      principal: principal(),
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        topK: 10,
        tagFilters: [{ tagName: 'Fixture', operator: 'eq', value: 'excluded-member' }],
      },
    })
    return result.results.map((row) => row.documentId)
  }
  const observations = () =>
    db
      .select()
      .from(knowledgeDocumentObservation)
      .where(eq(knowledgeDocumentObservation.documentId, documentId))

  beforeAll(() => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected provider request in excluded member fixture')
    })
    vi.spyOn(memberAccess, 'mintKnowledgeConnectorMemberToken').mockResolvedValue({
      accessToken: 'fixture-token',
      refreshed: false,
    })
  })

  beforeEach(async () => {
    provider.list.mockReset()
    provider.get.mockReset()
    provider.changes.mockReset()
    ids = createKnowledgeAclFixtureIds()
    documentId = generateId()
    await seedKnowledgeAclFixture(ids)
    members = await seedKnowledgeMemberFixture(ids)
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    await db
      .insert(resourcePolicy)
      .values({
        id: generateId(),
        workspaceId: ids.workspaceId,
        resourceType: 'credential_group',
        resourceId: members.groupId,
        document: compileCredentialGroupWorkflowAccessPolicy({
          credentialGroupId: members.groupId,
          allowedWorkflowIds: [],
        }),
        createdBy: ids.aliceId,
        updatedBy: ids.aliceId,
      })
      .onConflictDoNothing()
    await memberAccess.grantKnowledgeConnectorCredentialAccess(
      {
        workspaceId: ids.workspaceId,
        credentialGroupId: members.groupId,
        credentialGroupOptionId: members.optionId,
        connectorId: members.connectorId,
      },
      ids.aliceId
    )
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db
      .update(knowledgeConnector)
      .set({ status: 'active', memberSyncStatus: 'idle', memberSyncLockToken: null })
      .where(eq(knowledgeConnector.id, members.connectorId))
    await db.insert(document).values({
      id: documentId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorId: members.connectorId,
      externalId: 'excluded-file',
      filename: 'Excluded fixture',
      fileUrl: '',
      fileSize: 0,
      mimeType: 'text/plain',
      processingStatus: 'completed',
      contentHash: 'original-content',
      acl: members.members.map((member) => member.subjectToken).sort(),
      tag1: 'excluded-member',
    })
    const content = 'Previously indexed source content remains excluded until explicitly restored.'
    await db.insert(embedding).values({
      id: generateId(),
      knowledgeBaseId: ids.knowledgeBaseId,
      documentId,
      chunkIndex: 0,
      chunkHash: 'original-chunk',
      content,
      contentLength: content.length,
      tokenCount: 12,
      embedding: [1, ...Array<number>(1535).fill(0)],
      startOffset: 0,
      endOffset: content.length,
      tag1: 'excluded-member',
    })
    for (const member of members.members)
      await recordMemberObservations(db, member.id, [documentId], members.runId)
    provider.list.mockResolvedValue({
      documents: [
        {
          externalId: 'excluded-file',
          title: 'Changed while excluded',
          content: '',
          contentDeferred: true,
          contentHash: 'changed-content',
          mimeType: 'text/plain',
        },
      ],
      hasMore: false,
    })
  })

  afterEach(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await db.$client.end()
  })

  it('keeps an excluded document restorable after a full sync without fetching or indexing its content', async () => {
    expect(await search()).toEqual([documentId])
    expect((await mutate('exclude')).count).toBe(1)
    const result = await executeMemberSync(members.connectorId, { billingAttribution: billing })
    expect(result.error).toBeUndefined()
    expect(result.membersCompleted).toBe(2)
    expect(result.docsAdded).toBe(0)
    expect(result.docsUpdated).toBe(0)
    expect(provider.get).not.toHaveBeenCalled()
    const retained = await observations()
    expect(retained).toHaveLength(2)
    expect(retained.every((observation) => observation.runId !== members.runId)).toBe(true)
    expect((await excluded()).documents.map((row) => row.id)).toEqual([documentId])
    expect(await search()).toEqual([])
    const [stored] = await db.select().from(document).where(eq(document.id, documentId))
    expect(stored).toMatchObject({
      userExcluded: true,
      enabled: false,
      contentHash: 'original-content',
    })
    expect((await mutate('restore')).count).toBe(1)
    expect(await search()).toEqual([documentId])
  })

  it('withdraws excluded document access when a complete change feed revokes it', async () => {
    expect((await mutate('exclude')).count).toBe(1)
    await db
      .update(knowledgeConnectorMember)
      .set({
        changeCursor: 'fixture-start',
        lastCompleteListingAt: new Date(),
        memberSyncedThrough: new Date(),
      })
      .where(eq(knowledgeConnectorMember.connectorId, members.connectorId))
    provider.changes.mockResolvedValue({
      changes: [{ kind: 'removed', externalId: 'excluded-file' }],
      hasMore: false,
      nextCursor: 'fixture-drained',
    })
    const result = await executeMemberSync(members.connectorId, { billingAttribution: billing })
    expect(result.error).toBeUndefined()
    expect(result.membersCompleted).toBe(2)
    expect(provider.changes).toHaveBeenCalledTimes(2)
    expect(provider.list).not.toHaveBeenCalled()
    expect(provider.get).not.toHaveBeenCalled()
    expect(await observations()).toEqual([])
    expect((await excluded()).documents).toEqual([])
    expect((await mutate('restore')).count).toBe(0)
    expect(await search()).toEqual([])
    const [stored] = await db.select().from(document).where(eq(document.id, documentId))
    expect(stored).toMatchObject({ userExcluded: true, enabled: false, acl: [] })
  })
})
