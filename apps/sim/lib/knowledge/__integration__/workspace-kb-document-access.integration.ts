/**
 * Workspace knowledge base search decides readability on the document for every principal. A
 * signed-in reader and an actorless run over the same workspace base get the same rows, and
 * neither consults the ranking projections' mirrored source and ACL, the projector's marks, or
 * the keyword projection — so projection rows that are stale, unfilled, or missing change
 * nothing about what a workspace search returns. A signed-in reader's own grants widen what they
 * read, and a source whose reader must be proven live admits a candidate only once the proof
 * holds, with the readable rows below it filling the page when it does not. A search index named
 * by id while indexed organization search is dormant is searched the same way.
 */
import { createHash } from 'node:crypto'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  document,
  embedding,
  embeddingKeywordSearch,
  embeddingSearch,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/** Pinned to Live Search, so indexed organization search is dormant whatever the run's environment. */
vi.mock('@/lib/core/config/env-flags', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isLiveEnterpriseSearchEnabled: true,
}))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import type {
  GitHubInstallationReadGrant,
  KnowledgeAccessProvider,
  UserAccessScope,
} from '@/lib/knowledge/access/types'
import { type KnowledgeSearchMode, retrieveKnowledgeSearch } from '@/lib/knowledge/search/queries'
import { embeddingVectorValues } from '@/lib/knowledge/vector-columns'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import { usesIndexedRetrieval } from '@/lib/sim-search/indexed/gate'

afterAll(async () => {
  await db.$client.end()
})

describe.each([
  ['a workspace knowledge base', false],
  ['a dormant search index', true],
] as const)('search of %s decides access on the document', (_label, isSearchIndex) => {
  const ids = createKnowledgeAclFixtureIds()
  const baseId = generateId()
  const readable = [generateId(), generateId(), generateId()]
  const personal = generateId()
  const adminConnectorId = generateId()
  const chunkOf = new Map([...readable, personal].map((documentId) => [documentId, generateId()]))
  const vector = [0, 0, 1, ...Array<number>(1533).fill(0)]
  const queryVector = {
    vector: JSON.stringify(vector),
    dimensions: 1536 as const,
    model: 'text-embedding-3-small',
  }
  const reader: Principal = { kind: 'session', userId: ids.bobId, sessionId: 'fixture-session' }
  const actorless: Principal = {
    kind: 'workspace_api_key',
    workspaceId: ids.workspaceId,
    keyId: 'fixture-key',
  }

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
    await db.insert(knowledgeBase).values({
      id: baseId,
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
      name: 'Workspace handbook',
      isSearchIndex,
    })
    await db.insert(knowledgeConnector).values({
      id: adminConnectorId,
      knowledgeBaseId: baseId,
      connectorType: 'google_drive',
      sourceConfig: {},
      accessMode: 'admin',
      status: 'active',
      credentialId: ids.credentialId,
    })
    await db.insert(document).values(
      [...readable, personal].map((id) => ({
        id,
        knowledgeBaseId: baseId,
        filename: `${id}.txt`,
        fileUrl: `https://fixture.invalid/${id}`,
        fileSize: 12,
        mimeType: 'text/plain',
        processingStatus: 'completed' as const,
        /**
         * Uploads carry the workspace token; one source document is shared with a directory group
         * only Alice belongs to, its permissions freshly verified.
         */
        ...(id === personal
          ? {
              connectorId: adminConnectorId,
              acl: ['g:google-drive:fixture-tenant:page'],
              aclVerifiedAt: new Date(),
            }
          : { acl: ['ws'] }),
      }))
    )
    await db.insert(embedding).values(
      [...readable, personal].map((documentId, index) => ({
        id: chunkOf.get(documentId)!,
        documentId,
        knowledgeBaseId: baseId,
        chunkIndex: 0,
        chunkHash: documentId,
        content: `Handbook onboarding chapter ${index}`,
        contentLength: 30,
        tokenCount: 4,
        startOffset: 0,
        endOffset: 30,
        ...embeddingVectorValues(1536, vector),
      }))
    )
    /**
     * The projections behind the removed per-row path, made wrong: every row's mirrored ACL names
     * nobody the reader is, its source is gone, and the keyword projection holds nothing. A search
     * that consulted any of them would drop the readable rows for the signed-in reader.
     */
    await db
      .update(embeddingSearch)
      .set({ acl: ['s:nobody:-:stale'], connectorId: null })
      .where(eq(embeddingSearch.knowledgeBaseId, baseId))
    await db
      .delete(embeddingKeywordSearch)
      .where(eq(embeddingKeywordSearch.knowledgeBaseId, baseId))
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  })

  async function search(principal: Principal, searchMode: KnowledgeSearchMode) {
    const accessProvider = createKnowledgeAccessProvider(principal, {
      workspaceId: ids.workspaceId,
      knowledgeBaseIds: [baseId],
    })
    const result = await retrieveKnowledgeSearch({
      knowledgeBaseIds: [baseId],
      topK: 10,
      access: await accessProvider.get(),
      accessProvider,
      searchMode,
      indexedRetrieval: usesIndexedRetrieval([{ isSearchIndex }]),
      query: 'handbook onboarding',
      queryVector,
    })
    expect(result.retrieval).toEqual({ status: 'complete', timedOutLegs: [] })
    return result.rows.map((row) => row.documentId).sort()
  }

  it.each(['vector', 'hybrid'] as const)(
    'returns a signed-in reader the rows an actorless run gets (%s)',
    async (mode) => {
      const previousDebug = db.$client.options.debug
      const statements: string[] = []
      db.$client.options.debug = (_connection, query) => {
        statements.push(query)
      }
      try {
        const signedIn = await search(reader, mode)
        const workspaceKey = await search(actorless, mode)
        expect(signedIn).toEqual([...readable].sort())
        expect(workspaceKey).toEqual(signedIn)
        /** Nothing read the per-row machinery the search-index path keeps for itself. */
        for (const fragment of [
          'embedding_keyword_search',
          'knowledge_projection_dirty',
          '"embedding_search"."acl"',
          '"embedding_search"."connector_id"',
        ]) {
          expect(statements.filter((statement) => statement.includes(fragment))).toEqual([])
        }
      } finally {
        db.$client.options.debug = previousDebug
      }
    }
  )

  it.each(['vector', 'hybrid'] as const)(
    'returns a signed-in reader the document shared with them alone as well (%s)',
    async (mode) => {
      const owner: Principal = { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-owner' }
      expect(await search(owner, mode)).toEqual([...readable, personal].sort())
    }
  )
})

describe('a workspace source whose reader must be proven live', () => {
  const ids = createKnowledgeAclFixtureIds()
  const baseId = generateId()
  const connectorId = generateId()
  const contentCredentialId = generateId()
  const readerCredentialId = generateId()
  const groupId = generateId()
  const optionId = generateId()
  const repositoryId = '4343'
  const readerSubject = 'reader-gh'
  const readerToken = `s:github-repositories:-:${readerSubject}`
  const gated = generateId()
  const readable = [generateId(), generateId()]
  const vector = [0, 0, 0, 1, ...Array<number>(1532).fill(0)]
  const queryVector = {
    vector: JSON.stringify(vector),
    dimensions: 1536 as const,
    model: 'text-embedding-3-small',
  }
  /** The installation document is the nearest; the readable ones trail it. */
  const vectorOf = (documentId: string, index: number) =>
    documentId === gated ? vector : [0, 0, 0, 1, 0.1 * (index + 1), ...Array<number>(1531).fill(0)]

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids, { connectorType: 'google_drive' })
    const now = new Date()
    await db.insert(knowledgeBase).values({
      id: baseId,
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
      name: 'Workspace repositories',
    })
    await db.insert(credential).values({
      id: contentCredentialId,
      workspaceId: ids.workspaceId,
      type: 'service_account',
      displayName: 'Fixture GitHub installation',
      createdBy: ids.aliceId,
      providerId: GITHUB_INSTALLATION_PROVIDER_ID,
    })
    await db.insert(credentialGroup).values({
      id: groupId,
      workspaceId: ids.workspaceId,
      publicId: generateId(),
      name: 'GitHub readers',
      options: [
        {
          id: optionId,
          provider: 'github-repositories',
          label: 'GitHub fixture',
          authorizationAppId: 'fixture-app',
          requiredScopes: ['repo'],
          scopeVersion: 1,
          required: false,
          status: 'active',
        },
      ],
    } as typeof credentialGroup.$inferInsert)
    const [enrollment] = await db
      .insert(credentialGroupEnrollment)
      .values({
        id: generateId(),
        credentialGroupId: groupId,
        userId: ids.bobId,
        email: `${ids.bobId}@fixture.test`,
        status: 'completed',
        invitationTokenHash: createHash('sha256').update(generateId()).digest('hex'),
        invitationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        invitedAt: now,
      })
      .returning({ id: credentialGroupEnrollment.id })
    await db.insert(credential).values({
      id: readerCredentialId,
      workspaceId: ids.workspaceId,
      type: 'managed_oauth',
      displayName: 'Fixture GitHub reader',
      providerId: 'github-repositories',
      authorizationAppId: 'fixture-app',
      credentialGroupEnrollmentId: enrollment!.id,
      credentialGroupOptionId: optionId,
      managedOauthScopeVersion: 1,
      providerSubjectId: readerSubject,
      providerTenantId: '',
      managedOauthStatus: 'active',
      grantedScopes: ['repo'],
      encryptedOauthTokenSet: 'fixture-not-an-oauth-token',
      grantedAt: now,
      createdBy: ids.bobId,
    })
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId: baseId,
      connectorType: 'github',
      sourceConfig: { githubRepositoryId: repositoryId },
      accessMode: 'members',
      status: 'active',
      credentialId: contentCredentialId,
      credentialGroupId: groupId,
      credentialGroupOptionId: optionId,
    })
    const memberId = generateId()
    await db.insert(knowledgeConnectorMember).values({
      id: memberId,
      workspaceId: ids.workspaceId,
      connectorId,
      credentialId: readerCredentialId,
      subjectToken: readerToken,
      status: 'active',
      memberSyncedThrough: now,
    })
    await db.insert(document).values([
      {
        id: gated,
        connectorId,
        knowledgeBaseId: baseId,
        externalId: 'fixture-readme',
        filename: 'readme.md',
        fileUrl: 'https://fixture.invalid/readme',
        fileSize: 12,
        mimeType: 'text/plain',
        processingStatus: 'completed' as const,
        acl: [readerToken],
      },
      ...readable.map((id) => ({
        id,
        knowledgeBaseId: baseId,
        filename: `${id}.txt`,
        fileUrl: `https://fixture.invalid/${id}`,
        fileSize: 12,
        mimeType: 'text/plain',
        processingStatus: 'completed' as const,
        acl: ['ws'],
      })),
    ])
    await db
      .insert(knowledgeDocumentObservation)
      .values({ documentId: gated, memberId, lastSeenAt: now, runId: generateId() })
    await db.insert(embedding).values(
      [gated, ...readable].map((documentId, index) => ({
        id: generateId(),
        documentId,
        knowledgeBaseId: baseId,
        chunkIndex: 0,
        chunkHash: documentId,
        content: `Repository release notes ${index}`,
        contentLength: 30,
        tokenCount: 4,
        startOffset: 0,
        endOffset: 30,
        ...embeddingVectorValues(1536, vectorOf(documentId, index)),
      }))
    )
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(credentialGroup).where(eq(credentialGroup.id, groupId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  })

  /**
   * A reader whose stored tokens match the installation document's mirrored permissions, and who
   * either proves the installation grant live or does not.
   */
  async function search(proven: boolean, searchMode: KnowledgeSearchMode) {
    const reader: UserAccessScope = {
      kind: 'user',
      userId: ids.bobId,
      tokens: ['pub', readerToken, `u:${ids.bobId}@fixture.test`, 'ws'].sort(),
    }
    const grant: GitHubInstallationReadGrant = {
      connectorId,
      contentCredentialId,
      readerCredentialId,
      readerSubjectToken: readerToken,
      repositoryId,
    }
    const authorized = proven ? { ...reader, githubInstallationGrants: [grant] } : reader
    const accessProvider: KnowledgeAccessProvider = {
      get: async () => reader,
      getForConnectors: async () => authorized,
      getForDocuments: async () => authorized,
      liveSourceConnectorCondition: async () => eq(knowledgeConnector.id, connectorId),
    }
    const result = await retrieveKnowledgeSearch({
      knowledgeBaseIds: [baseId],
      topK: 2,
      access: reader,
      accessProvider,
      searchMode,
      query: 'repository release notes',
      queryVector,
    })
    expect(result.retrieval).toEqual({ status: 'complete', timedOutLegs: [] })
    return result.rows.map((row) => row.documentId)
  }

  it.each(['vector', 'hybrid'] as const)(
    'drops the candidate at hydration without the grant, and fills the page with readable rows (%s)',
    async (mode) => {
      expect((await search(false, mode)).sort()).toEqual([...readable].sort())
    }
  )

  it.each(['vector', 'hybrid'] as const)(
    'returns the candidate to a reader who proves the grant (%s)',
    async (mode) => {
      const rows = await search(true, mode)
      expect(rows).toHaveLength(2)
      expect(rows).toContain(gated)
    }
  )
})
