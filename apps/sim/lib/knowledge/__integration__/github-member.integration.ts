/**
 * Fixture-backed GitHub API with real PostgreSQL, credential policy/token resolution,
 * connector registry, member sync, storage, chunking, and application authorization.
 * Provider replies and embeddings are deterministic; no live GitHub account is used.
 */
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { posix } from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  credentialMember,
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  member,
  organization,
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

import {
  resolveBillingAttribution,
  resolveOrganizationBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { encryptSecret } from '@/lib/core/security/encryption'
import { resetStorageMethod } from '@/lib/core/storage'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'
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
import { GITHUB_READ_SOURCE_TIMEOUT_MS } from '@/lib/knowledge/access/github-installation'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import { subjectToken } from '@/lib/knowledge/access/tokens'
import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import {
  createKnowledgeConnector,
  listKnowledgeConnectorDocuments,
} from '@/lib/knowledge/application/connectors'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { readIndexedKnowledgeDocument } from '@/lib/knowledge/application/read-indexed-document'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { readSearchSourceOverview } from '@/lib/knowledge/application/search-source-overview'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'
import { grantKnowledgeConnectorCredentialAccess } from '@/lib/knowledge/connectors/member-access'
import * as memberSyncEngine from '@/lib/knowledge/connectors/member-sync-engine'
import {
  MEMBER_SUSPENDED_PURGE_DAYS,
  MEMBER_TOMBSTONE_PURGE_DAYS,
} from '@/lib/knowledge/connectors/sync-limits'
import { getDocuments } from '@/lib/knowledge/documents/service'
import { getTagUsageStats } from '@/lib/knowledge/tags/service'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

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
  id: number
  public: boolean
  installed: boolean
  stallRef: boolean
  readers: Set<string>
  defaultBranch: string
  files: Map<string, string>
  symlinks: Map<string, string>
  deniedStatus: 403 | 404
  throttledReaders: Set<string>
  throttledBlobReaders: Set<string>
  failedBlobs: Set<string>
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
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    slug: env.GITHUB_APP_SLUG,
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  let organizationSource = false
  let installationSuspended = false
  let referenceObserved: ((repository: string) => void) | undefined
  const installation = () => ({
    id: 42,
    app_id: 1,
    client_id: 'github-fixture-client',
    account: { id: 90, login: 'fixture', type: 'Organization' },
    repository_selection: 'selected',
    permissions: { contents: 'read', metadata: 'read' },
    suspended_at: installationSuspended ? new Date().toISOString() : null,
  })
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
      id: 9001 + repositories.size,
      public: false,
      installed: true,
      stallRef: false,
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
      throttledBlobReaders: new Set(),
      failedBlobs: new Set(),
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
    if (url.origin !== 'https://api.github.com')
      throw new Error(`Unexpected outbound request: ${request.method} ${url.origin}${url.pathname}`)
    const bearer = request.headers.get('authorization')?.slice(7) ?? ''
    if (url.pathname.startsWith('/app/installations/') || url.pathname.endsWith('/installation')) {
      const [header, payload, signature] = bearer.split('.')
      expect(
        verify(
          'RSA-SHA256',
          Buffer.from(`${header}.${payload}`),
          publicKey,
          Buffer.from(signature, 'base64url')
        )
      ).toBe(true)
      expect(JSON.parse(Buffer.from(payload, 'base64url').toString()).iss).toBe(
        'github-fixture-client'
      )
      requests.push({ userId: 'app', path: url.pathname })
      if (url.pathname === '/app/installations/42/access_tokens') {
        expect(request.method).toBe('POST')
        const body = await request.json()
        const contentToken = body.permissions.contents === 'read'
        expect(body.permissions).toEqual(
          contentToken ? { contents: 'read', metadata: 'read' } : { metadata: 'read' }
        )
        if (contentToken) expect(body.repository_ids).toHaveLength(1)
        else expect(body.repositories).toHaveLength(1)
        const repositoryId = contentToken
          ? body.repository_ids[0]
          : repositories.get(body.repositories[0])?.id
        expect(
          [...repositories.values()].some(
            (repository) => repository.id === repositoryId && repository.installed
          )
        ).toBe(true)
        return Response.json({
          token: `ghs_fixture_${contentToken ? 'installation' : 'metadata'}_${repositoryId}`,
          expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          permissions: body.permissions,
          repositories: [{ id: repositoryId }],
        })
      }
      expect(request.method).toBe('GET')
      const repositoryInstallation = url.pathname.match(/^\/repos\/fixture\/([^/]+)\/installation$/)
      if (repositoryInstallation && !repositories.get(repositoryInstallation[1])?.installed)
        return Response.json({ message: 'Not Found' }, { status: 404 })
      expect(url.pathname === '/app/installations/42' || Boolean(repositoryInstallation)).toBe(true)
      return Response.json(installation())
    }
    if (request.method !== 'GET') throw new Error(`Unexpected GitHub method: ${request.method}`)
    const installationRepository = bearer.match(
      /^ghs_fixture_(?:installation|metadata)_(\d+)$/
    )?.[1]
    const metadataToken = bearer.startsWith('ghs_fixture_metadata_')
    const installationToken = Boolean(installationRepository)
    const member = enrolled.members.find((candidate) =>
      [tokenFor(candidate.userId), `${tokenFor(candidate.userId)}_refreshed`].some(
        (token) => request.headers.get('authorization') === `Bearer ${token}`
      )
    )
    if (!member && !installationToken)
      throw new Error('GitHub request did not use an enrolled member or installation token')
    const actingId = installationToken ? 'installation' : member!.userId
    expect(request.headers.get('x-github-api-version')).toBe('2022-11-28')
    requests.push({ userId: actingId, path: `${url.pathname}${url.search}` })
    if (url.pathname === '/user') {
      expect(actingId).toBe(ids.aliceId)
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
        { email: `${actingId}@fixture.test`, primary: false, verified: true },
      ])
    }
    const match = url.pathname.match(/^\/repos\/fixture\/([^/]+)(.*)$/)
    if (!match) throw new Error(`Unexpected GitHub endpoint: ${url.pathname}`)
    const source = repositories.get(match[1])
    if (!source) throw new Error('Unexpected GitHub repository')
    if (installationToken) expect(installationRepository).toBe(String(source.id))
    if (source.throttledReaders.has(actingId))
      return Response.json(
        { message: 'You have exceeded a secondary rate limit.' },
        { status: 403 }
      )
    if (
      (installationToken && !source.installed) ||
      (!installationToken && !source.public && (!source.installed || !source.readers.has(actingId)))
    )
      return Response.json(
        { message: 'Resource not accessible by integration' },
        { status: source.deniedStatus }
      )
    if (!match[2])
      return Response.json({
        id: source.id,
        owner: { id: 90 },
        full_name: `fixture/${match[1]}`,
        private: !source.public,
        default_branch: source.defaultBranch,
      })
    expect(metadataToken).toBe(false)
    if (match[2].startsWith('/branches/')) {
      const branch = decodeURIComponent(match[2].slice('/branches/'.length))
      return branch === source.defaultBranch
        ? Response.json({ name: branch, commit: { sha: shaFor(branch) }, protected: false })
        : Response.json({ message: 'Not Found' }, { status: 404 })
    }
    if (match[2].startsWith('/git/ref/heads/')) {
      referenceObserved?.(match[1])
      if (source.stallRef)
        return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason), {
            once: true,
          })
        })
      const ref = decodeURIComponent(match[2].slice('/git/ref/heads/'.length))
      return ref === source.defaultBranch
        ? Response.json({ ref: `refs/heads/${ref}`, object: { type: 'commit', sha: shaFor(ref) } })
        : Response.json({ message: 'Not Found' }, { status: 404 })
    }
    if (match[2].startsWith('/git/trees/')) {
      const ref = decodeURIComponent(match[2].slice('/git/trees/'.length))
      const treeSha = shaFor(JSON.stringify([[...source.files], [...source.symlinks]]))
      if (ref !== source.defaultBranch && ref !== treeSha)
        return Response.json({ message: 'Not Found' }, { status: 404 })
      expect(url.searchParams.get('recursive')).toBe('1')
      return Response.json({
        sha: treeSha,
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
      if (source.throttledBlobReaders.has(actingId))
        return Response.json(
          { message: 'You have exceeded a secondary rate limit.' },
          { status: 403 }
        )
      const sha = decodeURIComponent(match[2].slice('/git/blobs/'.length))
      if (source.failedBlobs.has(sha)) {
        return Response.json(
          { message: 'Fixture provider unavailable' },
          { status: 503, headers: { 'Retry-After': '3600' } }
        )
      }
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
    organizationSource = false
    installationSuspended = false
    referenceObserved = undefined
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
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })
  afterAll(async () => {
    Object.assign(env, {
      GITHUB_APP_CLIENT_ID: previousClient.id,
      GITHUB_APP_CLIENT_SECRET: previousClient.secret,
      GITHUB_APP_ID: previousClient.appId,
      GITHUB_APP_PRIVATE_KEY: previousClient.privateKey,
      GITHUB_APP_SLUG: previousClient.slug,
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
    return memberSyncEngine.executeMemberSync(connectorId, {
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

  async function search(principal: Principal, searchMode: 'hybrid' | 'vector' = 'hybrid') {
    const result = await searchKnowledge.execute({
      principal,
      input: {
        ...(organizationSource
          ? { organizationId: ids.organizationId }
          : { workspaceId: ids.workspaceId }),
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Orion',
        searchMode,
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

  async function useOrganizationInstallation() {
    organizationSource = true
    Object.assign(env, {
      GITHUB_APP_ID: '1',
      GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      GITHUB_APP_SLUG: 'github-fixture',
    })
    await db.insert(member).values([
      { id: generateId(), organizationId: ids.organizationId, userId: ids.aliceId, role: 'owner' },
      { id: generateId(), organizationId: ids.organizationId, userId: ids.bobId, role: 'member' },
    ])
    await db
      .update(knowledgeBase)
      .set({ workspaceId: null, organizationId: ids.organizationId })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db
      .update(credentialGroup)
      .set({ workspaceId: null, organizationId: ids.organizationId })
      .where(eq(credentialGroup.id, enrolled.groupId))
    await db
      .update(resourcePolicy)
      .set({
        workspaceId: null,
        organizationId: ids.organizationId,
        document: buildOrganizationAccountAccessPolicy(enrolled.groupId, []),
      })
      .where(
        and(
          eq(resourcePolicy.resourceType, 'credential_group'),
          eq(resourcePolicy.resourceId, enrolled.groupId)
        )
      )
    await db
      .update(credential)
      .set({ workspaceId: null, organizationId: ids.organizationId })
      .where(
        inArray(
          credential.id,
          enrolled.members.map((entry) => entry.credentialId)
        )
      )
    await db
      .update(knowledgeConnectorMember)
      .set({ workspaceId: null, organizationId: ids.organizationId })
      .where(eq(knowledgeConnectorMember.connectorId, enrolled.connectorId))
    const installationCredentialId = generateId()
    const { encrypted } = await encryptSecret(
      JSON.stringify({
        type: 'github_app_installation',
        version: 1,
        appId: '1',
        appClientId: 'github-fixture-client',
        installationId: '42',
        accountId: '90',
        accountType: 'Organization',
        accountLogin: 'fixture',
        repositorySelection: 'selected',
      })
    )
    await db.insert(credential).values({
      id: installationCredentialId,
      organizationId: ids.organizationId,
      type: 'service_account',
      providerId: 'github-app-installation',
      providerSubjectId: '42',
      providerTenantId: '90',
      encryptedServiceAccountKey: encrypted,
      displayName: 'GitHub fixture installation',
      createdBy: ids.aliceId,
    })
    await db.insert(credentialMember).values({
      id: generateId(),
      credentialId: installationCredentialId,
      userId: ids.aliceId,
      role: 'admin',
      status: 'active',
    })
    await db
      .update(knowledgeConnector)
      .set({
        credentialId: installationCredentialId,
        sourceConfig: { repository: 'fixture/shared', githubRepositoryId: '9001', maxFiles: 0 },
      })
      .where(eq(knowledgeConnector.id, enrolled.connectorId))
    billing = await resolveOrganizationBillingAttribution({
      actorUserId: ids.aliceId,
      organizationId: ids.organizationId,
    })
    return installationCredentialId
  }

  it('reuses connected organization members for a later installation source without another enrollment', async () => {
    const installationCredentialId = await useOrganizationInstallation()
    expect((await sync()).error).toBeUndefined()
    const [shared] = await rows()
    const enrollmentsBefore = await db
      .select({
        id: credentialGroupEnrollment.id,
        userId: credentialGroupEnrollment.userId,
        status: credentialGroupEnrollment.status,
      })
      .from(credentialGroupEnrollment)
      .where(eq(credentialGroupEnrollment.credentialGroupId, enrolled.groupId))
      .orderBy(credentialGroupEnrollment.id)
    const credentialsBefore = await db
      .select({
        id: credential.id,
        enrollmentId: credential.credentialGroupEnrollmentId,
        subjectId: credential.providerSubjectId,
      })
      .from(credential)
      .where(eq(credential.credentialGroupOptionId, enrolled.optionId))
      .orderBy(credential.id)
    const later = repository('later', [ids.aliceId])
    const input = {
      knowledgeBaseId: ids.knowledgeBaseId,
      assertedOrganizationId: ids.organizationId,
      connectorType: 'github',
      accessMode: 'members' as const,
      credentialId: installationCredentialId,
      sourceConfig: { repository: 'fixture/later' },
      syncIntervalMinutes: 0,
    }
    await expect(
      createKnowledgeConnector.execute({ principal: actor(ids.bobId), input })
    ).rejects.toThrow()
    const dispatchedSync = vi.spyOn(memberSyncEngine, 'executeMemberSync')
    const { connector } = await createKnowledgeConnector.execute({
      principal: actor(ids.aliceId),
      input,
    })
    try {
      expect(dispatchedSync).toHaveBeenCalledExactlyOnceWith(connector.id, expect.any(Object))
      expect((await dispatchedSync.mock.results[0].value).error).toBeUndefined()
    } finally {
      dispatchedSync.mockRestore()
    }
    const connectorId = connector.id
    expect(connector).toMatchObject({
      credentialGroupId: enrolled.groupId,
      credentialGroupOptionId: enrolled.optionId,
      sourceConfig: { repository: 'fixture/later', githubRepositoryId: String(later.id) },
    })
    const [current] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, connectorId))
    expect(current).toMatchObject({ memberSyncStatus: 'idle' })
    expect(current.lastMemberSyncAt).not.toBeNull()
    const memberships = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.connectorId, connectorId))
    expect(memberships).toHaveLength(2)
    expect(memberships.map((row) => row.credentialId).sort()).toEqual(
      credentialsBefore.map((row) => row.id).sort()
    )
    expect(
      await db
        .select({
          id: credentialGroupEnrollment.id,
          userId: credentialGroupEnrollment.userId,
          status: credentialGroupEnrollment.status,
        })
        .from(credentialGroupEnrollment)
        .where(eq(credentialGroupEnrollment.credentialGroupId, enrolled.groupId))
        .orderBy(credentialGroupEnrollment.id)
    ).toEqual(enrollmentsBefore)
    expect(
      await db
        .select({
          id: credential.id,
          enrollmentId: credential.credentialGroupEnrollmentId,
          subjectId: credential.providerSubjectId,
        })
        .from(credential)
        .where(eq(credential.credentialGroupOptionId, enrolled.optionId))
        .orderBy(credential.id)
    ).toEqual(credentialsBefore)
    const [indexed] = await rows(connectorId)
    expect(await search(actor(ids.aliceId))).toEqual([shared.id, indexed.id].sort())
    expect(await search(actor(ids.bobId))).toEqual([shared.id])
    await assertAccess(actor(ids.aliceId), indexed, true)
    await assertAccess(actor(ids.bobId), indexed, false)
    const indexedRead = (userId: string) =>
      readIndexedKnowledgeDocument.execute({
        principal: actor(userId),
        input: {
          organizationId: ids.organizationId,
          target: { kind: 'id', documentId: indexed.id },
          limit: 10,
          resultSecretRegistry: new ResolvedSecretTraceRegistry(),
        },
      })
    expect(
      (await indexedRead(ids.aliceId)).chunks?.map((chunk) => chunk.content).join('\n')
    ).toContain('Orion later')
    await expect(indexedRead(ids.bobId)).rejects.toThrow('Document not found')
    /** Organization cache bytes are internal; members read through the authorized Search operation. */
    await expect(
      downloadFileFromUrl(indexed.fileUrl, { userId: ids.aliceId, knowledgeAccess: 'user' })
    ).rejects.toThrow('Access denied')
    await expect(
      downloadFileFromUrl(indexed.fileUrl, { userId: ids.bobId, knowledgeAccess: 'user' })
    ).rejects.toThrow('Access denied')
    for (const userId of [ids.aliceId, ids.bobId]) {
      const { sources } = await listSearchSources.execute({
        principal: actor(userId),
        input: { organizationId: ids.organizationId, connectorId },
      })
      expect(sources).toMatchObject([
        {
          connectorId,
          viewerMembership: 'connected',
          viewerDocumentCount: userId === ids.aliceId ? 1 : 0,
        },
      ])
    }
    expect(
      requests
        .filter((entry) => entry.path.startsWith('/repos/fixture/later/git/blobs/'))
        .map((entry) => entry.userId)
    ).toEqual(['installation'])
  })

  it('keeps actual skips, legacy skips, and provider failures distinct in authorized lists and source counts', async () => {
    await useOrganizationInstallation()
    const source = repositories.get('shared')!
    source.readers.delete(ids.bobId)
    source.files.set('empty.txt', '')
    source.files.set('image.png', 'binary\0contents')
    expect((await sync()).error).toBeUndefined()
    const initial = await rows()
    const empty = initial.find((row) => row.externalId === 'empty.txt')!
    const binary = initial.find((row) => row.externalId === 'image.png')!
    expect(empty).toMatchObject({ processingStatus: 'failed', storageKey: null })
    expect(binary).toMatchObject({ processingStatus: 'failed', storageKey: null })
    expect(empty.contentHash).not.toBeNull()
    await db.update(document).set({ processingStatus: 'failed' }).where(eq(document.id, empty.id))
    const summary = async (userId: string) =>
      (
        await listSearchSources.execute({
          principal: actor(userId),
          input: { organizationId: ids.organizationId, connectorId: enrolled.connectorId },
        })
      ).sources[0]
    expect(await summary(ids.aliceId)).toMatchObject({
      viewerDocumentCount: 1,
      viewerFailedDocumentCount: 0,
      hasSyncError: false,
    })
    source.files.set('unavailable.txt', 'Orion content whose blob cannot be fetched.')
    source.failedBlobs.add(shaFor(source.files.get('unavailable.txt')!))
    await sync()
    await db.update(document).set({ processingStatus: 'failed' }).where(eq(document.id, empty.id))
    const failed = (await rows()).find((row) => row.externalId === 'unavailable.txt')!
    expect(failed).toMatchObject({
      processingStatus: 'failed',
      storageKey: null,
      contentHash: null,
    })
    for (const userId of [ids.aliceId, ids.bobId]) {
      const provider = createKnowledgeAccessProvider(actor(userId), {
        organizationId: ids.organizationId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
      })
      const listed = await getDocuments(ids.knowledgeBaseId, {}, 'github-skip-outcomes', provider)
      expect(listed.pagination.total).toBe(userId === ids.aliceId ? 4 : 0)
      if (userId === ids.aliceId) {
        expect(listed.documents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: empty.id,
              processingStatus: 'failed',
              processingOutcome: 'skipped',
            }),
            expect.objectContaining({
              id: binary.id,
              processingStatus: 'failed',
              processingOutcome: 'skipped',
            }),
            expect.objectContaining({ id: failed.id, processingStatus: 'failed' }),
          ])
        )
      }
      for (const filter of ['failed', 'skipped'] as const) {
        const outcomes = await listKnowledgeConnectorDocuments.execute({
          principal: actor(userId),
          input: {
            connectorId: enrolled.connectorId,
            knowledgeBaseId: ids.knowledgeBaseId,
            filter,
          },
        })
        expect(outcomes.counts).toMatchObject({
          failed: userId === ids.aliceId ? 1 : 0,
          skipped: userId === ids.aliceId ? 2 : 0,
        })
        expect(outcomes.documents.map((row) => row.id).sort()).toEqual(
          userId === ids.aliceId
            ? (filter === 'failed' ? [failed.id] : [empty.id, binary.id]).sort()
            : []
        )
      }
      expect(await summary(userId)).toMatchObject({
        viewerDocumentCount: userId === ids.aliceId ? 1 : 0,
        viewerFailedDocumentCount: userId === ids.aliceId ? 1 : 0,
      })
    }
  })

  it('indexes an organization installation once and denies live user, app, and org revocations before search or reads', async () => {
    const installationCredentialId = await useOrganizationInstallation()
    const unrelatedSources = Array.from({ length: 105 }, () => generateId())
    await db.insert(knowledgeConnector).values(
      unrelatedSources.map((id) => ({
        id,
        knowledgeBaseId: ids.knowledgeBaseId,
        connectorType: 'github',
        accessMode: 'members',
        credentialId: installationCredentialId,
        credentialGroupId: enrolled.groupId,
        credentialGroupOptionId: enrolled.optionId,
        sourceConfig: { repository: 'fixture/shared', githubRepositoryId: '9001' },
      }))
    )
    await db.insert(knowledgeConnectorMember).values(
      unrelatedSources.map((connectorId) => ({
        id: generateId(),
        organizationId: ids.organizationId,
        connectorId,
        credentialId: enrolled.members[0].credentialId,
        subjectToken: enrolled.members[0].subjectToken,
      }))
    )
    const result = await sync()
    expect(result.error).toBeUndefined()
    expect(result.docsHydratedOnce).toBe(1)
    const [indexed] = await rows()
    expect(indexed).toBeDefined()
    const provider = (userId: string) =>
      createKnowledgeAccessProvider(actor(userId), {
        organizationId: ids.organizationId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
      })
    const page = (userId: string, offset = 0) =>
      getDocuments(
        ids.knowledgeBaseId,
        { limit: 1, offset, sortBy: 'filename', sortOrder: 'asc' },
        'github-candidate-regression',
        provider(userId)
      )
    expect(await page(ids.aliceId)).toMatchObject({
      documents: [{ id: indexed.id }],
      pagination: { total: 1 },
    })
    expect(
      (
        await readSearchSourceOverview.execute({
          principal: actor(ids.aliceId),
          input: { organizationId: ids.organizationId },
        })
      ).hasSearchableDocuments
    ).toBe(true)
    await db.update(document).set({ tag1: 'fixture' }).where(eq(document.id, indexed.id))
    await db.update(embedding).set({ tag1: 'fixture' }).where(eq(embedding.documentId, indexed.id))
    expect(
      await getTagUsageStats(ids.knowledgeBaseId, provider(ids.aliceId), 'github-tag-regression')
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tagSlot: 'tag1', documentCount: 1, chunkCount: 1 }),
      ])
    )
    expect(
      (
        await readIndexedKnowledgeDocument.execute({
          principal: actor(ids.aliceId),
          input: {
            organizationId: ids.organizationId,
            target: { kind: 'url', url: indexed.sourceUrl! },
            limit: 1,
            resultSecretRegistry: new ResolvedSecretTraceRegistry(),
          },
        })
      ).documentId
    ).toBe(indexed.id)
    expect(
      requests.filter((entry) => entry.path.includes('/git/blobs/')).map((entry) => entry.userId)
    ).toEqual(['installation'])
    expect(await search(actor(ids.aliceId))).toEqual([indexed.id])
    expect(await search(actor(ids.bobId))).toEqual([indexed.id])
    await assertAccess(actor(ids.bobId), indexed, true)
    const source = repositories.get('shared')!
    source.readers.delete(ids.bobId)
    expect(await page(ids.bobId)).toMatchObject({ documents: [], pagination: { total: 0 } })
    expect(await search(actor(ids.bobId))).toEqual([])
    await assertAccess(actor(ids.bobId), indexed, false)
    expect(await search(actor(ids.aliceId))).toEqual([indexed.id])
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.documentId, indexed.id))
    ).toHaveLength(2)
    source.readers.add(ids.bobId)
    source.public = true
    source.installed = false
    expect(await search(actor(ids.aliceId))).toEqual([])
    await assertAccess(actor(ids.aliceId), indexed, false)
    source.installed = true
    installationSuspended = true
    expect(await search(actor(ids.aliceId))).toEqual([])
    installationSuspended = false
    expect(await search(actor(ids.aliceId))).toEqual([indexed.id])
    const slowRepository = repository('slow')
    const slowSourceId = generateId()
    await db.insert(knowledgeConnector).values({
      id: slowSourceId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'github',
      accessMode: 'members',
      credentialId: installationCredentialId,
      credentialGroupId: enrolled.groupId,
      credentialGroupOptionId: enrolled.optionId,
      sourceConfig: { repository: 'fixture/slow', githubRepositoryId: String(slowRepository.id) },
    })
    expect((await sync(slowSourceId)).error).toBeUndefined()
    const [slowDocument] = await rows(slowSourceId)
    expect(slowDocument).toBeDefined()
    const deniedRepository = repository('denied-paging', [ids.aliceId])
    const deniedSourceId = generateId()
    await db.insert(knowledgeConnector).values({
      id: deniedSourceId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'github',
      accessMode: 'members',
      credentialId: installationCredentialId,
      credentialGroupId: enrolled.groupId,
      credentialGroupOptionId: enrolled.optionId,
      sourceConfig: {
        repository: 'fixture/denied-paging',
        githubRepositoryId: String(deniedRepository.id),
      },
    })
    expect((await sync(deniedSourceId)).error).toBeUndefined()
    const [deniedDocument] = await rows(deniedSourceId)
    deniedRepository.readers.delete(ids.aliceId)
    for (const [id, filename] of [
      [indexed.id, 'alpha'],
      [deniedDocument.id, 'beta'],
      [slowDocument.id, 'gamma'],
    ])
      await db.update(document).set({ filename }).where(eq(document.id, id))
    expect(await page(ids.aliceId, 1)).toMatchObject({
      documents: [{ id: slowDocument.id }],
      pagination: { total: 2, offset: 1 },
    })
    slowRepository.stallRef = true
    const sourceTimers: AbortController[] = []
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
    const timerSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((duration) => {
      if (duration !== GITHUB_READ_SOURCE_TIMEOUT_MS) return nativeTimeout(duration)
      const controller = new AbortController()
      sourceTimers.push(controller)
      return controller.signal
    })
    try {
      const observed = new Set<string>()
      const candidatesStarted = new Promise<void>((resolve) => {
        referenceObserved = (name) => {
          observed.add(name)
          if (observed.has('shared') && observed.has('slow')) resolve()
        }
      })
      const pending = search(actor(ids.aliceId), 'vector')
      await candidatesStarted
      /** Complete the fast response's microtasks before expiring the stalled candidate. */
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      for (const timer of sourceTimers) timer.abort(new Error('fixture source timeout'))
      expect(await pending).toEqual([indexed.id])
    } finally {
      timerSpy.mockRestore()
      referenceObserved = undefined
      slowRepository.stallRef = false
    }
    await db
      .delete(member)
      .where(and(eq(member.organizationId, ids.organizationId), eq(member.userId, ids.bobId)))
    await expect(search(actor(ids.bobId))).rejects.toThrow()
    await assertAccess(actor(ids.bobId), indexed, false)
  })

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
      requests.filter((request) => request.path.startsWith('/repos/fixture/shared/git/blobs/'))
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
    const throttled = await sync()
    expect(throttled.error).toBeUndefined()
    expect(throttled.deferred).toMatchObject({ reason: 'rate_limit', providerId: 'github-rest' })
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
      requests.some(
        (request) => request.path === `/repos/fixture/shared/git/blobs/${shaFor(content)}`
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

  it('restarts an expired pinned tree on the current default branch and rechecks member repository access', async () => {
    const source = repositories.get('shared')!
    source.files.set('docs/deleted.md', 'Orion obsolete documentation.')
    await sync()
    const before = await rows()
    const updated = before.find((row) => row.externalId === 'docs/readme.md')!
    const removed = before.find((row) => row.externalId === 'docs/deleted.md')!
    source.files.set('docs/readme.md', 'Orion intermediate revision awaiting provider capacity.')
    const expiredTreeSha = shaFor(JSON.stringify([[...source.files], [...source.symlinks]]))
    source.throttledBlobReaders.add(ids.aliceId)
    await db
      .update(knowledgeConnectorMember)
      .set({ lastStartedAt: new Date(0) })
      .where(eq(knowledgeConnectorMember.id, enrolled.members[0].id))
    expect((await sync()).deferred).toMatchObject({ reason: 'rate_limit' })
    const [paused] = await db
      .select({ checkpoint: knowledgeConnectorMember.listingCheckpoint })
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, enrolled.members[0].id))
    expect(paused.checkpoint).toMatchObject({
      complete: false,
      listedCount: 0,
      cursor: JSON.stringify({ version: 1, treeSha: expiredTreeSha, branch: 'trunk', offset: 0 }),
    })
    expect(await search(actor(ids.aliceId))).toEqual(before.map((row) => row.id).sort())
    expect(await search(actor(ids.bobId))).toEqual(before.map((row) => row.id).sort())
    source.throttledBlobReaders.clear()
    source.defaultBranch = 'release/current'
    const content = 'Orion current release documentation remains accessible to Alice.'
    source.files.set('docs/readme.md', content)
    source.files.delete('docs/deleted.md')
    source.readers.delete(ids.bobId)
    await db
      .update(rateLimitBucket)
      .set({
        capacityState: sql`${rateLimitBucket.capacityState} || ${JSON.stringify({ cooldownUntil: 0, nextRequestAt: 0 })}::jsonb`,
      })
      .where(eq(rateLimitBucket.key, capacityKeyFor(tokenFor(ids.aliceId))))
    const requestOffset = requests.length
    const resumed = await sync()
    expect(resumed.error).toBeUndefined()
    expect(resumed.deferred).toBeUndefined()
    expect(resumed.membersFailed).toBe(0)
    const [current] = await rows()
    expect(current).toMatchObject({
      id: updated.id,
      contentHash: `git-sha:${shaFor(content)}`,
      acl: [enrolled.members[0].subjectToken],
    })
    expect(await search(actor(ids.aliceId))).toEqual([updated.id])
    expect(await search(actor(ids.bobId))).toEqual([])
    await assertAccess(actor(ids.aliceId), current, true)
    await assertAccess(actor(ids.bobId), current, false)
    const [tombstone] = await db.select().from(document).where(eq(document.id, removed.id))
    expect(tombstone.deletedAt).toBeInstanceOf(Date)
    const resumedPaths = requests.slice(requestOffset).map((request) => request.path)
    expect(resumedPaths).toContain(`/repos/fixture/shared/git/trees/${expiredTreeSha}?recursive=1`)
    expect(resumedPaths).toContain('/repos/fixture/shared/git/trees/release%2Fcurrent?recursive=1')
    expect(resumedPaths).not.toContain('/repos/fixture/shared/git/trees/trunk?recursive=1')
    expect(resumedPaths).toContain(`/repos/fixture/shared/git/blobs/${shaFor(content)}`)
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
