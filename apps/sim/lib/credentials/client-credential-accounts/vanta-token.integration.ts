import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { db } from '@sim/db'
import { clientCredentialToken } from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, like, or } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
    const results = await Promise.all(
      Array.from({ length: 12 }, () => resolveVantaClientToken(fields('concurrent')))
    )
    expect(new Set(results.map((result) => result.accessToken)).size).toBe(1)
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
