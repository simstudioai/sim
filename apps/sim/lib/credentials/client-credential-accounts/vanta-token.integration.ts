import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { db } from '@sim/db'
import { clientCredentialToken } from '@sim/db/schema'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, like, or, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  invalidateVantaClientToken,
  resolveVantaClientToken,
} from '@/lib/credentials/client-credential-accounts/vanta-token'
import { fetchVantaWithAuth } from '@/lib/internal/vanta/client'

const READ = 'vanta-api.all:read'
const WRITE = `${READ} vanta-api.all:write`
const PREFIX = `vanta-fixture-${generateId()}`
const applications = new Map<string, { token: string; issued: number }>()
const ownedApplicationKeys = new Set<string>()
const originalFetch = globalThis.fetch
let provider: Server
let providerUrl: string
let tokenRequests = 0

function fields(suffix: string) {
  const clientId = `${PREFIX}-${suffix}`
  for (const apiDomain of ['https://api.vanta.com', 'https://api.vanta-gov.com']) {
    ownedApplicationKeys.add(
      `vanta:${createHash('sha256')
        .update(JSON.stringify([apiDomain, clientId]))
        .digest('hex')}`
    )
  }
  return { clientId, clientSecret: `secret-${clientId}`, scope: READ }
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Row ids and digests exactly as the build before the shared resolver derived them. */
function previousBuildKeys(input: { clientId: string; clientSecret: string }, scope: string) {
  const apiDomain = 'https://api.vanta.com'
  const applicationKey = `vanta:${sha256Json([apiDomain, input.clientId])}`
  const secretFingerprint = sha256Json([apiDomain, input.clientId, input.clientSecret])
  return {
    applicationKey,
    secretFingerprint,
    failureKey: `${applicationKey}:${sha256Json([secretFingerprint, scope])}`,
    accessTokenDigest: (accessToken: string) => sha256Json([apiDomain, accessToken]),
  }
}

/** Writes an application token row the way the previous build's mint did. */
async function storePreviousBuildToken(
  keys: ReturnType<typeof previousBuildKeys>,
  accessToken: string,
  scope: string,
  expiresInMs: number,
  client: Pick<typeof db, 'insert'> = db
) {
  const { encrypted } = await encryptSecret(
    JSON.stringify({ accessToken, secretFingerprint: keys.secretFingerprint, scope })
  )
  await client.insert(clientCredentialToken).values({
    id: keys.applicationKey,
    encryptedValue: encrypted,
    accessTokenDigest: keys.accessTokenDigest(accessToken),
    expiresAt: new Date(Date.now() + expiresInMs),
  })
}

async function readStoredRow(id: string) {
  const [row] = await db
    .select()
    .from(clientCredentialToken)
    .where(eq(clientCredentialToken.id, id))
    .limit(1)
  if (!row) throw new Error('Expected a stored row')
  return { ...row, decrypted: (await decryptSecret(row.encryptedValue)).decrypted }
}

/** Resolves once a session is blocked on the advisory lock for `key`; fails if `pending` settles first. */
async function lockWaiterAppears(key: string, pending: { settled: boolean }): Promise<void> {
  for (;;) {
    const waiting = await db.execute(sql`
      WITH k AS (SELECT hashtextextended(${key}, 0) AS h)
      SELECT 1 FROM pg_locks, k
      WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
        AND classid::bigint = ((k.h >> 32) & 4294967295)
        AND objid::bigint = (k.h & 4294967295)`)
    if (waiting.length > 0) return
    if (pending.settled) throw new Error('Resolution finished without waiting on the lock')
    await sleep(10)
  }
}

async function isActive(token: string): Promise<boolean> {
  return (
    await originalFetch(`${providerUrl}/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).ok
}

beforeAll(async () => {
  provider = createServer(async (request, response) => {
    if (request.url === '/verify') {
      const token = request.headers.authorization?.slice('Bearer '.length)
      response.writeHead([...applications.values()].some((app) => app.token === token) ? 200 : 401)
      response.end()
      return
    }
    let body = ''
    for await (const chunk of request) body += String(chunk)
    const parsed = JSON.parse(body) as Record<string, string>
    tokenRequests++
    if (
      request.url !== '/oauth/token' ||
      request.method !== 'POST' ||
      request.headers['content-type'] !== 'application/json' ||
      parsed.grant_type !== 'client_credentials' ||
      !parsed.scope
    ) {
      response.writeHead(400).end()
      return
    }
    if (
      parsed.client_secret !== `secret-${parsed.client_id}` &&
      parsed.client_secret !== `rotated-${parsed.client_id}`
    ) {
      response.writeHead(401, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({ error: 'invalid_client', error_description: parsed.client_secret })
      )
      return
    }
    await sleep(15)
    const identity = `${request.headers['x-provider-origin']}:${parsed.client_id}`
    const issued = (applications.get(identity)?.issued ?? 0) + 1
    const token = `${identity}:token-${issued}`
    applications.set(identity, { token, issued })
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ access_token: token, expires_in: 3600, token_type: 'Bearer' }))
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Provider fixture did not bind')
  providerUrl = `http://127.0.0.1:${address.port}`
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (!['https://api.vanta.com', 'https://api.vanta-gov.com'].includes(target.origin)) {
      throw new Error('Unexpected provider target')
    }
    const headers = new Headers(init?.headers)
    headers.set('x-provider-origin', target.origin)
    return originalFetch(`${providerUrl}${target.pathname}`, { ...init, headers })
  })
})

afterAll(async () => {
  vi.unstubAllGlobals()
  provider.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    provider.close((error) => (error ? reject(error) : resolve()))
  )
  if (ownedApplicationKeys.size) {
    await db
      .delete(clientCredentialToken)
      .where(
        or(...[...ownedApplicationKeys].map((key) => like(clientCredentialToken.id, `${key}%`)))
      )
  }
})

describe('Vanta application token lifecycle against shared storage', () => {
  it('shares one active token across simultaneous resolutions for an application', async () => {
    const count = tokenRequests
    const results = await Promise.all(
      Array.from({ length: 12 }, () => resolveVantaClientToken(fields('concurrent')))
    )
    expect(new Set(results.map((result) => result.accessToken)).size).toBe(1)
    expect(tokenRequests).toBe(count + 1)
    expect(await isActive(results[0].accessToken)).toBe(true)
    expect((await resolveVantaClientToken(fields('concurrent'))).accessToken).toBe(
      results[0].accessToken
    )
  })

  it('never gives a cached token to a caller with the wrong secret', async () => {
    const input = fields('wrong-secret')
    const first = await resolveVantaClientToken(input)
    const invalid = { ...input, clientSecret: 'private-invalid-secret' }
    await expect(resolveVantaClientToken(invalid)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    const count = tokenRequests
    await expect(resolveVantaClientToken(invalid)).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    expect(tokenRequests).toBe(count)
    expect(await isActive(first.accessToken)).toBe(true)
  })

  it('does not widen a saved connection or revoke another connection for different permissions', async () => {
    const input = fields('different-scope')
    const first = await resolveVantaClientToken(input)
    await expect(resolveVantaClientToken({ ...input, scope: WRITE })).rejects.toThrow(
      /separate Vanta application/i
    )
    expect(await isActive(first.accessToken)).toBe(true)
  })

  it.each(['expiry', '401'] as const)(
    'retains application permissions after token %s',
    async (reason) => {
      const input = fields(`durable-scope-${reason}`)
      const first = await resolveVantaClientToken(input)
      if (reason === 'expiry') {
        const tokenDigest = createHash('sha256')
          .update(JSON.stringify([first.apiDomain, first.accessToken]))
          .digest('hex')
        await db
          .update(clientCredentialToken)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(clientCredentialToken.accessTokenDigest, tokenDigest))
      } else {
        await invalidateVantaClientToken(first.accessToken, first.apiDomain)
      }
      const count = tokenRequests
      await expect(resolveVantaClientToken({ ...input, scope: WRITE })).rejects.toMatchObject({
        code: 'permission_conflict',
      })
      expect(tokenRequests).toBe(count)
      const renewed = await resolveVantaClientToken(input)
      expect(await isActive(renewed.accessToken)).toBe(true)
    }
  )

  it('does not replace application permissions when a different client secret is supplied', async () => {
    const input = fields('durable-scope-secret-rotation')
    const first = await resolveVantaClientToken(input)
    const count = tokenRequests
    await expect(
      resolveVantaClientToken({
        ...input,
        clientSecret: `rotated-${input.clientId}`,
        scope: WRITE,
      })
    ).rejects.toMatchObject({ code: 'permission_conflict' })
    expect(tokenRequests).toBe(count)
    expect(await isActive(first.accessToken)).toBe(true)
  })

  it('changes a revoked token only once when several requests reject the same token', async () => {
    const input = fields('rejected-token')
    const first = await resolveVantaClientToken(input)
    await Promise.all(
      Array.from({ length: 8 }, () =>
        invalidateVantaClientToken(first.accessToken, first.apiDomain)
      )
    )
    const refreshed = await Promise.all(
      Array.from({ length: 8 }, () => resolveVantaClientToken(input))
    )
    expect(refreshed[0].accessToken).not.toBe(first.accessToken)
    expect(refreshed.every((result) => result.accessToken === refreshed[0].accessToken)).toBe(true)
    expect(await isActive(refreshed[0].accessToken)).toBe(true)
  })

  it('binds tokens to their Vanta deployment and replaces tokens after a verified secret rotation', async () => {
    const input = fields('host-and-rotation')
    const standard = await resolveVantaClientToken(input)
    const gov = await resolveVantaClientToken({ ...input, dataCenter: 'gov' })
    expect(gov.apiDomain).toBe('https://api.vanta-gov.com')
    expect(gov.accessToken).not.toBe(standard.accessToken)
    const rotated = await resolveVantaClientToken({
      ...input,
      clientSecret: `rotated-${input.clientId}`,
    })
    expect(rotated.accessToken).not.toBe(standard.accessToken)
    expect(await isActive(rotated.accessToken)).toBe(true)
    expect(await isActive(gov.accessToken)).toBe(true)
  })

  it('stores neither provider secrets nor access tokens in plaintext', async () => {
    const input = fields('encrypted')
    const result = await resolveVantaClientToken(input)
    const rows = await db.select().from(clientCredentialToken)
    expect(rows.length).toBeGreaterThan(0)
    const stored = JSON.stringify(rows)
    expect(stored).not.toContain(input.clientId)
    expect(stored).not.toContain(input.clientSecret)
    expect(stored).not.toContain(result.accessToken)
  })

  it('recovers on the next authorized resolution after a saved token is rejected', async () => {
    const input = fields('saved-rejected')
    const first = await resolveVantaClientToken(input)
    const response = await fetchVantaWithAuth(
      first,
      async () => new Response(null, { status: 401 })
    )
    expect(response.status).toBe(401)
    const next = await resolveVantaClientToken(input)
    expect(next.accessToken).not.toBe(first.accessToken)
    expect(await isActive(next.accessToken)).toBe(true)
  })

  it('does not invalidate a newer token or another deployment after a stale token rejection', async () => {
    const input = fields('saved-stale-rejected')
    const first = await resolveVantaClientToken(input)
    await invalidateVantaClientToken(first.accessToken, 'https://api.vanta-gov.com')
    expect((await resolveVantaClientToken(input)).accessToken).toBe(first.accessToken)
    await invalidateVantaClientToken(first.accessToken, first.apiDomain)
    const next = await resolveVantaClientToken(input)
    await invalidateVantaClientToken(first.accessToken, first.apiDomain)
    expect((await resolveVantaClientToken(input)).accessToken).toBe(next.accessToken)
    expect(await isActive(next.accessToken)).toBe(true)
  })

  it('fails closed when coordination storage fails', async () => {
    const count = tokenRequests
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('database unavailable'))
    await expect(resolveVantaClientToken(fields('storage-failure'))).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
    expect(tokenRequests).toBe(count)
  })
})

describe('Vanta token rows shared with the previous build during a rolling deploy', () => {
  it('serves a fresh token the previous build stored down to the 30-second margin without calling Vanta', async () => {
    const input = fields('legacy-fresh')
    await storePreviousBuildToken(
      previousBuildKeys(input, READ),
      'legacy-fresh-token',
      READ,
      60_000
    )
    const count = tokenRequests

    await expect(resolveVantaClientToken(input)).resolves.toMatchObject({
      accessToken: 'legacy-fresh-token',
      apiDomain: 'https://api.vanta.com',
    })
    expect(tokenRequests).toBe(count)
  })

  it('honors a refusal the previous build remembered without calling Vanta', async () => {
    const input = fields('legacy-failure')
    const { encrypted } = await encryptSecret(
      JSON.stringify({ code: 'invalid_credentials', status: 401 })
    )
    await db.insert(clientCredentialToken).values({
      id: previousBuildKeys(input, READ).failureKey,
      encryptedValue: encrypted,
      expiresAt: new Date(Date.now() + 20_000),
    })
    const count = tokenRequests

    await expect(resolveVantaClientToken(input)).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 401,
    })
    expect(tokenRequests).toBe(count)
  })

  it('refuses other permissions for an expired application the previous build pinned', async () => {
    const input = fields('legacy-expired-scope')
    await storePreviousBuildToken(previousBuildKeys(input, READ), 'legacy-expired', READ, -1000)
    const count = tokenRequests

    await expect(resolveVantaClientToken({ ...input, scope: WRITE })).rejects.toMatchObject({
      code: 'permission_conflict',
    })
    expect(tokenRequests).toBe(count)
  })

  it('stores a minted token where and how the previous build reads it', async () => {
    const input = fields('legacy-readable-mint')
    const keys = previousBuildKeys(input, READ)

    const { accessToken } = await resolveVantaClientToken(input)

    const row = await readStoredRow(keys.applicationKey)
    expect(row.decrypted).toBe(
      JSON.stringify({ accessToken, secretFingerprint: keys.secretFingerprint, scope: READ })
    )
    expect(row.accessTokenDigest).toBe(keys.accessTokenDigest(accessToken))
  })

  it('stores a refusal where and how the previous build reads it', async () => {
    const input = fields('legacy-readable-failure')
    const keys = previousBuildKeys({ ...input, clientSecret: 'revoked-secret' }, READ)

    await expect(
      resolveVantaClientToken({ ...input, clientSecret: 'revoked-secret' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })

    const row = await readStoredRow(keys.failureKey)
    expect(row.decrypted).toBe(JSON.stringify({ code: 'invalid_credentials', status: 401 }))
    expect(row.accessTokenDigest).toBeNull()
  })

  it('expires a token the previous build stored when Vanta rejects it', async () => {
    const input = fields('legacy-invalidated')
    const keys = previousBuildKeys(input, READ)
    await storePreviousBuildToken(keys, 'legacy-rejected-token', READ, 3_600_000)

    await invalidateVantaClientToken('legacy-rejected-token', 'https://api.vanta.com')

    expect((await readStoredRow(keys.applicationKey)).expiresAt.getTime()).toBe(0)
  })

  it('waits on the application lock the previous build holds and serves the token it minted', async () => {
    const input = fields('legacy-lock')
    const keys = previousBuildKeys(input, READ)
    const locked = createDeferred<void>()
    const commit = createDeferred<void>()
    const previousBuild = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${keys.applicationKey}, 0))`
      )
      locked.resolve()
      await commit.promise
      await storePreviousBuildToken(keys, 'legacy-locked-token', READ, 3_600_000, tx)
    })
    await locked.promise
    const count = tokenRequests
    const pending = { settled: false }
    const resolution = resolveVantaClientToken(input).finally(() => {
      pending.settled = true
    })

    try {
      await lockWaiterAppears(keys.applicationKey, pending)
    } finally {
      commit.resolve()
      await previousBuild
    }

    await expect(resolution).resolves.toMatchObject({ accessToken: 'legacy-locked-token' })
    expect(tokenRequests).toBe(count)
  })
})
