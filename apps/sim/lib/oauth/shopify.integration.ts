import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname } from 'node:path'
import { db } from '@sim/db'
import {
  account,
  credential,
  credentialMember,
  knowledgeBase,
  knowledgeConnector,
  member,
  organization,
  pendingCredentialDraft,
  permissions,
  shopifyInstallationAttempt,
  shopifyInstallationScope,
  user,
  workspace,
} from '@sim/db/schema'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { hmacSha256Hex } from '@sim/security/hmac'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred, type Deferred } from '@sim/testing/helpers/deferred'
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { processCredentialDraft } from '@/lib/credentials/draft-processor'
import { CREDENTIAL_REVOKED_SYNC_ERROR } from '@/lib/knowledge/connectors/sync-limits'
import { refreshTokenIfNeeded } from '@/lib/oauth/credential-service'
import * as refreshCoordination from '@/lib/oauth/refresh-coordination'
import { completeShopifyOAuthConnection } from '@/lib/oauth/shopify'
import { getShopifyRefreshScope, ShopifyOAuthError } from '@/lib/oauth/shopify-installation'
import {
  clearDeadFlag,
  getRecentTerminalError,
  markCredentialDead,
} from '@/lib/oauth/terminal-errors'
import { rememberShopifyAccountScopes } from '@/lib/shopify/privacy/installation-scopes'
import { GET as shopifyCallback } from '@/app/api/auth/oauth2/callback/shopify/route'

vi.mock('@/lib/auth', () => authMock)

vi.hoisted(() => {
  process.env.SHOPIFY_CLIENT_ID = 'shopify-integration-client'
  process.env.SHOPIFY_CLIENT_SECRET = 'shopify-integration-secret'
})

const originalFetch = globalThis.fetch
const redisUrl = readTestRedisUrl()
const userIds = [generateId(), generateId()]
const workspaceId = generateId()
const organizationId = generateId()
const credentialId = generateId()
const shopDomain = `fixture-${generateId()}.myshopify.com`
const shopId = '123456789012345'
const rowIds = [generateId(), generateId(), generateId()]
const checks: { name: string; status: string; durationMs: number }[] = []
let testStartedAt = 0
let provider: Server
let providerUrl: string
let sequence = 0
let currentRefresh = 'fixture-refresh-0'
let tokenRequests = 0
let overlappingRequests = 0
let activeRequests = 0
let malformedField: string | undefined
let rejectionStatus: number | undefined
let identityRejectionStatus: number | undefined
let pausedTokenResponse: { headersReceived: Deferred<void>; release: Deferred<void> } | undefined

async function rows() {
  return db.select().from(account).where(inArray(account.id, rowIds))
}

async function connect(userId = userIds[0], signal?: AbortSignal) {
  const input = {
    code: 'fixture-authorization-code',
    accessToken: 'fixture-access-0',
    shopDomain,
    scope: 'read_products',
    userId,
    signal,
  }
  return completeShopifyOAuthConnection(input)
}

async function resolve(rowId = rowIds[0]) {
  const [stored] = await db.select().from(account).where(eq(account.id, rowId))
  if (!stored) throw new Error('Missing fixture account')
  return refreshTokenIfNeeded('shopify-integration', stored, rowId)
}

beforeAll(async () => {
  Object.assign(env, { REDIS_URL: redisUrl })
  await db.insert(user).values(
    userIds.map((id) => ({
      id,
      name: 'Shopify fixture',
      email: `${id}@shopify.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(workspace).values({
    id: workspaceId,
    name: 'Shopify fixture',
    ownerId: userIds[0],
    billedAccountUserId: userIds[0],
  })
  await db.insert(organization).values({
    id: organizationId,
    name: 'Shopify fixture',
    slug: generateId(),
    createdAt: new Date(),
  })
  await db.insert(member).values({
    id: generateId(),
    organizationId,
    userId: userIds[0],
    role: 'owner',
    createdAt: new Date(),
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: userIds[0],
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  provider = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    response.setHeader('content-type', 'application/json')
    if (request.url?.endsWith('/shop.json')) {
      response.end(JSON.stringify({ shop: { id: shopId } }))
      return
    }
    if (request.url?.endsWith('/graphql.json')) {
      if (identityRejectionStatus) {
        response.writeHead(identityRejectionStatus).end('{}')
        return
      }
      const query = JSON.parse(body).query
      if (request.method !== 'POST' || !/shop\s*\{\s*id\s*\}/.test(query)) {
        response.writeHead(400).end('{}')
        return
      }
      response.end(JSON.stringify({ data: { shop: { id: `gid://shopify/Shop/${shopId}` } } }))
      return
    }
    if (request.url !== '/admin/oauth/access_token') {
      response.writeHead(404).end('{}')
      return
    }
    tokenRequests++
    activeRequests++
    if (activeRequests > 1) overlappingRequests++
    await sleep(30)
    const fields = request.headers['content-type']?.includes('application/json')
      ? JSON.parse(body)
      : Object.fromEntries(new URLSearchParams(body))
    const refresh = fields.grant_type === 'refresh_token'
    const valid =
      fields.client_id === 'shopify-integration-client' &&
      fields.client_secret === 'shopify-integration-secret' &&
      (refresh
        ? fields.refresh_token === currentRefresh
        : fields.code === 'fixture-authorization-code' && String(fields.expiring) === '1')
    activeRequests--
    if (rejectionStatus || !valid) {
      response
        .writeHead(rejectionStatus ?? 401)
        .end(
          JSON.stringify({ error: 'invalid_request', error_description: 'fixture-private-token' })
        )
      return
    }
    sequence++
    currentRefresh = `fixture-refresh-${sequence}`
    const tokens: Record<string, unknown> = {
      access_token: `fixture-access-${sequence}`,
      refresh_token: currentRefresh,
      expires_in: 3600,
      refresh_token_expires_in: 7776000,
      scope: 'read_products',
    }
    if (malformedField) delete tokens[malformedField]
    if (pausedTokenResponse) {
      const payload = JSON.stringify(tokens)
      response.write(payload.slice(0, 1))
      await pausedTokenResponse.release.promise
      response.end(payload.slice(1))
      return
    }
    response.end(JSON.stringify(tokens))
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Provider fixture failed to bind')
  providerUrl = `http://127.0.0.1:${address.port}`
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (![shopDomain, 'accounts.shopify.com'].includes(target.hostname)) {
      throw new Error('Unexpected provider target')
    }
    const response = await originalFetch(`${providerUrl}${target.pathname}`, init)
    if (target.pathname === '/admin/oauth/access_token') {
      pausedTokenResponse?.headersReceived.resolve()
    }
    return response
  })
})

beforeEach(async () => {
  testStartedAt = Date.now()
  authMockFns.mockGetSession.mockReset()
  authMockFns.mockGetSession.mockResolvedValue(null)
  sequence = 0
  currentRefresh = 'fixture-refresh-0'
  tokenRequests = 0
  overlappingRequests = 0
  malformedField = undefined
  rejectionStatus = undefined
  identityRejectionStatus = undefined
  pausedTokenResponse = undefined
  await db
    .delete(shopifyInstallationScope)
    .where(eq(shopifyInstallationScope.shopDomain, shopDomain))
  await db.delete(pendingCredentialDraft).where(inArray(pendingCredentialDraft.userId, userIds))
  await clearDeadFlag(
    refreshCoordination.getOAuthRefreshCoordinationIdentity(getShopifyRefreshScope(shopDomain))
  )
  await db
    .delete(shopifyInstallationAttempt)
    .where(eq(shopifyInstallationAttempt.shopDomain, shopDomain))
  await db.delete(credential).where(eq(credential.workspaceId, workspaceId))
  await db.delete(credential).where(eq(credential.organizationId, organizationId))
  await db.delete(account).where(inArray(account.userId, userIds))
  await db.insert(account).values(
    rowIds.map((id, index) => ({
      id,
      userId: userIds[index === 1 ? 1 : 0],
      providerId: 'shopify',
      accountId: index === 2 ? '999' : shopId,
      idToken: index === 2 ? 'unrelated.myshopify.com' : shopDomain,
      accessToken: 'fixture-access-0',
      refreshToken: 'fixture-refresh-0',
      accessTokenExpiresAt: new Date(Date.now() - 1000),
      refreshTokenExpiresAt: new Date(Date.now() + 86400000),
      scope: 'read_products',
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(credential).values({
    id: credentialId,
    type: 'oauth',
    workspaceId,
    accountId: rowIds[0],
    providerId: 'shopify',
    displayName: 'Shopify fixture',
    createdBy: userIds[0],
  })
  await db.insert(credentialMember).values({
    id: generateId(),
    credentialId,
    userId: userIds[0],
    role: 'admin',
    status: 'active',
    invitedBy: userIds[0],
    joinedAt: new Date(),
  })
})

afterEach((context) => {
  pausedTokenResponse?.release.resolve()
  checks.push({
    name: context.task.name,
    status: context.task.result?.state ?? 'unknown',
    durationMs: Date.now() - testStartedAt,
  })
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  await clearDeadFlag(
    refreshCoordination.getOAuthRefreshCoordinationIdentity(getShopifyRefreshScope(shopDomain))
  )
  await closeRedisConnection()
  await db
    .delete(shopifyInstallationScope)
    .where(eq(shopifyInstallationScope.shopDomain, shopDomain))
  await db
    .delete(shopifyInstallationAttempt)
    .where(eq(shopifyInstallationAttempt.shopDomain, shopDomain))
  await db.delete(workspace).where(eq(workspace.id, workspaceId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, userIds))
  if (provider) {
    provider.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve()))
    )
  }
  const reportPath = process.env.SHOPIFY_OAUTH_REPORT_PATH ?? 'test-results/shopify-oauth.json'
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
})

async function installationCallback(
  failure?: 'browser' | 'expiry' | 'shop' | 'state' | 'hmac' | 'cancellation'
) {
  const attemptId = generateId()
  const browserProof = generateId()
  await db.insert(shopifyInstallationAttempt).values({
    id: attemptId,
    clientId: 'shopify-integration-client',
    shopDomain,
    browserHash: createHash('sha256').update(browserProof).digest('hex'),
    expiresAt: failure === 'expiry' ? new Date(0) : new Date(Date.now() + 900_000),
  })
  const state = `install.${attemptId}.${hmacSha256Hex(`${attemptId}:${shopDomain}`, 'shopify-integration-secret')}`
  const query = new URLSearchParams({
    code: 'fixture-authorization-code',
    state: failure === 'state' ? `${state}invalid` : state,
    shop: failure === 'shop' ? 'different.myshopify.com' : shopDomain,
  })
  const message = [...query.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  query.set(
    'hmac',
    failure === 'hmac' ? '0'.repeat(64) : hmacSha256Hex(message, 'shopify-integration-secret')
  )
  const controller = new AbortController()
  if (failure === 'cancellation') controller.abort(new DOMException('Cancelled', 'AbortError'))
  const request = new NextRequest(
    `http://localhost:3000/api/auth/oauth2/callback/shopify?${query}`,
    {
      headers: {
        cookie: `shopify_install_${attemptId}=${failure === 'browser' ? generateId() : browserProof}`,
      },
      signal: controller.signal,
    }
  )
  const response = await shopifyCallback(request, undefined)
  if (!failure)
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('attempt')).toBe(
      attemptId
    )
  return { response, attemptId, browserProof, request }
}

describe('Shopify offline installation tokens against PostgreSQL and HTTP', () => {
  it('persists a browser-bound Shopify installation before requiring a Sim login', async () => {
    const { response, attemptId } = await installationCallback()
    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/oauth/shopify/connect')
    const [attempt] = await db
      .select()
      .from(shopifyInstallationAttempt)
      .where(eq(shopifyInstallationAttempt.id, attemptId))
    expect(attempt.shopId).toBe(shopId)
    expect(attempt.encryptedTokens).not.toContain('fixture-access-1')
    expect(attempt.encryptedTokens).toBeTruthy()
    expect(
      (await rows()).filter((row) => row.accountId === shopId).map((row) => row.accessToken)
    ).toEqual(['fixture-access-1', 'fixture-access-1'])
    expect(tokenRequests).toBe(1)
  })

  it.each(['browser', 'expiry', 'shop', 'state', 'hmac', 'cancellation'] as const)(
    'rejects invalid installation %s before token acquisition',
    async (failure) => {
      const before = await rows()
      const { response, attemptId } = await installationCallback(failure)
      if (failure === 'cancellation') expect(response.status).toBe(499)
      else expect(response.headers.get('location')).toContain('/oauth/shopify/connect?error=')
      expect(tokenRequests).toBe(0)
      expect(await rows()).toEqual(before)
      const [attempt] = await db
        .select()
        .from(shopifyInstallationAttempt)
        .where(eq(shopifyInstallationAttempt.id, attemptId))
      expect(attempt.encryptedTokens).toBeNull()
    }
  )

  it('does not exchange a Shopify installation code again on callback replay', async () => {
    const { response, request } = await installationCallback()
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/oauth/shopify/connect')
    const replay = await shopifyCallback(request, undefined)
    expect(replay.headers.get('location')).toContain('/oauth/shopify/connect?error=')
    expect(tokenRequests).toBe(1)
  })

  it('claims the latest rotated chain once and preserves existing credential identity', async () => {
    const { completeShopifyInstall } = await import(
      '@/lib/credentials/application/complete-shopify-install'
    )
    const { attemptId, browserProof } = await installationCallback()
    await db
      .update(account)
      .set({ accessTokenExpiresAt: new Date(0) })
      .where(eq(account.accountId, shopId))
    expect(await resolve()).toMatchObject({ accessToken: 'fixture-access-2', refreshed: true })
    const args = {
      principal: createSessionPrincipal({ userId: userIds[0] }),
      input: { attemptId, browserProof, workspaceId },
    }
    const [first, second] = await Promise.all([
      completeShopifyInstall.execute(args),
      completeShopifyInstall.execute(args),
    ])
    expect(first.credentialId).toBe(credentialId)
    expect(second.credentialId).toBe(first.credentialId)
    const [attempt] = await db
      .select()
      .from(shopifyInstallationAttempt)
      .where(eq(shopifyInstallationAttempt.id, attemptId))
    expect(attempt.encryptedTokens).toBeNull()
    expect(attempt.claimedByUserId).toBe(userIds[0])
    expect((await rows()).find((row) => row.id === rowIds[0])?.accessToken).toBe('fixture-access-2')
    expect(tokenRequests).toBe(2)
  })

  it.runIf(Boolean(redisUrl))(
    'restores refresh after claiming an installation with a stale terminal error',
    async () => {
      const { completeShopifyInstall } = await import(
        '@/lib/credentials/application/complete-shopify-install'
      )
      const { attemptId, browserProof } = await installationCallback()
      const identity = refreshCoordination.getOAuthRefreshCoordinationIdentity(
        getShopifyRefreshScope(shopDomain)
      )
      await markCredentialDead(identity, 'invalid_grant')
      expect(await getRecentTerminalError(identity)).toBe('invalid_grant')
      await completeShopifyInstall.execute({
        principal: createSessionPrincipal({ userId: userIds[0] }),
        input: { attemptId, browserProof, workspaceId },
      })
      await db
        .update(account)
        .set({ accessTokenExpiresAt: new Date(0) })
        .where(eq(account.accountId, shopId))
      expect(await resolve()).toMatchObject({ accessToken: 'fixture-access-2', refreshed: true })
    }
  )

  it.each(['other browser', 'workspace outsider', 'expired attempt'] as const)(
    'rejects installation claims from %s without creating a credential',
    async (reason) => {
      const { completeShopifyInstall } = await import(
        '@/lib/credentials/application/complete-shopify-install'
      )
      const { attemptId, browserProof } = await installationCallback()
      if (reason === 'expired attempt')
        await db
          .update(shopifyInstallationAttempt)
          .set({ expiresAt: new Date(0) })
          .where(eq(shopifyInstallationAttempt.id, attemptId))
      const before = await db
        .select()
        .from(credential)
        .where(eq(credential.workspaceId, workspaceId))
      await expect(
        completeShopifyInstall.execute({
          principal: createSessionPrincipal({
            userId: reason === 'workspace outsider' ? userIds[1] : userIds[0],
          }),
          input: {
            attemptId,
            browserProof: reason === 'other browser' ? generateId() : browserProof,
            workspaceId,
          },
        })
      ).rejects.toMatchObject({ code: reason === 'workspace outsider' ? 'forbidden' : 'not_found' })
      expect(
        await db.select().from(credential).where(eq(credential.workspaceId, workspaceId))
      ).toEqual(before)
      const [attempt] = await db
        .select()
        .from(shopifyInstallationAttempt)
        .where(eq(shopifyInstallationAttempt.id, attemptId))
      expect(attempt.claimedByUserId).toBeNull()
    }
  )

  it('creates a usable credential and admin membership when an installation has no Sim account yet', async () => {
    const { completeShopifyInstall } = await import(
      '@/lib/credentials/application/complete-shopify-install'
    )
    await db.delete(credential).where(eq(credential.id, credentialId))
    await db.delete(account).where(eq(account.accountId, shopId))
    const { attemptId, browserProof } = await installationCallback()
    const result = await completeShopifyInstall.execute({
      principal: createSessionPrincipal({ userId: userIds[0] }),
      input: { attemptId, browserProof, workspaceId },
    })
    const [created] = await db
      .select()
      .from(credential)
      .where(eq(credential.id, result.credentialId))
    const [member] = await db
      .select()
      .from(credentialMember)
      .where(eq(credentialMember.credentialId, result.credentialId))
    const [storedAccount] = await db
      .select()
      .from(account)
      .where(eq(account.id, created.accountId ?? ''))
    expect(created.workspaceId).toBe(workspaceId)
    expect(member).toMatchObject({ userId: userIds[0], role: 'admin', status: 'active' })
    expect(storedAccount).toMatchObject({
      accountId: shopId,
      idToken: shopDomain,
      accessToken: 'fixture-access-1',
    })
  })

  it('recovers revoked connector schedules when a claim creates a credential for an existing account in another workspace', async () => {
    const { completeShopifyInstall } = await import(
      '@/lib/credentials/application/complete-shopify-install'
    )
    const destinationId = generateId()
    const knowledgeBaseId = generateId()
    const connectorId = generateId()
    await db.insert(workspace).values({
      id: destinationId,
      name: 'Recovery fixture',
      ownerId: userIds[0],
      billedAccountUserId: userIds[0],
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId: userIds[0],
      entityType: 'workspace',
      entityId: destinationId,
      permissionType: 'admin',
    })
    await db
      .insert(knowledgeBase)
      .values({ id: knowledgeBaseId, name: 'Recovery fixture', userId: userIds[0], workspaceId })
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId,
      connectorType: 'shopify',
      credentialId,
      sourceConfig: {},
      status: 'error',
      lastSyncError: CREDENTIAL_REVOKED_SYNC_ERROR,
      consecutiveFailures: 3,
      nextSyncAt: null,
    })
    try {
      const { attemptId, browserProof } = await installationCallback()
      const result = await completeShopifyInstall.execute({
        principal: createSessionPrincipal({ userId: userIds[0] }),
        input: { attemptId, browserProof, workspaceId: destinationId },
      })
      expect(result).toMatchObject({ created: true, accountId: rowIds[0] })
      const [recovered] = await db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, connectorId))
      expect(recovered).toMatchObject({
        status: 'active',
        lastSyncError: null,
        consecutiveFailures: 0,
      })
      expect(recovered.nextSyncAt?.getTime()).toBeGreaterThanOrEqual(testStartedAt)
    } finally {
      await db.delete(knowledgeBase).where(eq(knowledgeBase.id, knowledgeBaseId))
      await db.delete(permissions).where(eq(permissions.entityId, destinationId))
      await db.delete(workspace).where(eq(workspace.id, destinationId))
    }
  })

  it.each(['valid', 'hmac', 'duplicate', 'expiry', 'domain'] as const)(
    'handles a %s Shopify-originated launch before Sim login',
    async (condition) => {
      const { GET: launch } = await import('@/app/api/auth/shopify/install/route')
      const query = new URLSearchParams({
        shop: condition === 'domain' ? 'attacker.example' : shopDomain,
        timestamp: String(Math.floor(Date.now() / 1000) - (condition === 'expiry' ? 3600 : 0)),
      })
      if (condition === 'duplicate') query.append('shop', 'attacker.myshopify.com')
      const message = [...query.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => `${key}=${value}`)
        .join('&')
      query.set(
        'hmac',
        condition === 'hmac' ? '0'.repeat(64) : hmacSha256Hex(message, 'shopify-integration-secret')
      )
      const response = await launch(
        new NextRequest(`http://localhost:3000/api/auth/shopify/install?${query}`),
        undefined
      )
      const location = new URL(response.headers.get('location') ?? '')
      const attempts = await db
        .select()
        .from(shopifyInstallationAttempt)
        .where(eq(shopifyInstallationAttempt.shopDomain, shopDomain))
      if (condition === 'valid') {
        expect(location.origin).toBe(`https://${shopDomain}`)
        expect(location.pathname).toBe('/admin/oauth/authorize')
        expect(attempts).toHaveLength(1)
        expect(response.headers.get('set-cookie')).toMatch(
          /shopify_install_[a-f0-9-]{36}=[a-f0-9]{64};/
        )
      } else {
        expect(location.pathname).toBe('/oauth/shopify/connect')
        expect(location.searchParams.has('error')).toBe(true)
        expect(attempts).toHaveLength(0)
      }
      expect(tokenRequests).toBe(0)
    }
  )

  it('keeps the first anonymous handoff current when a second browser rotates the installation', async () => {
    const { completeShopifyInstall } = await import(
      '@/lib/credentials/application/complete-shopify-install'
    )
    await db.delete(credential).where(eq(credential.id, credentialId))
    await db.delete(account).where(eq(account.accountId, shopId))
    const first = await installationCallback()
    const second = await installationCallback()
    expect(second.attemptId).not.toBe(first.attemptId)
    const result = await completeShopifyInstall.execute({
      principal: createSessionPrincipal({ userId: userIds[0] }),
      input: { attemptId: first.attemptId, browserProof: first.browserProof, workspaceId },
    })
    const [created] = await db
      .select()
      .from(credential)
      .where(eq(credential.id, result.credentialId))
    const [stored] = await db
      .select()
      .from(account)
      .where(eq(account.id, created.accountId ?? ''))
    expect(stored.accessToken).toBe('fixture-access-2')
    expect(stored.refreshToken).toBe('fixture-refresh-2')
    expect(tokenRequests).toBe(2)
  })

  it('preserves caller cancellation before any token acquisition', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Connection cancelled', 'AbortError')
    controller.abort(reason)
    const before = await rows()

    await expect(connect(userIds[0], controller.signal)).rejects.toBe(reason)

    expect(tokenRequests).toBe(0)
    expect(await rows()).toEqual(before)
  })

  it.each(['caller', 'provider deadline'] as const)(
    'distinguishes %s cancellation while consuming a token response body',
    async (source) => {
      const controller = new AbortController()
      const reason = new DOMException(
        'fixture-private-abort-reason',
        source === 'caller' ? 'AbortError' : 'TimeoutError'
      )
      const timeout =
        source === 'provider deadline'
          ? vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal)
          : undefined
      const paused = { headersReceived: createDeferred<void>(), release: createDeferred<void>() }
      pausedTokenResponse = paused
      const before = await rows()
      const outcome = connect(
        userIds[0],
        source === 'caller' ? controller.signal : undefined
      ).catch((error: unknown) => error)
      try {
        await paused.headersReceived.promise
        controller.abort(reason)
        const error = await outcome
        if (source === 'caller') {
          expect(error).toBe(reason)
        } else {
          expect(error).toBeInstanceOf(ShopifyOAuthError)
          expect(error).toMatchObject({ callbackError: 'shopify_token_error' })
        }
        expect(await rows()).toEqual(before)
      } finally {
        paused.release.resolve()
        timeout?.mockRestore()
      }
    }
  )

  it('retains the replacement chain when clearing the previous terminal-error flag fails', async () => {
    const clearFlag = vi
      .spyOn(refreshCoordination, 'clearOAuthRefreshDeadFlag')
      .mockRejectedValueOnce(new Error('Cache configuration unavailable'))
    try {
      await connect()
      const saved = (await rows()).filter((row) => row.accountId === shopId)
      expect(saved.every((row) => row.refreshToken === currentRefresh)).toBe(true)
      expect(saved.every((row) => row.accessToken === 'fixture-access-1')).toBe(true)
    } finally {
      clearFlag.mockRestore()
    }
  })

  it('saves a reconnected chain for a verified normalized host while shop identity is unavailable', async () => {
    identityRejectionStatus = 429
    await db
      .update(account)
      .set({ idToken: shopDomain.toUpperCase() })
      .where(eq(account.accountId, shopId))

    await connect()

    const saved = (await rows()).filter((row) => row.accountId === shopId)
    expect(saved).toHaveLength(2)
    expect(saved.every((row) => row.refreshToken === currentRefresh)).toBe(true)
    expect(saved.every((row) => row.idToken === shopDomain)).toBe(true)
    await db
      .update(account)
      .set({ accessTokenExpiresAt: new Date(0) })
      .where(eq(account.accountId, shopId))
    expect(await resolve()).toEqual({ accessToken: 'fixture-access-2', refreshed: true })
  })

  it.each([
    { invalidId: '456', accountIds: [rowIds[1]], condition: 'conflicting' },
    { invalidId: 'invalid-shop-id', accountIds: rowIds.slice(0, 2), condition: 'nonnumeric' },
  ])(
    'rejects a $condition saved shop identity before retiring the current token chain',
    async ({ invalidId, accountIds }) => {
      await db.update(account).set({ accountId: invalidId }).where(inArray(account.id, accountIds))
      const before = await rows()

      await expect(connect()).rejects.toThrow(/Shopify.*identity/i)

      expect(tokenRequests).toBe(0)
      expect(await rows()).toEqual(before)
    }
  )

  it('requires a verified shop response when the host has never been connected', async () => {
    identityRejectionStatus = 429
    await db
      .update(account)
      .set({ idToken: 'different.myshopify.com' })
      .where(eq(account.accountId, shopId))
    const before = await rows()

    await expect(connect()).rejects.toThrow(/Shopify shop response/)

    expect(await rows()).toEqual(before)
  })

  it('completes a reconnect draft without breaking saved credential links or sibling users', async () => {
    const draftId = generateId()
    const previousCredentialUpdate = new Date(0)
    await db
      .update(credential)
      .set({ updatedAt: previousCredentialUpdate })
      .where(eq(credential.id, credentialId))
    await db.insert(pendingCredentialDraft).values({
      id: draftId,
      userId: userIds[0],
      workspaceId,
      providerId: 'shopify',
      displayName: 'Shopify reconnect fixture',
      credentialId,
      expiresAt: new Date(Date.now() + 60_000),
    })

    await completeShopifyOAuthConnection({
      code: 'fixture-authorization-code',
      shopDomain,
      userId: userIds[0],
      draftId,
    })

    const saved = await rows()
    for (const row of saved.filter((item) => item.accountId === shopId)) {
      expect(row.accessToken).toBe('fixture-access-1')
      expect(row.refreshToken).toBe('fixture-refresh-1')
      expect(row.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now())
      expect(row.refreshTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 86400000)
    }
    expect(saved.find((row) => row.accountId === '999')?.refreshToken).toBe('fixture-refresh-0')
    const [link] = await db.select().from(credential).where(eq(credential.id, credentialId))
    expect(link.accountId).toBe(rowIds[0])
    expect(link.updatedAt.getTime()).toBeGreaterThan(previousCredentialUpdate.getTime())
    expect(
      await db.select().from(pendingCredentialDraft).where(eq(pendingCredentialDraft.id, draftId))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(account)
        .where(and(eq(account.userId, userIds[0]), eq(account.accountId, shopId)))
    ).toHaveLength(1)
  })

  it('serializes simultaneous refreshes across sibling users and saves the only active pair', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => resolve(rowIds[i % 2])))
    expect(results.every((result) => result?.accessToken === 'fixture-access-1')).toBe(true)
    expect(tokenRequests).toBe(1)
    expect(
      (await rows())
        .filter((row) => row.accountId === shopId)
        .every((row) => row.refreshToken === currentRefresh)
    ).toBe(true)
  })

  it('rolls back every ownership-history page on failure and retries only Shopify associations', async () => {
    const owners = Array.from({ length: 102 }, (_, index) => ({
      workspaceId: generateId(),
      credentialId: generateId(),
      providerId: index === 0 ? 'google-email' : 'shopify',
    }))
    const lastCredentialId = [
      ...owners
        .filter((owner) => owner.providerId === 'shopify')
        .map((owner) => owner.credentialId),
      credentialId,
    ]
      .sort()
      .at(-1)
    await db.insert(workspace).values(
      owners.map((owner) => ({
        id: owner.workspaceId,
        name: 'History page fixture',
        ownerId: userIds[0],
        billedAccountUserId: userIds[0],
      }))
    )
    await db.insert(credential).values(
      owners.map((owner) => ({
        id: owner.credentialId,
        workspaceId: owner.workspaceId,
        type: 'oauth' as const,
        providerId: owner.providerId,
        accountId: rowIds[0],
        displayName: 'History page fixture',
        createdBy: userIds[0],
      }))
    )
    await db.execute(sql`CREATE FUNCTION shopify_fixture_reject_last_scope() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.credential_id = TG_ARGV[0] THEN RAISE EXCEPTION 'fixture later page unavailable'; END IF; RETURN NEW; END $$`)
    await db.execute(sql`CREATE TRIGGER shopify_fixture_reject_last_scope BEFORE INSERT ON shopify_installation_scope
      FOR EACH ROW EXECUTE FUNCTION shopify_fixture_reject_last_scope(${sql.raw(`'${lastCredentialId}'`)})`)
    try {
      try {
        await expect(rememberShopifyAccountScopes(rowIds[0])).rejects.toThrow()
        expect(
          await db
            .select()
            .from(shopifyInstallationScope)
            .where(eq(shopifyInstallationScope.shopDomain, shopDomain))
        ).toHaveLength(0)
      } finally {
        await db.execute(
          sql`DROP TRIGGER shopify_fixture_reject_last_scope ON shopify_installation_scope`
        )
        await db.execute(sql`DROP FUNCTION shopify_fixture_reject_last_scope()`)
      }
      await rememberShopifyAccountScopes(rowIds[0])
      expect(
        await db
          .select()
          .from(shopifyInstallationScope)
          .where(eq(shopifyInstallationScope.shopDomain, shopDomain))
      ).toHaveLength(102)
    } finally {
      await db.delete(workspace).where(
        inArray(
          workspace.id,
          owners.map((owner) => owner.workspaceId)
        )
      )
    }
  })

  it.each(['new', 'existing', 'reconnect', 'organization-new', 'organization-reconnect'] as const)(
    'preserves the %s credential and its draft when ownership-history persistence fails',
    async (mode) => {
      const organizationOwned = mode.startsWith('organization-')
      if (mode === 'new' || mode === 'organization-new')
        await db.delete(credential).where(eq(credential.id, credentialId))
      if (mode === 'organization-reconnect')
        await db
          .update(credential)
          .set({ workspaceId: null, organizationId })
          .where(eq(credential.id, credentialId))
      const ownerCondition = organizationOwned
        ? eq(credential.organizationId, organizationId)
        : eq(credential.workspaceId, workspaceId)
      const draftId = generateId()
      await db.insert(pendingCredentialDraft).values({
        id: draftId,
        userId: userIds[0],
        workspaceId: organizationOwned ? null : workspaceId,
        organizationId: organizationOwned ? organizationId : null,
        providerId: 'shopify',
        displayName: 'History fixture',
        credentialId: mode.endsWith('reconnect') ? credentialId : null,
        expiresAt: new Date(Date.now() + 60_000),
      })
      const before = await db.select().from(credential).where(ownerCondition)
      await db.execute(sql`CREATE FUNCTION shopify_fixture_reject_scope() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'fixture ownership history unavailable'; END $$`)
      await db.execute(sql`CREATE TRIGGER shopify_fixture_reject_scope BEFORE INSERT ON shopify_installation_scope
        FOR EACH ROW EXECUTE FUNCTION shopify_fixture_reject_scope()`)
      try {
        await expect(
          completeShopifyOAuthConnection({
            code: 'fixture-authorization-code',
            shopDomain,
            userId: userIds[0],
            draftId,
          })
        ).rejects.toThrow()
        expect(
          await db
            .select()
            .from(pendingCredentialDraft)
            .where(eq(pendingCredentialDraft.id, draftId))
        ).toHaveLength(1)
        await expect(
          processCredentialDraft({
            draftId,
            userId: userIds[0],
            providerId: 'shopify',
            accountId: rowIds[0],
          })
        ).rejects.toThrow()
        expect(await db.select().from(credential).where(ownerCondition)).toEqual(before)
        expect((await rows()).find((row) => row.id === rowIds[0])?.refreshToken).toBe(
          currentRefresh
        )
      } finally {
        await db.execute(
          sql`DROP TRIGGER shopify_fixture_reject_scope ON shopify_installation_scope`
        )
        await db.execute(sql`DROP FUNCTION shopify_fixture_reject_scope()`)
      }
      await processCredentialDraft({
        draftId,
        userId: userIds[0],
        providerId: 'shopify',
        accountId: rowIds[0],
      })
      const saved = await db.select().from(credential).where(ownerCondition)
      expect(saved).toHaveLength(1)
      expect(
        await db
          .select()
          .from(shopifyInstallationScope)
          .where(eq(shopifyInstallationScope.credentialId, saved[0].id))
      ).toHaveLength(1)
      expect(
        await db.select().from(pendingCredentialDraft).where(eq(pendingCredentialDraft.id, draftId))
      ).toHaveLength(0)
    }
  )

  it('serializes a new code acquisition with refresh and leaves the next workflow able to refresh', async () => {
    await Promise.all([resolve(), connect(userIds[1]), resolve(rowIds[1])])
    expect(overlappingRequests).toBe(0)
    const saved = (await rows()).filter((row) => row.accountId === shopId)
    expect(saved.every((row) => row.refreshToken === currentRefresh)).toBe(true)
    await db
      .update(account)
      .set({ accessTokenExpiresAt: new Date(0) })
      .where(eq(account.accountId, shopId))
    expect((await resolve())?.accessToken).toBe(`fixture-access-${sequence}`)
    expect(sequence).toBeGreaterThan(1)
  })

  it.each(['access_token', 'refresh_token', 'expires_in', 'refresh_token_expires_in'])(
    'rejects a successful response missing %s without saving a partial pair',
    async (field) => {
      malformedField = field
      const before = await rows()
      await expect(connect()).rejects.toThrow(/Shopify.*response/i)
      expect(await rows()).toEqual(before)
    }
  )

  it('keeps provider rejection details out of the callback error and preserves saved accounts', async () => {
    rejectionStatus = 401
    const before = await rows()
    await expect(connect()).rejects.toThrow(/Shopify.*401/)
    await expect(connect()).rejects.not.toThrow('fixture-private-token')
    expect(await rows()).toEqual(before)
  })

  it('continues resolving legacy non-expiring offline credentials without provider requests', async () => {
    await db
      .update(account)
      .set({ refreshToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null })
      .where(eq(account.id, rowIds[0]))
    expect(await resolve()).toEqual({ accessToken: 'fixture-access-0', refreshed: false })
    expect(tokenRequests).toBe(0)
  })
})
