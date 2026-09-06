/**
 * Fixture-backed Jira API responses; real managed credential authorization,
 * member sync, storage, parsing, PostgreSQL observations and authorized reads.
 * Only provider HTTP and embedding generation are substituted. No live Jira
 * account or application database is used.
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
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => ({
    embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
    totalTokens: texts.length,
    billableTokens: 0,
    isBYOK: true,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  }),
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import { encryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { grantKnowledgeConnectorCredentialAccess } from '@/lib/knowledge/connectors/member-access'
import { executeMemberSync } from '@/lib/knowledge/connectors/member-sync-engine'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'

const CLOUD_ID = 'jira-fixture-cloud'
const DOMAIN = 'fixture.atlassian.net'
const UPDATED = '2026-09-01T12:00:00.000+0000'

function issue(id: string, description: string) {
  return {
    id,
    key: `ENG-${id}`,
    fields: {
      summary: `Orion issue ${id}`,
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
      },
      project: { id: '10000', key: 'ENG' },
      updated: UPDATED,
      created: UPDATED,
      labels: ['orion'],
      /** The indexed member projection must ignore comments even if returned. */
      comment: { total: 1, comments: [{ body: 'Never index this restricted comment' }] },
    },
  }
}

describe('Jira member indexing and authorization in PostgreSQL', () => {
  const ids = createKnowledgeAclFixtureIds()
  const groupId = generateId()
  const optionId = generateId()
  const connectorId = generateId()
  const people = [ids.aliceId, ids.bobId].map((userId) => ({
    userId,
    credentialId: generateId(),
    enrollmentId: generateId(),
    accessToken: `fixture-jira-${generateId()}`,
    refreshToken: `fixture-jira-refresh-${generateId()}`,
  }))
  const [alice, bob] = people
  const previousClient = { id: env.JIRA_CLIENT_ID, secret: env.JIRA_CLIENT_SECRET }
  const storageKeys = new Set<string>()
  const listing = new Map<string, ReturnType<typeof issue>[]>()
  const failures = new Map<string, 400 | 401>()
  const requests: { token: string; page: string | null }[] = []
  const refreshAttempts: string[] = []
  let refreshError: 'invalid_grant' | 'unauthorized_client' = 'invalid_grant'
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>
  const actor = (userId: string): Principal => ({
    kind: 'session',
    userId,
    sessionId: 'fixture-jira-member',
  })
  const workspaceKey: Principal = {
    kind: 'workspace_api_key',
    workspaceId: ids.workspaceId,
    keyId: 'fixture-jira-workspace-key',
  }

  beforeAll(async () => {
    Object.assign(env, {
      JIRA_CLIENT_ID: 'isolated-jira-fixture-client',
      JIRA_CLIENT_SECRET: 'isolated-jira-fixture-secret',
    })
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.href === 'https://auth.atlassian.com/oauth/token') {
        expect(init?.method).toBe('POST')
        const body = new URLSearchParams(String(init?.body))
        expect(body.get('grant_type')).toBe('refresh_token')
        const person = people.find((person) => person.refreshToken === body.get('refresh_token'))
        if (!person || failures.get(person.accessToken) !== 401)
          throw new Error('Unexpected Jira fixture token refresh')
        refreshAttempts.push(person.userId)
        return Response.json({ error: refreshError }, { status: 403 })
      }
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}))
      const token = headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
      if (!people.some((person) => person.accessToken === token))
        throw new Error('Unexpected provider token in Jira fixture')
      if (url.origin !== 'https://api.atlassian.com')
        throw new Error('Unexpected outbound origin in Jira fixture')
      if (url.pathname === '/oauth/token/accessible-resources')
        return Response.json([{ id: CLOUD_ID, url: `https://${DOMAIN}` }])
      if (url.pathname !== `/ex/jira/${CLOUD_ID}/rest/api/3/search/jql`)
        throw new Error('Unexpected Jira fixture endpoint')
      expect(init?.method).toBe('GET')
      expect(url.searchParams.get('jql')).toBe('project = "ENG" ORDER BY updated DESC')
      expect(url.searchParams.get('fields')?.split(',')).toContain('description')
      expect(url.searchParams.get('fields')?.split(',')).not.toContain('comment')
      const page = url.searchParams.get('nextPageToken')
      requests.push({ token, page })
      const failure = failures.get(token)
      if (failure)
        return Response.json(
          {
            errorMessages: [
              failure === 400
                ? "The value 'ENG' does not exist for the field 'project'."
                : 'Unauthorized',
            ],
          },
          { status: failure }
        )
      const visible = listing.get(token) ?? []
      const offset = page === null ? 0 : Number(page)
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error('Unexpected Jira fixture continuation')
      const next = offset + 1
      return Response.json({
        issues: visible.slice(offset, next),
        isLast: next >= visible.length,
        ...(next < visible.length ? { nextPageToken: String(next) } : {}),
      })
    })
    await seedKnowledgeAclFixture(ids)
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    const policy = await getCredentialGroupProviderAdapter('jira').getPolicy(undefined, {
      workspaceId: ids.workspaceId,
    })
    await db.insert(credentialGroup).values({
      id: groupId,
      workspaceId: ids.workspaceId,
      publicId: generateId(),
      name: 'Jira fixture accounts',
      createdBy: ids.aliceId,
      options: [{ ...policy, id: optionId, label: 'Jira', required: false, status: 'active' }],
    })
    await db
      .insert(resourcePolicy)
      .values({
        id: generateId(),
        workspaceId: ids.workspaceId,
        resourceType: 'credential_group',
        resourceId: groupId,
        document: compileCredentialGroupWorkflowAccessPolicy({
          credentialGroupId: groupId,
          allowedWorkflowIds: [],
        }),
        createdBy: ids.aliceId,
        updatedBy: ids.aliceId,
      })
      .onConflictDoNothing()
    for (const person of people) {
      await db.insert(credentialGroupEnrollment).values({
        id: person.enrollmentId,
        credentialGroupId: groupId,
        email: `${person.userId}@fixture.test`,
        status: 'completed',
        invitationTokenHash: createHash('sha256').update(generateId()).digest('hex'),
        invitationExpiresAt: new Date(Date.now() + 3_600_000),
        invitedAt: new Date(),
      })
      await db.insert(credential).values({
        id: person.credentialId,
        workspaceId: ids.workspaceId,
        type: 'managed_oauth',
        displayName: 'Jira fixture',
        providerId: 'jira',
        authorizationAppId: policy.authorizationAppId,
        credentialGroupEnrollmentId: person.enrollmentId,
        credentialGroupOptionId: optionId,
        managedOauthScopeVersion: policy.scopeVersion,
        providerSubjectId: person.userId,
        providerTenantId: null,
        managedOauthStatus: 'active',
        grantedScopes: policy.requiredScopes,
        encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
          accessToken: person.accessToken,
          refreshToken: person.refreshToken,
        }),
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        grantedAt: new Date(),
        createdBy: person.userId,
      })
    }
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'jira',
      sourceConfig: { domain: DOMAIN, projectKey: 'ENG' },
      accessMode: 'members',
      credentialGroupId: groupId,
      credentialGroupOptionId: optionId,
      status: 'active',
      memberSyncStatus: 'idle',
      syncIntervalMinutes: 60,
    })
    await grantKnowledgeConnectorCredentialAccess(
      {
        workspaceId: ids.workspaceId,
        credentialGroupId: groupId,
        credentialGroupOptionId: optionId,
        connectorId,
      },
      ids.aliceId
    )
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
  })

  beforeEach(async () => {
    refreshError = 'invalid_grant'
    failures.clear()
    requests.length = 0
    refreshAttempts.length = 0
    listing.set(alice.accessToken, [
      issue('1', 'Orion restricted Alice projection'),
      issue('2', 'Orion private Alice issue'),
    ])
    listing.set(bob.accessToken, [
      issue('1', 'Orion limited Bob projection'),
      issue('3', 'Orion private Bob issue'),
    ])
    await db
      .update(credential)
      .set({ managedOauthStatus: 'active', accessTokenExpiresAt: new Date(Date.now() + 3_600_000) })
      .where(
        inArray(
          credential.id,
          people.map((person) => person.credentialId)
        )
      )
    const result = await sync()
    expect(result.membersCompleted).toBe(2)
    expect(result.membersFailed).toBe(0)
  })

  afterAll(async () => {
    try {
      await stored()
      for (const key of storageKeys)
        await deleteFile({ key, context: 'knowledge-base' }).catch((error: unknown) => {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        })
    } finally {
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(user).where(
        inArray(
          user.id,
          people.map((person) => person.userId)
        )
      )
      Object.assign(env, {
        JIRA_CLIENT_ID: previousClient.id,
        JIRA_CLIENT_SECRET: previousClient.secret,
      })
      vi.unstubAllGlobals()
      await db.$client.end()
    }
  })

  async function stored() {
    const rows = await db.select().from(document).where(eq(document.connectorId, connectorId))
    for (const row of rows) if (row.storageKey) storageKeys.add(row.storageKey)
    return rows
  }

  async function sync() {
    await db
      .update(knowledgeConnectorMember)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(knowledgeConnectorMember.connectorId, connectorId))
    const result = await executeMemberSync(connectorId, {
      forceContentRefresh: true,
      billingAttribution: billing,
    })
    expect(result.error).toBeUndefined()
    expect(result.skipReason).toBeUndefined()
    expect(result.docsFailed).toBe(0)
    expect(result.membersRemaining).toBe(false)
    await stored()
    return result
  }

  async function member(person: (typeof people)[number]) {
    const [row] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(
        and(
          eq(knowledgeConnectorMember.connectorId, connectorId),
          eq(knowledgeConnectorMember.credentialId, person.credentialId)
        )
      )
    expect(row).toBeDefined()
    return row
  }

  async function assertAccess(person: (typeof people)[number], issueIds: string[]) {
    const identity = await member(person)
    const rows = await stored()
    const expected = rows.filter((row) =>
      issueIds.some((id) => row.externalId === `member:${identity.id}:jira:${CLOUD_ID}:${id}`)
    )
    expect(expected).toHaveLength(issueIds.length)
    const expectedIds = new Set(expected.map((row) => row.id))
    const search = await searchKnowledge.execute({
      principal: actor(person.userId),
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Orion',
        searchMode: 'hybrid',
        topK: 100,
      },
    })
    expect(new Set(search.results.map((row) => row.documentId))).toEqual(expectedIds)
    for (const row of rows) {
      const input = { knowledgeBaseId: ids.knowledgeBaseId, documentId: row.id }
      if (expectedIds.has(row.id)) {
        expect(
          (await readKnowledgeDocument.execute({ principal: actor(person.userId), input })).document
            .id
        ).toBe(row.id)
        expect(
          (await listKnowledgeChunks.execute({ principal: actor(person.userId), input })).chunks
            .length
        ).toBeGreaterThan(0)
        expect(
          (
            await downloadFileFromUrl(row.fileUrl, {
              userId: person.userId,
              knowledgeAccess: 'user',
            })
          ).length
        ).toBeGreaterThan(0)
      } else {
        await expect(
          readKnowledgeDocument.execute({ principal: actor(person.userId), input })
        ).rejects.toThrow('Document not found')
        await expect(
          listKnowledgeChunks.execute({ principal: actor(person.userId), input })
        ).rejects.toThrow('Document not found')
        await expect(
          downloadFileFromUrl(row.fileUrl, { userId: person.userId, knowledgeAccess: 'user' })
        ).rejects.toThrow('Access denied')
      }
    }
  }

  it('persists both pages and isolates different projections of one Jira issue across all reads', async () => {
    expect(await stored()).toHaveLength(4)
    for (const person of people)
      expect(
        requests
          .filter((request) => request.token === person.accessToken)
          .map((request) => request.page)
      ).toEqual([null, '1'])
    await assertAccess(alice, ['1', '2'])
    await assertAccess(bob, ['1', '3'])
    const rows = await stored()
    const observations = await db
      .select()
      .from(knowledgeDocumentObservation)
      .where(
        inArray(
          knowledgeDocumentObservation.documentId,
          rows.map((row) => row.id)
        )
      )
    expect(observations).toHaveLength(4)
    for (const row of rows) {
      const evidence = observations.filter((observation) => observation.documentId === row.id)
      expect(evidence).toHaveLength(1)
      expect(row.externalId).toContain(`member:${evidence[0].memberId}:`)
      expect(row.processingStatus).toBe('completed')
    }
    const chunks = await db
      .select()
      .from(embedding)
      .where(
        inArray(
          embedding.documentId,
          rows.map((row) => row.id)
        )
      )
    expect(chunks.map((chunk) => chunk.content).join('\n')).not.toContain('restricted comment')
    for (const [person, visibleText, hiddenText] of [
      [alice, 'restricted Alice projection', 'limited Bob projection'],
      [bob, 'limited Bob projection', 'restricted Alice projection'],
    ] as const) {
      const identity = await member(person)
      const projection = rows.find(
        (row) => row.externalId === `member:${identity.id}:jira:${CLOUD_ID}:1`
      )!
      const content = chunks
        .filter((chunk) => chunk.documentId === projection.id)
        .map((chunk) => chunk.content)
        .join('\n')
      expect(content).toContain(visibleText)
      expect(content).not.toContain(hiddenText)
    }
    const search = await searchKnowledge.execute({
      principal: workspaceKey,
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Orion',
        searchMode: 'hybrid',
        topK: 100,
      },
    })
    expect(search.results).toEqual([])
    for (const row of rows) {
      const input = { knowledgeBaseId: ids.knowledgeBaseId, documentId: row.id }
      await expect(
        readKnowledgeDocument.execute({ principal: workspaceKey, input })
      ).rejects.toThrow('Document not found')
      await expect(listKnowledgeChunks.execute({ principal: workspaceKey, input })).rejects.toThrow(
        'Document not found'
      )
    }
  })

  it('replaces previously visible fields without a Jira updated timestamp change', async () => {
    const identity = await member(alice)
    const previous = (await stored()).find(
      (row) => row.externalId === `member:${identity.id}:jira:${CLOUD_ID}:1`
    )!
    listing.set(alice.accessToken, [
      issue('1', 'Orion reduced projection'),
      issue('2', 'Orion private Alice issue'),
    ])
    await sync()
    const current = (await stored()).find((row) => row.id === previous.id)!
    expect(current.contentHash).not.toBe(previous.contentHash)
    const chunks = await db.select().from(embedding).where(eq(embedding.documentId, current.id))
    const content = chunks.map((chunk) => chunk.content).join('\n')
    expect(content).toContain('reduced projection')
    expect(content).not.toContain('restricted Alice projection')
    await assertAccess(alice, ['1', '2'])
    await assertAccess(bob, ['1', '3'])
  })

  it('withdraws an issue absent from a complete listing without affecting the other member', async () => {
    const identity = await member(alice)
    const removed = (await stored()).find(
      (row) => row.externalId === `member:${identity.id}:jira:${CLOUD_ID}:2`
    )!
    listing.set(alice.accessToken, [issue('1', 'Orion restricted Alice projection')])
    await sync()
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.documentId, removed.id))
    ).toEqual([])
    await assertAccess(alice, ['1'])
    await assertAccess(bob, ['1', '3'])
  })

  it('withdraws project access on Jira project-not-accessible responses', async () => {
    failures.set(bob.accessToken, 400)
    const result = await sync()
    expect(result.membersFailed).toBe(0)
    const identity = await member(bob)
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.memberId, identity.id))
    ).toEqual([])
    await assertAccess(bob, [])
    await assertAccess(alice, ['1', '2'])
  })

  it.each(['invalid_grant', 'unauthorized_client'] as const)(
    'marks a %s refresh rejection for reconnect and immediately hides that member corpus',
    async (errorCode) => {
      refreshError = errorCode
      failures.set(alice.accessToken, 401)
      const result = await sync()
      expect(result.membersFailed).toBe(1)
      expect(refreshAttempts).toEqual([alice.userId])
      const [saved] = await db
        .select()
        .from(credential)
        .where(eq(credential.id, alice.credentialId))
      expect(saved.managedOauthStatus).toBe('needs_reauth')
      await assertAccess(alice, [])
      await assertAccess(bob, ['1', '3'])
      expect(
        await db
          .select()
          .from(document)
          .where(and(eq(document.connectorId, connectorId), isNull(document.deletedAt)))
      ).toHaveLength(4)
    }
  )
})
