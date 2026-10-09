import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname } from 'node:path'
import { db } from '@sim/db'
import { account, credential, user, workspace } from '@sim/db/schema'
import { createDeferred, type Deferred } from '@sim/testing/helpers/deferred'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshTokenIfNeeded } from '@/lib/oauth/credential-service'
import * as refreshCoordination from '@/lib/oauth/refresh-coordination'
import { completeShopifyOAuthConnection } from '@/lib/oauth/shopify'
import { ShopifyOAuthError } from '@/lib/oauth/shopify-installation'

vi.hoisted(() => {
  process.env.SHOPIFY_CLIENT_ID = 'shopify-integration-client'
  process.env.SHOPIFY_CLIENT_SECRET = 'shopify-integration-secret'
})

const originalFetch = globalThis.fetch
const userIds = [generateId(), generateId()]
const workspaceId = generateId()
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
  sequence = 0
  currentRefresh = 'fixture-refresh-0'
  tokenRequests = 0
  overlappingRequests = 0
  malformedField = undefined
  rejectionStatus = undefined
  identityRejectionStatus = undefined
  pausedTokenResponse = undefined
  await db.delete(credential).where(eq(credential.id, credentialId))
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
  await db.delete(workspace).where(eq(workspace.id, workspaceId))
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

describe('Shopify offline installation tokens against PostgreSQL and HTTP', () => {
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

  it('reconnects the numeric shop account without breaking saved credential links or sibling users', async () => {
    await connect()
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
