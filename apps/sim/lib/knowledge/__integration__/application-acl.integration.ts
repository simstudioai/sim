/**
 * Real application/database integration. The model provider returns deterministic
 * vectors and the storage root is temporary; no database, principal, scope,
 * authorization, parser, chunking, ACL persistence, or search code is mocked.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroupEnrollment,
  document,
  embedding,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  knowledgeExternalGroup,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({ storageRoot: '', calls: 0 }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtures.storageRoot
  },
}))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => {
    fixtures.calls += 1
    return {
      embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
      totalTokens: texts.length,
      billableTokens: 0,
      isBYOK: true,
      modelName: 'text-embedding-3-small',
      pricingId: 'text-embedding-3-small',
    }
  },
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { confluencePageAcl } from '@/lib/knowledge/access/confluence-permissions'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { syncExternalDirectoryGroups } from '@/lib/knowledge/connectors/external-group-sync'
import {
  materializeDocumentAcls,
  recordMemberObservations,
  removeMemberObservationsForDocuments,
} from '@/lib/knowledge/connectors/member-observations'
import { createContentSyncLease, createMemberSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument, persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'

describe('indexed source content through real application access', () => {
  const ids = createKnowledgeAclFixtureIds()
  const { aliceId, bobId, workspaceId, knowledgeBaseId, connectorId, lockId, groups, groupIds } =
    ids
  const alice: Principal = { kind: 'session', userId: aliceId, sessionId: 'fixture-alice' }
  const bob: Principal = { kind: 'personal_api_key', userId: bobId, keyId: 'fixture-bob' }
  const workspaceKey: Principal = {
    kind: 'workspace_api_key',
    workspaceId,
    keyId: 'fixture-workspace',
  }
  const content =
    'Orion project: the release readiness checklist is complete. Engineers approved the customer migration plan and documented every operational dependency.'
  let documentId: string
  let fileUrl: string

  const sourceAcl = confluencePageAcl({
    providerId: 'confluence',
    tenantId: 'fixture-tenant',
    spacePrincipals: [{ kind: 'group', id: 'space' }],
    restrictionChain: [[{ kind: 'group', id: 'page' }], [{ kind: 'group', id: 'parent' }]],
  })

  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected outbound request in isolated application integration test')
    })
    fixtures.storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-acl-integration-'))
    await seedKnowledgeAclFixture(ids)
    const doc = await addDocument(
      knowledgeBaseId,
      connectorId,
      'confluence',
      {
        externalId: 'page-1',
        mimeType: 'text/plain',
        title: 'Orion project',
        content,
        contentHash: 'fixture-orion-hash',
        sourceUrl: 'https://fixture.atlassian.net/wiki/pages/1',
      },
      { userId: aliceId, workspaceId },
      undefined,
      'admin',
      createContentSyncLease(connectorId, lockId)
    )
    documentId = doc.documentId
    fileUrl = doc.fileUrl
    await db.update(document).set({ tag1: 'acl-suite' }).where(eq(document.id, documentId))
    await processDocumentAsync(
      knowledgeBaseId,
      documentId,
      doc,
      {},
      await resolveBillingAttribution({ actorUserId: aliceId, workspaceId })
    )
    const [persisted] = await db
      .select({ status: document.processingStatus, error: document.processingError })
      .from(document)
      .where(eq(document.id, documentId))
    expect(persisted).toEqual({ status: 'completed', error: null })
    expect(await search(alice)).toEqual([])
    await persistDocumentAcls(connectorId, new Map([['page-1', sourceAcl]]))
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, aliceId))
    await db.delete(user).where(eq(user.id, bobId))
    await rm(fixtures.storageRoot, { recursive: true, force: true })
    await db.$client.end()
    vi.unstubAllGlobals()
  })

  async function search(principal: Principal, query?: string, fixtureTag = 'acl-suite') {
    const result = await searchKnowledge.execute({
      principal,
      input: {
        workspaceId,
        knowledgeBaseIds: [knowledgeBaseId],
        topK: 10,
        ...(query
          ? { query, searchMode: 'hybrid' as const }
          : { tagFilters: [{ tagName: 'Fixture', operator: 'eq', value: fixtureTag }] }),
      },
    })
    return result.results.map((row) => row.documentId)
  }

  it.each(['workspace', 'admin', 'members'] as const)(
    'allows a remaining workspace ACL only in workspace mode, not during a %s transition',
    async (accessMode) => {
      const [savedConnector] = await db
        .select({
          accessMode: knowledgeConnector.accessMode,
          accessRewritePending: knowledgeConnector.accessRewritePending,
        })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, connectorId))
      const [savedDocument] = await db
        .select({
          acl: document.acl,
          aclRequirements: document.aclRequirements,
          aclVerifiedAt: document.aclVerifiedAt,
        })
        .from(document)
        .where(eq(document.id, documentId))
      try {
        await db
          .update(document)
          .set({ acl: ['ws'], aclRequirements: [], aclVerifiedAt: new Date() })
          .where(eq(document.id, documentId))
        await db
          .update(knowledgeConnector)
          .set({ accessMode, accessRewritePending: true })
          .where(eq(knowledgeConnector.id, connectorId))
        const visible = await db
          .select({ id: document.id })
          .from(document)
          .where(
            and(
              eq(document.id, documentId),
              knowledgeAccessCondition({ kind: 'workspace', tokens: ['pub', 'ws'] })
            )
          )
        expect(visible.map((row) => row.id)).toEqual(accessMode === 'workspace' ? [documentId] : [])
      } finally {
        await db
          .update(knowledgeConnector)
          .set(savedConnector)
          .where(eq(knowledgeConnector.id, connectorId))
        await db.update(document).set(savedDocument).where(eq(document.id, documentId))
      }
    }
  )

  it('indexes once and enforces effective source access for sessions, personal keys, workspace keys and raw files', async () => {
    expect(await search(alice)).toEqual([documentId])
    expect(await search(alice, 'Orion')).toEqual([documentId])
    expect(await search(bob)).toEqual([])
    expect(await search(workspaceKey)).toEqual([])
    expect(
      (
        await readKnowledgeDocument.execute({
          principal: alice,
          input: { knowledgeBaseId, documentId },
        })
      ).document.id
    ).toBe(documentId)
    await expect(
      readKnowledgeDocument.execute({ principal: bob, input: { knowledgeBaseId, documentId } })
    ).rejects.toThrow('Document not found')
    await expect(
      readKnowledgeDocument.execute({
        principal: workspaceKey,
        input: { knowledgeBaseId, documentId },
      })
    ).rejects.toThrow('Document not found')
    const chunks = await listKnowledgeChunks.execute({
      principal: alice,
      input: { knowledgeBaseId, documentId },
    })
    expect(chunks.chunks[0].content).toBe(content)
    expect(
      (await downloadFileFromUrl(fileUrl, { userId: aliceId, knowledgeAccess: 'user' })).toString()
    ).toBe(content)
    await expect(
      downloadFileFromUrl(fileUrl, { userId: bobId, knowledgeAccess: 'user' })
    ).rejects.toThrow('Access denied')
    expect(fixtures.calls).toBeGreaterThan(0)
  })

  async function refreshDirectory(bobCanReadPage: boolean, complete = true) {
    await db
      .update(knowledgeExternalGroup)
      .set({ lastSyncedAt: new Date(Date.now() - 6 * 60 * 1000) })
      .where(eq(knowledgeExternalGroup.workspaceId, workspaceId))
    return syncExternalDirectoryGroups({
      workspaceId,
      force: true,
      directory: {
        providerId: 'confluence',
        tenantId: 'fixture-tenant',
        listGroups: async () => groups.map((id) => ({ id, name: id })),
        listGroupMembers: async (group) => ({
          group,
          complete,
          memberTokens: [
            `u:${aliceId}@fixture.test`,
            ...(group.id !== 'page' || bobCanReadPage ? [`u:${bobId}@fixture.test`] : []),
          ],
        }),
      },
    })
  }

  it('applies authoritative group grants and revocations without changing indexed chunks', async () => {
    const before = await db
      .select({ id: embedding.id })
      .from(embedding)
      .where(eq(embedding.documentId, documentId))
    const modelCalls = fixtures.calls
    expect((await refreshDirectory(true)).refreshed).toBe(3)
    expect(await search(bob)).toEqual([documentId])
    expect(
      (
        await readKnowledgeDocument.execute({
          principal: bob,
          input: { knowledgeBaseId, documentId },
        })
      ).document.id
    ).toBe(documentId)
    expect((await refreshDirectory(false, false)).keptStale).toBe(3)
    expect(await search(bob)).toEqual([documentId])
    expect((await refreshDirectory(false)).refreshed).toBe(3)
    expect(await search(bob)).toEqual([])
    await expect(
      listKnowledgeChunks.execute({ principal: bob, input: { knowledgeBaseId, documentId } })
    ).rejects.toThrow('Document not found')
    await expect(
      downloadFileFromUrl(fileUrl, { userId: bobId, knowledgeAccess: 'user' })
    ).rejects.toThrow('Access denied')
    expect(
      await db
        .select({ id: embedding.id })
        .from(embedding)
        .where(eq(embedding.documentId, documentId))
    ).toEqual(before)
    expect(fixtures.calls).toBe(modelCalls)
  })

  it('expires both permission evidence and directory evidence at read time, with no scheduler or reindex required', async () => {
    await db
      .update(document)
      .set({ aclVerifiedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(document.id, documentId))
    expect(await search(alice)).toEqual([])
    await expect(
      readKnowledgeDocument.execute({ principal: alice, input: { knowledgeBaseId, documentId } })
    ).rejects.toThrow('Document not found')
    await expect(
      downloadFileFromUrl(fileUrl, { userId: aliceId, knowledgeAccess: 'user' })
    ).rejects.toThrow('Access denied')
    await persistDocumentAcls(connectorId, new Map([['page-1', sourceAcl]]))
    expect(await search(alice)).toEqual([documentId])
    await db
      .update(knowledgeExternalGroup)
      .set({ lastSyncedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(knowledgeExternalGroup.workspaceId, workspaceId))
    expect(await search(alice)).toEqual([])
    await refreshDirectory(false)
    expect(await search(alice)).toEqual([documentId])
  })

  it('permits fresh public grants for workspace keys but expires public evidence too', async () => {
    await persistDocumentAcls(connectorId, new Map([['page-1', ['pub']]]))
    expect(await search(workspaceKey)).toEqual([documentId])
    expect(
      (
        await readKnowledgeDocument.execute({
          principal: workspaceKey,
          input: { knowledgeBaseId, documentId },
        })
      ).document.id
    ).toBe(documentId)
    await db.update(document).set({ aclVerifiedAt: null }).where(eq(document.id, documentId))
    expect(await search(workspaceKey)).toEqual([])
    await expect(
      readKnowledgeDocument.execute({
        principal: workspaceKey,
        input: { knowledgeBaseId, documentId },
      })
    ).rejects.toThrow('Document not found')
    await persistDocumentAcls(connectorId, new Map([['page-1', sourceAcl]]))
  })

  it('requires current verified identity and actual workspace membership even when source groups grant access', async () => {
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, aliceId))
    expect(await search(alice)).toEqual([])
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, aliceId))
    expect(await search(alice)).toEqual([documentId])
    await expect(
      searchKnowledge.execute({
        principal: { ...workspaceKey, workspaceId: generateId() },
        input: {
          workspaceId,
          knowledgeBaseIds: [knowledgeBaseId],
          topK: 10,
          tagFilters: [{ tagName: 'Fixture', operator: 'eq', value: 'acl-suite' }],
        },
      })
    ).rejects.toThrow('Workspace API key cannot access this workspace')
    await expect(
      readKnowledgeDocument.execute({
        principal: alice,
        input: { knowledgeBaseId, documentId, assertedWorkspaceId: generateId() },
      })
    ).rejects.toThrow('Knowledge base not found')
    await refreshDirectory(true)
    await db
      .delete(permissions)
      .where(and(eq(permissions.userId, bobId), eq(permissions.entityId, workspaceId)))
    await expect(search(bob)).rejects.toThrow('Insufficient workspace permissions')
    await expect(
      downloadFileFromUrl(fileUrl, { userId: bobId, knowledgeAccess: 'user' })
    ).rejects.toThrow('Access denied')
    await db.insert(permissions).values({
      id: generateId(),
      userId: bobId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'read',
    })
    await refreshDirectory(false)
  })

  it('materializes per-member grants and independently expires or revokes each reader', async () => {
    const members = await seedKnowledgeMemberFixture(ids)
    const [aliceMember, bobMember] = members.members
    const doc = await addDocument(
      knowledgeBaseId,
      members.connectorId,
      'google_drive',
      {
        externalId: 'drive-1',
        mimeType: 'text/plain',
        title: 'Orion member source',
        content,
        contentHash: 'fixture-member-content',
      },
      { userId: aliceId, workspaceId },
      undefined,
      'members',
      createMemberSyncLease(members.connectorId, members.runId)
    )
    await db.update(document).set({ tag1: 'member-suite' }).where(eq(document.id, doc.documentId))
    await processDocumentAsync(
      knowledgeBaseId,
      doc.documentId,
      doc,
      {},
      await resolveBillingAttribution({ actorUserId: aliceId, workspaceId })
    )
    const memberSearch = (principal: Principal) => search(principal, undefined, 'member-suite')
    expect(await memberSearch(alice)).toEqual([])
    await recordMemberObservations(db, aliceMember.id, [doc.documentId], members.runId)
    await materializeDocumentAcls(members.connectorId, [doc.documentId])
    expect(await memberSearch(alice)).toEqual([doc.documentId])
    expect(await memberSearch(bob)).toEqual([])
    expect(await memberSearch(workspaceKey)).toEqual([])
    await recordMemberObservations(db, bobMember.id, [doc.documentId], members.runId)
    await materializeDocumentAcls(members.connectorId, [doc.documentId])
    await db
      .update(knowledgeDocumentObservation)
      .set({ lastSeenAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(knowledgeDocumentObservation.memberId, aliceMember.id))
    expect(await memberSearch(alice)).toEqual([])
    expect(await memberSearch(bob)).toEqual([doc.documentId])
    await db
      .update(knowledgeConnectorMember)
      .set({ memberSyncedThrough: new Date() })
      .where(eq(knowledgeConnectorMember.id, aliceMember.id))
    expect(await memberSearch(alice)).toEqual([doc.documentId])
    await db
      .update(credential)
      .set({ managedOauthStatus: 'needs_reauth' })
      .where(eq(credential.id, aliceMember.credentialId))
    expect(await memberSearch(alice)).toEqual([])
    await db
      .update(credential)
      .set({ managedOauthStatus: 'active' })
      .where(eq(credential.id, aliceMember.credentialId))
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'revoked' })
      .where(eq(credentialGroupEnrollment.id, aliceMember.enrollmentId))
    expect(await memberSearch(alice)).toEqual([])
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'completed' })
      .where(eq(credentialGroupEnrollment.id, aliceMember.enrollmentId))
    expect(await memberSearch(alice)).toEqual([doc.documentId])
    await removeMemberObservationsForDocuments(db, aliceMember.id, [doc.documentId])
    await materializeDocumentAcls(members.connectorId, [doc.documentId])
    expect(await memberSearch(alice)).toEqual([])
    expect(await memberSearch(bob)).toEqual([doc.documentId])
    await expect(
      readKnowledgeDocument.execute({
        principal: alice,
        input: { knowledgeBaseId, documentId: doc.documentId },
      })
    ).rejects.toThrow('Document not found')
    await expect(
      downloadFileFromUrl(doc.fileUrl, { userId: aliceId, knowledgeAccess: 'user' })
    ).rejects.toThrow('Access denied')
    expect(
      (
        await downloadFileFromUrl(doc.fileUrl, { userId: bobId, knowledgeAccess: 'user' })
      ).toString()
    ).toBe(content)
  })
})
