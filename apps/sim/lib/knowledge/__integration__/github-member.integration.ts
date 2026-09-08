/**
 * Fixture-backed GitHub API with real PostgreSQL, credential policy/token resolution,
 * connector registry, member sync, storage, chunking, and application authorization.
 * Provider replies and embeddings are deterministic; no live GitHub account is used.
 */
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
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
  rateLimitBucket,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { resetStorageMethod } from '@/lib/core/storage'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import {
  completeCredentialGroupEnrollment,
  getCredentialGroupOAuthContext,
  getCredentialGroupOAuthContextForEnrollment,
} from '@/lib/credential-groups/enrollments'
import {
  completeCredentialGroupOAuth,
  startCredentialGroupOAuth,
} from '@/lib/credential-groups/oauth'
import { consumeCredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import {
  decryptManagedOAuthTokenSet,
  encryptManagedOAuthTokenSet,
} from '@/lib/credentials/managed-oauth'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { subjectToken } from '@/lib/knowledge/access/tokens'
import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'
import { grantKnowledgeConnectorCredentialAccess } from '@/lib/knowledge/connectors/member-access'
import { executeMemberSync } from '@/lib/knowledge/connectors/member-sync-engine'
import {
  MEMBER_SUSPENDED_PURGE_DAYS,
  MEMBER_TOMBSTONE_PURGE_DAYS,
} from '@/lib/knowledge/connectors/sync-limits'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'

const redisUrl = process.env.KNOWLEDGE_ACL_TEST_REDIS_URL
if (redisUrl) {
  const target = new URL(redisUrl)
  if (
    target.protocol !== 'redis:' ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    target.username ||
    target.password
  ) {
    throw new Error('GitHub OAuth integration tests require an explicitly configured local Redis')
  }
}

/** Private repositories require the intersection of installation access and member access. */
interface RepositoryFixture {
  installed: boolean
  readers: Set<string>
  defaultBranch: string
  files: Map<string, string>
  symlinks: Map<string, string>
  deniedStatus: 403 | 404
  throttledReaders: Set<string>
  truncated: boolean
}

describe('fixture-backed GitHub member search in PostgreSQL', () => {
  let ids: ReturnType<typeof createKnowledgeAclFixtureIds>
  let enrolled: Awaited<ReturnType<typeof seedKnowledgeMemberFixture>>
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>
  const repositories = new Map<string, RepositoryFixture>()
  const requests: { userId: string; path: string }[] = []
  const refreshedUsers = new Set<string>()
  const previousClient = {
    id: env.GITHUB_APP_CLIENT_ID,
    secret: env.GITHUB_APP_CLIENT_SECRET,
    redis: env.REDIS_URL,
  }
  let oauthStateKey: string | undefined
  let oauthVerification: { codeVerifier: string; redirectUri: string } | undefined
  const tokenFor = (userId: string) => `ghu_fixture_${userId}`
  const capacityKeyFor = (token: string) =>
    `provider:ocr:github-rest:${createHash('sha256').update(`Bearer ${token}`).digest('hex')}:capacity:v1`
  const actor = (userId: string): Principal => ({
    kind: 'session',
    userId,
    sessionId: 'github-fixture',
  })
  const workspaceKey = (): Principal => ({
    kind: 'workspace_api_key',
    workspaceId: ids.workspaceId,
    keyId: 'github-fixture',
  })
  const shaFor = (content: string) => createHash('sha1').update(content).digest('hex')

  function repository(name: string, readers = [ids.aliceId, ids.bobId]) {
    const value: RepositoryFixture = {
      installed: true,
      readers: new Set(readers),
      defaultBranch: 'trunk',
      files: new Map([
        [
          'docs/readme.md',
          `Orion ${name}: repository documentation visible to authorized members.`,
        ],
      ]),
      symlinks: new Map(),
      deniedStatus: 404,
      throttledReaders: new Set(),
      truncated: false,
    }
    repositories.set(name, value)
    return value
  }

  /** Implements only the documented GitHub endpoints requested by this fixture. */
  async function githubRequest(input: string | URL | Request, init?: RequestInit) {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.href === 'https://github.com/login/oauth/access_token') {
      expect(request.method).toBe('POST')
      const body = new URLSearchParams(await request.text())
      expect(body.get('client_id')).toBe('github-fixture-client')
      expect(body.get('client_secret')).toBe('github-fixture-client-secret')
      if (body.has('code')) {
        expect(oauthVerification).toBeDefined()
        expect(body.get('code')).toBe('github-fixture-code')
        expect(body.get('code_verifier')).toBe(oauthVerification!.codeVerifier)
        expect(body.get('redirect_uri')).toBe(oauthVerification!.redirectUri)
        return Response.json({
          access_token: tokenFor(ids.aliceId),
          refresh_token: `ghr_fixture_${ids.aliceId}`,
          token_type: 'bearer',
          scope: '',
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
        })
      }
      expect(body.get('grant_type')).toBe('refresh_token')
      const member = enrolled.members.find(
        (candidate) => body.get('refresh_token') === `ghr_fixture_${candidate.userId}`
      )
      if (!member) throw new Error('Unexpected GitHub refresh credential')
      refreshedUsers.add(member.userId)
      return Response.json({
        access_token: `${tokenFor(member.userId)}_refreshed`,
        refresh_token: `ghr_fixture_${member.userId}_refreshed`,
        token_type: 'bearer',
        scope: '',
        expires_in: 28800,
        refresh_token_expires_in: 15897600,
      })
    }
    if (url.origin !== 'https://api.github.com' || request.method !== 'GET')
      throw new Error(`Unexpected outbound request: ${request.method} ${url.origin}${url.pathname}`)
    const member = enrolled.members.find((candidate) =>
      [tokenFor(candidate.userId), `${tokenFor(candidate.userId)}_refreshed`].some(
        (token) => request.headers.get('authorization') === `Bearer ${token}`
      )
    )
    if (!member) throw new Error('GitHub request did not use an enrolled member token')
    expect(request.headers.get('x-github-api-version')).toBe('2022-11-28')
    requests.push({ userId: member.userId, path: `${url.pathname}${url.search}` })
    if (url.pathname === '/user') {
      expect(member.userId).toBe(ids.aliceId)
      return Response.json({
        id: 101,
        login: 'github-fixture-alice',
        type: 'User',
        name: 'Alice Fixture',
      })
    }
    if (url.pathname === '/user/emails') {
      expect(url.searchParams.get('per_page')).toBe('100')
      expect(url.searchParams.get('page')).toBe('1')
      return Response.json([
        { email: 'personal@github-fixture.test', primary: true, verified: true },
        { email: `${member.userId}@fixture.test`, primary: false, verified: true },
      ])
    }
    const match = url.pathname.match(/^\/repos\/fixture\/([^/]+)(.*)$/)
    if (!match) throw new Error(`Unexpected GitHub endpoint: ${url.pathname}`)
    const source = repositories.get(match[1])
    if (!source) throw new Error('Unexpected GitHub repository')
    if (source.throttledReaders.has(member.userId))
      return Response.json(
        { message: 'You have exceeded a secondary rate limit.' },
        { status: 403 }
      )
    if (!source.installed || !source.readers.has(member.userId))
      return Response.json(
        { message: 'Resource not accessible by integration' },
        { status: source.deniedStatus }
      )
    if (!match[2]) return Response.json({ private: true, default_branch: source.defaultBranch })
    if (match[2].startsWith('/git/trees/')) {
      expect(decodeURIComponent(match[2].slice('/git/trees/'.length))).toBe(source.defaultBranch)
      expect(url.searchParams.get('recursive')).toBe('1')
      return Response.json({
        sha: shaFor(JSON.stringify([[...source.files], [...source.symlinks]])),
        tree: [
          ...[...source.files].map(([filePath, content]) => ({
            path: filePath,
            mode: '100644',
            type: 'blob',
            sha: shaFor(content),
            size: Buffer.byteLength(content),
          })),
          ...[...source.symlinks].map(([filePath, target]) => ({
            path: filePath,
            mode: '120000',
            type: 'blob',
            sha: shaFor(target),
            size: Buffer.byteLength(target),
          })),
        ],
        truncated: source.truncated,
      })
    }
    if (match[2].startsWith('/git/blobs/')) {
      const sha = decodeURIComponent(match[2].slice('/git/blobs/'.length))
      const content = [...source.files.values(), ...source.symlinks.values()].find(
        (value) => shaFor(value) === sha
      )
      return content === undefined
        ? Response.json({ message: 'Not Found' }, { status: 404 })
        : new Response(content)
    }
    if (match[2].startsWith('/contents/')) {
      expect(url.searchParams.get('ref')).toBe(source.defaultBranch)
      const filePath = decodeURIComponent(match[2].slice('/contents/'.length))
      const target = source.symlinks.get(filePath)
      const content =
        target === undefined
          ? source.files.get(filePath)
          : source.files.get(posix.join(posix.dirname(filePath), target))
      if (target !== undefined && content === undefined) {
        return Response.json({
          type: 'symlink',
          path: filePath,
          sha: shaFor(target),
          target,
          size: Buffer.byteLength(target),
        })
      }
      if (content === undefined) return Response.json({ message: 'Not Found' }, { status: 404 })
      return Response.json({
        type: 'file',
        path: filePath,
        sha: shaFor(target ?? content),
        size: Buffer.byteLength(content),
        encoding: 'base64',
        content: Buffer.from(content).toString('base64'),
      })
    }
    throw new Error(`Unexpected GitHub endpoint: ${url.pathname}`)
  }

  beforeEach(async () => {
    repositories.clear()
    requests.length = 0
    refreshedUsers.clear()
    oauthStateKey = undefined
    oauthVerification = undefined
    Object.assign(env, {
      GITHUB_APP_CLIENT_ID: 'github-fixture-client',
      GITHUB_APP_CLIENT_SECRET: 'github-fixture-client-secret',
    })
    ids = createKnowledgeAclFixtureIds()
    await seedKnowledgeAclFixture(ids)
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    enrolled = await seedKnowledgeMemberFixture(ids)
    const policy = await getCredentialGroupProviderAdapter('github-repositories').getPolicy(
      undefined,
      {
        workspaceId: ids.workspaceId,
      }
    )
    expect(policy.requiredScopes).toEqual([])
    await db
      .update(credentialGroup)
      .set({
        options: [
          {
            id: enrolled.optionId,
            provider: 'github-repositories',
            label: 'GitHub fixture',
            authorizationAppId: policy.authorizationAppId,
            requiredScopes: [],
            scopeVersion: policy.scopeVersion,
            required: false,
            status: 'active',
          },
        ],
      })
      .where(eq(credentialGroup.id, enrolled.groupId))
    for (const [index, member] of enrolled.members.entries()) {
      const identity = {
        providerId: 'github-repositories',
        providerSubjectId: String(index + 101),
        providerTenantId: null,
      }
      await db
        .update(credential)
        .set({
          ...identity,
          displayName: 'GitHub fixture',
          authorizationAppId: policy.authorizationAppId,
          managedOauthScopeVersion: policy.scopeVersion,
          grantedScopes: [],
          encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
            accessToken: tokenFor(member.userId),
            refreshToken: `ghr_fixture_${member.userId}`,
          }),
          accessTokenExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
          refreshTokenExpiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        })
        .where(eq(credential.id, member.credentialId))
      member.subjectToken = subjectToken(identity)
      await db
        .update(knowledgeConnectorMember)
        .set({ subjectToken: member.subjectToken })
        .where(eq(knowledgeConnectorMember.id, member.id))
    }
    await db
      .insert(resourcePolicy)
      .values({
        id: generateId(),
        workspaceId: ids.workspaceId,
        resourceType: 'credential_group',
        resourceId: enrolled.groupId,
        document: compileCredentialGroupWorkflowAccessPolicy({
          credentialGroupId: enrolled.groupId,
          allowedWorkflowIds: [],
        }),
        createdBy: ids.aliceId,
        updatedBy: ids.aliceId,
      })
      .onConflictDoNothing()
    await db
      .update(knowledgeConnector)
      .set({
        connectorType: 'github',
        sourceConfig: { repository: 'fixture/shared', maxFiles: 0 },
        memberSyncStatus: 'idle',
        memberSyncLockToken: null,
      })
      .where(eq(knowledgeConnector.id, enrolled.connectorId))
    await grant(enrolled.connectorId)
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    vi.stubGlobal('fetch', githubRequest)
    repository('shared')
  })

  afterEach(async () => {
    const files = await db
      .select({ key: document.storageKey })
      .from(document)
      .where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))
    try {
      for (const { key } of files) {
        if (key)
          await deleteFile({ key, context: 'knowledge-base' }).catch((error: unknown) => {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
          })
      }
    } finally {
      if (oauthStateKey) await getRedisClient()?.del(oauthStateKey)
      await closeRedisConnection()
      Object.assign(env, { REDIS_URL: previousClient.redis })
      resetStorageMethod()
      await db.delete(rateLimitBucket).where(
        inArray(
          rateLimitBucket.key,
          enrolled.members.flatMap(({ userId }) =>
            [tokenFor(userId), `${tokenFor(userId)}_refreshed`].map(capacityKeyFor)
          )
        )
      )
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
      vi.unstubAllGlobals()
    }
  })
  afterAll(async () => {
    Object.assign(env, {
      GITHUB_APP_CLIENT_ID: previousClient.id,
      GITHUB_APP_CLIENT_SECRET: previousClient.secret,
    })
    await db.$client.end()
  })

  async function grant(connectorId: string) {
    await grantKnowledgeConnectorCredentialAccess(
      {
        connectorId,
        workspaceId: ids.workspaceId,
        credentialGroupId: enrolled.groupId,
        credentialGroupOptionId: enrolled.optionId,
      },
      ids.aliceId
    )
  }

  async function addSource(name: string) {
    const connectorId = generateId()
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'github',
      sourceConfig: { repository: `fixture/${name}`, maxFiles: 0 },
      accessMode: 'members',
      credentialGroupId: enrolled.groupId,
      credentialGroupOptionId: enrolled.optionId,
    })
    await grant(connectorId)
    return connectorId
  }

  async function sync(connectorId = enrolled.connectorId, forceContentRefresh = true) {
    await db
      .update(knowledgeConnectorMember)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(knowledgeConnectorMember.connectorId, connectorId))
    return executeMemberSync(connectorId, {
      billingAttribution: billing,
      forceContentRefresh,
    })
  }

  async function rows(connectorId = enrolled.connectorId) {
    return db
      .select()
      .from(document)
      .where(and(eq(document.connectorId, connectorId), isNull(document.deletedAt)))
      .orderBy(document.externalId)
  }

  async function search(principal: Principal) {
    const result = await searchKnowledge.execute({
      principal,
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Orion',
        searchMode: 'hybrid',
        topK: 20,
      },
    })
    return result.results.map((item) => item.documentId).sort()
  }

  async function assertAccess(
    principal: Principal,
    row: typeof document.$inferSelect,
    allowed: boolean
  ) {
    const input = { knowledgeBaseId: ids.knowledgeBaseId, documentId: row.id }
    if (allowed) {
      expect((await readKnowledgeDocument.execute({ principal, input })).document.id).toBe(row.id)
      expect(
        (await listKnowledgeChunks.execute({ principal, input })).chunks.length
      ).toBeGreaterThan(0)
    } else {
      await expect(readKnowledgeDocument.execute({ principal, input })).rejects.toThrow(
        'Document not found'
      )
      await expect(listKnowledgeChunks.execute({ principal, input })).rejects.toThrow(
        'Document not found'
      )
    }
  }

  it.runIf(Boolean(redisUrl))(
    'completes a PKCE OAuth attempt through Redis and persists a searchable scopeless credential',
    async () => {
      Object.assign(env, { REDIS_URL: redisUrl })
      const alice = enrolled.members[0]
      const invitationToken = generateId()
      await db
        .update(knowledgeConnector)
        .set({ status: 'paused' })
        .where(eq(knowledgeConnector.id, enrolled.connectorId))
      await db.delete(credential).where(eq(credential.id, alice.credentialId))
      await db
        .update(credentialGroupEnrollment)
        .set({
          status: 'invited',
          completedAt: null,
          invitationTokenHash: sha256Hex(invitationToken),
        })
        .where(eq(credentialGroupEnrollment.id, alice.enrollmentId))
      const context = await getCredentialGroupOAuthContext(invitationToken, enrolled.optionId)
      expect(context).not.toBeNull()
      const authorization = new URL(
        await startCredentialGroupOAuth(context!, invitationToken, { returnTo: 'search' })
      )
      expect(authorization.origin + authorization.pathname).toBe(
        'https://github.com/login/oauth/authorize'
      )
      expect(authorization.searchParams.get('client_id')).toBe('github-fixture-client')
      expect(authorization.searchParams.get('scope') ?? '').toBe('')
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
      const state = authorization.searchParams.get('state')!
      oauthStateKey = `credential-group:oauth-attempt:${sha256Hex(state)}`
      const storedAttempt = await getRedisClient()!.get(oauthStateKey)
      expect(storedAttempt).not.toBeNull()
      expect(storedAttempt).not.toContain(invitationToken)
      expect(JSON.parse(storedAttempt!)).toMatchObject({ requiredScopes: [], returnTo: 'search' })
      const attempt = await consumeCredentialGroupOAuthAttempt(state)
      expect(attempt).toMatchObject({
        requiredScopes: [],
        invitationToken,
        provider: 'github-repositories',
      })
      expect(attempt!.codeVerifier).toBeTruthy()
      expect(storedAttempt).not.toContain(attempt!.codeVerifier!)
      expect(authorization.searchParams.get('code_challenge')).toBe(
        createHash('sha256').update(attempt!.codeVerifier!).digest('base64url')
      )
      expect(attempt!.redirectUri).toBe(
        'http://localhost:3000/api/auth/oauth2/callback/github-repositories'
      )
      expect(await consumeCredentialGroupOAuthAttempt(state)).toBeNull()
      oauthVerification = {
        codeVerifier: attempt!.codeVerifier!,
        redirectUri: attempt!.redirectUri,
      }
      const currentContext = await getCredentialGroupOAuthContextForEnrollment(
        attempt!,
        enrolled.optionId
      )
      expect(currentContext).not.toBeNull()
      const completion = await completeCredentialGroupOAuth(
        currentContext!,
        attempt!,
        'github-fixture-code'
      )
      expect(completion).toMatchObject({
        created: true,
        enrollmentStatus: 'in_progress',
        providerId: 'github-repositories',
      })
      const [stored] = await db
        .select()
        .from(credential)
        .where(eq(credential.id, completion.credentialId))
      expect(stored).toMatchObject({
        type: 'managed_oauth',
        grantedScopes: [],
        managedOauthStatus: 'active',
        authorizationAppId: attempt!.authorizationAppId,
        providerSubjectId: '101',
        providerTenantId: null,
        credentialGroupEnrollmentId: alice.enrollmentId,
        credentialGroupOptionId: enrolled.optionId,
      })
      expect(stored.encryptedOauthTokenSet).not.toContain(tokenFor(ids.aliceId))
      expect(await decryptManagedOAuthTokenSet(stored.encryptedOauthTokenSet!)).toMatchObject({
        accessToken: tokenFor(ids.aliceId),
        refreshToken: `ghr_fixture_${ids.aliceId}`,
      })
      expect(stored.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now())
      expect(stored.refreshTokenExpiresAt!.getTime()).toBeGreaterThan(
        stored.accessTokenExpiresAt!.getTime()
      )
      expect(await completeCredentialGroupEnrollment(invitationToken)).toBe(true)
      alice.credentialId = completion.credentialId
      await db
        .update(knowledgeConnector)
        .set({ status: 'active' })
        .where(eq(knowledgeConnector.id, enrolled.connectorId))
      const result = await sync()
      expect(result.error).toBeUndefined()
      expect(result.membersCompleted).toBe(2)
      const [shared] = await rows()
      expect(await search(actor(ids.aliceId))).toEqual([shared.id])
      await assertAccess(actor(ids.aliceId), shared, true)
    }
  )

  it('stores empty GitHub scopes but rejects missing required credential metadata in PostgreSQL', async () => {
    for (const updates of [
      { grantedScopes: null },
      { authorizationAppId: null },
      { encryptedOauthTokenSet: null },
    ]) {
      await expect(
        db
          .update(credential)
          .set(updates)
          .where(eq(credential.id, enrolled.members[0].credentialId))
      ).rejects.toMatchObject({
        cause: { code: '23514', constraint_name: 'credential_managed_oauth_source_check' },
      })
    }
    const [stored] = await db
      .select()
      .from(credential)
      .where(eq(credential.id, enrolled.members[0].credentialId))
    expect(stored.grantedScopes).toEqual([])
    expect(stored.authorizationAppId).toBeTruthy()
    expect(stored.encryptedOauthTokenSet).toBeTruthy()
  })

  it('requires member access and App installation for private repository search, documents, chunks, and files', async () => {
    repository('private', [ids.aliceId])
    const blocked = repository('uninstalled', [ids.bobId])
    blocked.installed = false
    const privateId = await addSource('private')
    const blockedId = await addSource('uninstalled')
    for (const connectorId of [enrolled.connectorId, privateId, blockedId]) {
      const result = await sync(connectorId)
      expect(result.error).toBeUndefined()
      expect(result.membersFailed).toBe(0)
    }
    const [shared] = await rows()
    const [privateFile] = await rows(privateId)
    expect(await rows(blockedId)).toEqual([])
    expect(
      requests.filter((request) => request.path.startsWith('/repos/fixture/shared/contents/'))
    ).toHaveLength(1)
    expect(shared.acl).toEqual(
      expect.arrayContaining(enrolled.members.map((member) => member.subjectToken))
    )
    expect(privateFile.acl).toEqual([enrolled.members[0].subjectToken])
    expect(await search(actor(ids.aliceId))).toEqual([shared.id, privateFile.id].sort())
    expect(await search(actor(ids.bobId))).toEqual([shared.id])
    for (const userId of [ids.aliceId, ids.bobId]) {
      const summaries = await listSearchSources.execute({
        principal: actor(userId),
        input: { workspaceId: ids.workspaceId },
      })
      expect(
        summaries.sources.map((source) => ({
          connectorId: source.connectorId,
          viewerDocumentCount: source.viewerDocumentCount,
        }))
      ).toEqual(
        expect.arrayContaining([
          { connectorId: enrolled.connectorId, viewerDocumentCount: 1 },
          { connectorId: privateId, viewerDocumentCount: userId === ids.aliceId ? 1 : 0 },
          { connectorId: blockedId, viewerDocumentCount: 0 },
        ])
      )
    }
    expect(await search(workspaceKey())).toEqual([])
    await assertAccess(actor(ids.bobId), shared, true)
    await assertAccess(actor(ids.bobId), privateFile, false)
    await assertAccess(workspaceKey(), shared, false)
    expect(
      (
        await downloadFileFromUrl(privateFile.fileUrl, {
          userId: ids.aliceId,
          knowledgeAccess: 'user',
        })
      ).toString()
    ).toContain('Orion private')
    await expect(
      downloadFileFromUrl(privateFile.fileUrl, { userId: ids.bobId, knowledgeAccess: 'user' })
    ).rejects.toThrow('Access denied')
    const observations = await db
      .select()
      .from(knowledgeDocumentObservation)
      .where(inArray(knowledgeDocumentObservation.documentId, [shared.id, privateFile.id]))
    expect(observations).toHaveLength(3)
    blocked.installed = true
    await sync(blockedId)
    const [newlyInstalled] = await rows(blockedId)
    expect(await search(actor(ids.bobId))).toEqual([shared.id, newlyInstalled.id].sort())
    await assertAccess(actor(ids.aliceId), newlyInstalled, false)
    blocked.installed = false
    await sync(blockedId)
    expect(await search(actor(ids.bobId))).toEqual([shared.id])
    await assertAccess(actor(ids.bobId), newlyInstalled, false)
  })

  it('preserves observations on secondary-rate-limit 403 and withdraws them on repository-access 403', async () => {
    await sync()
    const [shared] = await rows()
    const source = repositories.get('shared')!
    source.throttledReaders.add(ids.bobId)
    expect((await sync()).error).toMatch(/403|rate limit|provider capacity/i)
    expect(await search(actor(ids.bobId))).toEqual([shared.id])
    const [bob] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, enrolled.members[1].id))
    expect(bob.status).toBe('active')
    source.throttledReaders.clear()
    source.readers.delete(ids.bobId)
    source.deniedStatus = 403
    /** A provider cooldown protects the shared credential even when another sync starts early. */
    const requestsBeforeRetry = requests.filter(({ userId }) => userId === ids.bobId).length
    await sync()
    expect(requests.filter(({ userId }) => userId === ids.bobId)).toHaveLength(requestsBeforeRetry)
    expect(await search(actor(ids.bobId))).toEqual([shared.id])
    /** Expire only the fixture's cooldown so the next poll observes the subsequent access change. */
    await db
      .update(rateLimitBucket)
      .set({
        capacityState: sql`${rateLimitBucket.capacityState} || ${JSON.stringify({ cooldownUntil: 0, nextRequestAt: 0 })}::jsonb`,
      })
      .where(eq(rateLimitBucket.key, capacityKeyFor(tokenFor(ids.bobId))))
    await sync()
    expect(await search(actor(ids.bobId))).toEqual([])
    expect(await search(actor(ids.aliceId))).toEqual([shared.id])
    await assertAccess(actor(ids.bobId), shared, false)
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.memberId, enrolled.members[1].id))
    ).toEqual([])
  })

  it('revokes enrollment access immediately and purges suspended observations after the recovery window', async () => {
    await sync()
    const [shared] = await rows()
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(credentialGroupEnrollment.id, enrolled.members[1].enrollmentId))
    expect(await search(actor(ids.bobId))).toEqual([])
    await assertAccess(actor(ids.bobId), shared, false)
    await sync()
    const [suspended] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, enrolled.members[1].id))
    expect(suspended.status).toBe('suspended')
    expect((await rows())[0].acl).not.toContain(suspended.subjectToken)
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.memberId, suspended.id))
    ).toHaveLength(1)
    await db
      .update(knowledgeConnectorMember)
      .set({
        suspendedAt: new Date(Date.now() - (MEMBER_SUSPENDED_PURGE_DAYS + 1) * 24 * 60 * 60 * 1000),
      })
      .where(eq(knowledgeConnectorMember.id, suspended.id))
    await sync()
    expect(
      await db
        .select()
        .from(knowledgeConnectorMember)
        .where(eq(knowledgeConnectorMember.id, suspended.id))
    ).toEqual([])
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.memberId, suspended.id))
    ).toEqual([])
    expect(await search(actor(ids.aliceId))).toEqual([shared.id])
  })

  it('follows default-branch changes and persists updates and deletion revocations', async () => {
    const source = repositories.get('shared')!
    source.files.set(
      'docs/deleted.md',
      'Orion obsolete guide: this file will be removed from the repository.'
    )
    await sync()
    const before = await rows()
    const removed = before.find((row) => row.externalId === 'docs/deleted.md')!
    const updated = before.find((row) => row.externalId === 'docs/readme.md')!
    const content =
      'Orion revised guide: the repository now follows the release branch and the previous instructions are replaced.'
    source.defaultBranch = 'release/current'
    source.files.set('docs/readme.md', content)
    source.files.delete('docs/deleted.md')
    const result = await sync()
    expect(result.error).toBeUndefined()
    expect((await rows()).map((row) => row.id)).toEqual([updated.id])
    const chunks = await listKnowledgeChunks.execute({
      principal: actor(ids.aliceId),
      input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: updated.id },
    })
    expect(chunks.chunks.map((chunk) => chunk.content).join('\n')).toBe(content)
    expect((await rows())[0].contentHash).toBe(`git-sha:${shaFor(content)}`)
    await assertAccess(actor(ids.aliceId), removed, false)
    expect(await search(actor(ids.bobId))).toEqual([updated.id])
    expect(requests.some((request) => request.path.includes('/git/trees/release%2Fcurrent'))).toBe(
      true
    )
    expect(
      requests.some((request) =>
        request.path.includes('/contents/docs/readme.md?ref=release%2Fcurrent')
      )
    ).toBe(true)
    const [tombstone] = await db.select().from(document).where(eq(document.id, removed.id))
    expect(tombstone.deletedAt).toBeInstanceOf(Date)
    await db
      .update(document)
      .set({
        deletedAt: new Date(Date.now() - (MEMBER_TOMBSTONE_PURGE_DAYS + 1) * 24 * 60 * 60 * 1000),
      })
      .where(eq(document.id, removed.id))
    expect((await sync()).docsPurged).toBe(1)
    expect(await db.select().from(document).where(eq(document.id, removed.id))).toEqual([])
    expect(await db.select().from(embedding).where(eq(embedding.documentId, removed.id))).toEqual(
      []
    )
  })

  it('updates linked target content, skips unchanged hydration, and removes old chunks after target deletion', async () => {
    const source = repositories.get('shared')!
    source.files.set('target.md', 'Orion linked instructions revision one.')
    source.symlinks.set('docs/link.md', '../target.md')
    await db
      .update(knowledgeConnector)
      .set({
        sourceConfig: { repository: 'fixture/shared', pathPrefix: 'docs/link.md' },
      })
      .where(eq(knowledgeConnector.id, enrolled.connectorId))
    expect((await sync()).error).toBeUndefined()
    const [linked] = await rows()
    expect(linked.externalId).toBe('docs/link.md')
    expect(await search(actor(ids.aliceId))).toEqual([linked.id])
    const getChunks = () =>
      listKnowledgeChunks.execute({
        principal: actor(ids.aliceId),
        input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: linked.id },
      })
    expect((await getChunks()).chunks.map((chunk) => chunk.content).join('\n')).toBe(
      'Orion linked instructions revision one.'
    )

    source.files.set(
      'target.md',
      'Orion linked instructions revision two replaces the first revision.'
    )
    expect((await sync()).error).toBeUndefined()
    expect((await rows())[0].id).toBe(linked.id)
    expect((await rows())[0].contentHash).not.toBe(linked.contentHash)
    expect((await getChunks()).chunks.map((chunk) => chunk.content).join('\n')).toBe(
      source.files.get('target.md')
    )
    const requestOffset = requests.length
    expect((await sync(enrolled.connectorId, false)).error).toBeUndefined()
    expect(
      requests.slice(requestOffset).some((request) => request.path.includes('/git/blobs/'))
    ).toBe(false)

    source.files.delete('target.md')
    expect((await sync()).error).toBeUndefined()
    const [skipped] = await rows()
    expect(skipped).toMatchObject({
      id: linked.id,
      processingStatus: 'failed',
      processingError: 'Symbolic link target is not a repository file',
    })
    expect(await db.select().from(embedding).where(eq(embedding.documentId, linked.id))).toEqual([])
    await expect(getChunks()).rejects.toBeInstanceOf(KnowledgeDocumentNotReadyError)
    expect(await search(actor(ids.aliceId))).toEqual([])
    expect(await search(actor(ids.bobId))).toEqual([])
  })

  it('keeps previously observed files when GitHub reports a truncated tree', async () => {
    const source = repositories.get('shared')!
    source.files.set(
      'docs/omitted.md',
      'Orion complete guide: a partial tree must not withdraw this document.'
    )
    await sync()
    const before = await rows()
    expect(await search(actor(ids.bobId))).toEqual(before.map((row) => row.id).sort())
    for (const row of before) await assertAccess(actor(ids.bobId), row, true)
    source.files.delete('docs/omitted.md')
    source.truncated = true
    const result = await sync()
    expect(result.membersIncomplete).toBe(2)
    expect((await rows()).map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort())
    for (const row of before) await assertAccess(actor(ids.bobId), row, true)
    expect(await search(actor(ids.bobId))).toEqual(before.map((row) => row.id).sort())
  })

  it('refreshes an expired scopeless GitHub App token before real member indexing', async () => {
    await db
      .update(credential)
      .set({ accessTokenExpiresAt: new Date(0) })
      .where(eq(credential.id, enrolled.members[0].credentialId))
    const result = await sync()
    expect(result.error).toBeUndefined()
    expect(result.membersCompleted).toBe(2)
    expect(refreshedUsers).toEqual(new Set([ids.aliceId]))
    const [stored] = await db
      .select()
      .from(credential)
      .where(eq(credential.id, enrolled.members[0].credentialId))
    expect(stored.grantedScopes).toEqual([])
    expect(stored.managedOauthStatus).toBe('active')
    expect(stored.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now())
    const [shared] = await rows()
    expect(await search(actor(ids.aliceId))).toEqual([shared.id])
  })
})
