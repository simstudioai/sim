/**
 * Real PostgreSQL, member sync engine, document storage, indexing, ACL observations and search
 * authorization; only the provider's listing responses are fixtures. A lost scope is the error the
 * connectors raise through `listingRequestError` (Calendar on 404, Jira when no configured
 * project is reachable), classified by the shared `isListingScopeUnavailableError`.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  organization,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  storageRoot: '',
  list: vi.fn(),
  /** Document ids each source scope lists to a member who can reach it. */
  scopes: new Map<string, string[]>(),
  /** How the provider answers one member token on one scope instead of listing it. */
  failures: new Map<string, 'scope_lost' | 'unavailable' | 'timeout'>(),
  /**
   * A unique one-hot dimension (below 512, where candidate ranking truncates) per document, so a
   * query with a document's own vector finds exactly that document: orthogonal vectors sit at
   * cosine distance 1, outside the vector leg's threshold, and no ties reach the HNSW walk.
   */
  slots: new Map<string, number>(),
}))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixture.storageRoot
  },
}))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => ({
    embeddings: texts.map((text) => {
      const slot = Number(/vector-slot-(\d+)/.exec(text)?.[1] ?? 511)
      return Array.from({ length: 1536 }, (_, index) => (index === slot ? 1 : 0))
    }),
    totalTokens: texts.length,
    billableTokens: 0,
    isBYOK: true,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  }),
}))
vi.mock('@/connectors/registry.server', async () => {
  const { isListingScopeUnavailableError } = await import('@/connectors/utils')
  return {
    CONNECTOR_REGISTRY: {
      google_drive: {
        id: 'google_drive',
        name: 'Fixture Drive',
        auth: { mode: 'oauth', provider: 'google-drive' },
        permissionScopedListing: { capFieldIds: [] },
        listDocuments: fixture.list,
        getDocument: async () => {
          throw new Error('Unexpected document hydration')
        },
        isListingScopeUnavailableError,
      },
    },
  }
})

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import * as memberAccess from '@/lib/knowledge/connectors/member-access'
import { executeMemberSync } from '@/lib/knowledge/connectors/member-sync-engine'
import type { ExternalDocument } from '@/connectors/types'
import { listingRequestError } from '@/connectors/utils'

function sourceDoc(externalId: string): ExternalDocument {
  return {
    externalId,
    title: externalId,
    content: `${vectorQuery(externalId)}: the member listing decides who may read ${externalId}.`,
    mimeType: 'text/plain',
    contentHash: `hash-${externalId}`,
  }
}

function vectorQuery(externalId: string) {
  let slot = fixture.slots.get(externalId)
  if (slot === undefined) {
    slot = fixture.slots.size + 1
    if (slot >= 511) throw new Error('Fixture ran out of unique embedding dimensions')
    fixture.slots.set(externalId, slot)
  }
  return `vector-slot-${slot}`
}

const memberToken = (credentialId: string) => `member-${credentialId}`
const answerKey = (scope: string, accessToken: string) => `${scope} ${accessToken}`

describe('member sync withdraws access when the provider reports a lost scope', () => {
  const ids = createKnowledgeAclFixtureIds()
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>

  beforeAll(async () => {
    fixture.storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-member-scope-withdrawal-'))
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected outbound provider request')
    })
    fixture.list.mockImplementation(
      async (accessToken: string, sourceConfig: Record<string, unknown>) => {
        const scope = String(sourceConfig.scope)
        const failure = fixture.failures.get(answerKey(scope, accessToken))
        if (failure === 'scope_lost') throw listingRequestError('Failed to list source', 404)
        if (failure === 'unavailable') throw listingRequestError('Failed to list source', 503)
        if (failure === 'timeout')
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
        return { documents: (fixture.scopes.get(scope) ?? []).map(sourceDoc), hasMore: false }
      }
    )
    await seedKnowledgeAclFixture(ids)
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    vi.spyOn(memberAccess, 'mintKnowledgeConnectorMemberToken').mockImplementation(
      async ({ credentialId }) => ({ accessToken: memberToken(credentialId), refreshed: false })
    )
  })
  afterAll(async () => {
    await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(fixture.storageRoot, { recursive: true, force: true })
    await db.$client.end()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /** A members-mode connector over its own source scope, with Alice and Bob enrolled. */
  async function memberSource(scope: string, documentCount: number) {
    const seeded = await seedKnowledgeMemberFixture(ids)
    await db
      .insert(resourcePolicy)
      .values({
        id: generateId(),
        workspaceId: ids.workspaceId,
        resourceType: 'credential_group',
        resourceId: seeded.groupId,
        document: compileCredentialGroupWorkflowAccessPolicy({
          credentialGroupId: seeded.groupId,
          allowedWorkflowIds: [],
        }),
        createdBy: ids.aliceId,
        updatedBy: ids.aliceId,
      })
      .onConflictDoNothing()
    await memberAccess.grantKnowledgeConnectorCredentialAccess(
      {
        workspaceId: ids.workspaceId,
        credentialGroupId: seeded.groupId,
        credentialGroupOptionId: seeded.optionId,
        connectorId: seeded.connectorId,
      },
      ids.aliceId
    )
    await db
      .update(knowledgeConnector)
      .set({ memberSyncStatus: 'idle', memberSyncLockToken: null, sourceConfig: { scope } })
      .where(eq(knowledgeConnector.id, seeded.connectorId))
    fixture.scopes.set(
      scope,
      Array.from({ length: documentCount }, (_, index) => `${scope}-${index}`)
    )
    const [alice, bob] = seeded.members
    return { scope, connectorId: seeded.connectorId, alice, bob }
  }

  /** Runs one member sync in which only `due` members are listed; the rest keep their schedule. */
  async function syncMembers(connectorId: string, due?: string[]) {
    if (due)
      await db
        .update(knowledgeConnectorMember)
        .set({ nextAttemptAt: new Date(0) })
        .where(inArray(knowledgeConnectorMember.id, due))
    const result = await executeMemberSync(connectorId, { billingAttribution: billing })
    expect(result.error).toBeUndefined()
    return result
  }

  async function connectorDocuments(connectorId: string) {
    const rows = await db
      .select({
        id: document.id,
        externalId: document.externalId,
        acl: document.acl,
        processingStatus: document.processingStatus,
      })
      .from(document)
      .where(eq(document.connectorId, connectorId))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.processingStatus === 'completed')).toBe(true)
    return rows
  }

  /**
   * The ids of `docs` the user's search returns through the real access predicate, each searched
   * with its own vector so the answer never depends on ranking among other documents.
   */
  async function searchableBy(userId: string, docs: { id: string; externalId: string | null }[]) {
    const found: string[] = []
    for (const doc of docs) {
      const { results } = await searchKnowledge.execute({
        principal: { kind: 'session', userId, sessionId: 'member-scope-withdrawal' },
        input: {
          workspaceId: ids.workspaceId,
          knowledgeBaseIds: [ids.knowledgeBaseId],
          query: vectorQuery(String(doc.externalId)),
          searchMode: 'vector',
          topK: 10,
        },
      })
      if (results.some((row) => row.documentId === doc.id)) found.push(doc.id)
    }
    return found.sort()
  }

  async function memberRow(memberId: string) {
    const [row] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, memberId))
    return row
  }

  async function observationCount(memberId: string) {
    const rows = await db
      .select({ documentId: knowledgeDocumentObservation.documentId })
      .from(knowledgeDocumentObservation)
      .where(eq(knowledgeDocumentObservation.memberId, memberId))
    return rows.length
  }

  it('withdraws the member whose provider reports the scope lost and leaves other members readable', async () => {
    const source = await memberSource('scope-lost', 3)
    await syncMembers(source.connectorId)
    const docs = await connectorDocuments(source.connectorId)
    const docIds = docs.map((row) => row.id).sort()
    expect(docIds).toHaveLength(3)
    for (const row of docs)
      expect(new Set(row.acl)).toEqual(
        new Set([source.alice.subjectToken, source.bob.subjectToken])
      )
    expect(await searchableBy(ids.aliceId, docs)).toEqual(docIds)
    expect(await searchableBy(ids.bobId, docs)).toEqual(docIds)
    expect((await memberRow(source.alice.id)).lastListedCount).toBe(3)

    fixture.failures.set(
      answerKey(source.scope, memberToken(source.alice.credentialId)),
      'scope_lost'
    )
    const lost = await syncMembers(source.connectorId, [source.alice.id])
    expect(lost).toMatchObject({
      membersClaimed: 1,
      membersCompleted: 1,
      membersFailed: 0,
      observationsRemoved: 3,
    })

    for (const row of await connectorDocuments(source.connectorId))
      expect(row.acl).toEqual([source.bob.subjectToken])
    expect(await observationCount(source.alice.id)).toBe(0)
    expect(await observationCount(source.bob.id)).toBe(3)
    expect(await searchableBy(ids.aliceId, docs)).toEqual([])
    expect(await searchableBy(ids.bobId, docs)).toEqual(docIds)
    expect(await memberRow(source.alice.id)).toMatchObject({
      status: 'active',
      lastError: null,
      lastListedCount: 0,
    })
  }, 60_000)

  it.each([
    ['a provider 503', 'unavailable', '503'],
    ['a request timeout', 'timeout', 'timeout'],
  ] as const)(
    'keeps the member readable when the listing fails with %s',
    async (_label, failure, errorText) => {
      const source = await memberSource(`transient-${failure}`, 3)
      await syncMembers(source.connectorId)
      const docs = await connectorDocuments(source.connectorId)
      const docIds = docs.map((row) => row.id).sort()
      expect(await searchableBy(ids.aliceId, docs)).toEqual(docIds)

      fixture.failures.set(answerKey(source.scope, memberToken(source.alice.credentialId)), failure)
      const failed = await syncMembers(source.connectorId, [source.alice.id])
      expect(failed).toMatchObject({ membersClaimed: 1, membersFailed: 1, observationsRemoved: 0 })

      const alice = await memberRow(source.alice.id)
      expect(alice.status).toBe('active')
      expect(alice.lastError).toContain(errorText)
      expect(await observationCount(source.alice.id)).toBe(3)
      for (const row of await connectorDocuments(source.connectorId))
        expect(row.acl).toContain(source.alice.subjectToken)
      expect(await searchableBy(ids.aliceId, docs)).toEqual(docIds)
    },
    60_000
  )

  it("withdraws only the lost source's documents, not the member's access through another connector", async () => {
    const lostSource = await memberSource('withdrawn-source', 3)
    const keptSource = await memberSource('kept-source', 2)
    await syncMembers(lostSource.connectorId)
    await syncMembers(keptSource.connectorId)
    const lostDocs = await connectorDocuments(lostSource.connectorId)
    const keptDocs = await connectorDocuments(keptSource.connectorId)
    const lostIds = lostDocs.map((row) => row.id).sort()
    const keptIds = keptDocs.map((row) => row.id).sort()
    expect(await searchableBy(ids.aliceId, lostDocs)).toEqual(lostIds)
    expect(await searchableBy(ids.aliceId, keptDocs)).toEqual(keptIds)

    fixture.failures.set(
      answerKey(lostSource.scope, memberToken(lostSource.alice.credentialId)),
      'scope_lost'
    )
    const lost = await syncMembers(lostSource.connectorId, [lostSource.alice.id])
    expect(lost).toMatchObject({ membersFailed: 0, observationsRemoved: 3 })

    expect(await searchableBy(ids.aliceId, lostDocs)).toEqual([])
    expect(await searchableBy(ids.aliceId, keptDocs)).toEqual(keptIds)
    expect(await observationCount(keptSource.alice.id)).toBe(2)
    for (const row of await connectorDocuments(keptSource.connectorId))
      expect(row.acl).toContain(keptSource.alice.subjectToken)
  }, 60_000)
})
