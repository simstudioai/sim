import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { clientCredentialToken } from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, like, or } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { decryptSecret } from '@/lib/core/security/encryption'
import {
  type CoordinatedClientTokenInput,
  invalidateCoordinatedClientToken,
  resolveCoordinatedClientToken,
} from '@/lib/credentials/coordinated-client-token'
import { verifyAndBuildServiceAccountSecret } from '@/lib/credentials/service-account-secret'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const NAMESPACE = `fixture${generateId().replaceAll('-', '')}`
const ownedKeyPrefixes = new Set<string>([`${NAMESPACE}:`])

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function applicationKey(namespace: string, application: readonly string[]): string {
  return `${namespace}:${sha256Json(application)}`
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

/** A provider that issues numbered tokens per application and counts every exchange. */
function provider(application: string) {
  let issued = 0
  const exchange = vi.fn(async () => {
    await sleep(10)
    issued++
    return {
      accessToken: `${application}:token-${issued}`,
      expiresAt: new Date(Date.now() + 3_600_000),
    }
  })
  return { exchange }
}

function input(
  application: string,
  exchange: CoordinatedClientTokenInput['exchange'],
  clientSecret = 'secret-1'
): CoordinatedClientTokenInput {
  return { namespace: NAMESPACE, application: [application], clientSecret, step: 'mint', exchange }
}

function rejecting() {
  return vi.fn(async () => {
    throw new TokenServiceAccountValidationError('invalid_credentials', 401, { step: 'mint' })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await db
    .delete(clientCredentialToken)
    .where(
      or(...[...ownedKeyPrefixes].map((prefix) => like(clientCredentialToken.id, `${prefix}%`)))
    )
})

describe('coordinated client-credentials token against shared storage', () => {
  it('exchanges once for simultaneous resolutions of one application', async () => {
    const { exchange } = provider('concurrent')

    const results = await Promise.all(
      Array.from({ length: 10 }, () => resolveCoordinatedClientToken(input('concurrent', exchange)))
    )

    expect(exchange).toHaveBeenCalledOnce()
    expect(new Set(results.map((result) => result.accessToken))).toEqual(
      new Set(['concurrent:token-1'])
    )
  })

  it('mints again for a rotated secret instead of serving the old secret its token', async () => {
    const { exchange } = provider('rotated')
    await resolveCoordinatedClientToken(input('rotated', exchange))

    const rotated = await resolveCoordinatedClientToken(input('rotated', exchange, 'secret-2'))

    expect(rotated.accessToken).toBe('rotated:token-2')
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('keeps serving the good token after a wrong secret is rejected', async () => {
    const { exchange } = provider('wrong-secret')
    const good = await resolveCoordinatedClientToken(input('wrong-secret', exchange))

    await expect(
      resolveCoordinatedClientToken(input('wrong-secret', rejecting(), 'wrong'))
    ).rejects.toMatchObject({ code: 'invalid_credentials' })

    await expect(resolveCoordinatedClientToken(input('wrong-secret', exchange))).resolves.toEqual(
      expect.objectContaining({ accessToken: good.accessToken })
    )
    expect(exchange).toHaveBeenCalledOnce()
  })

  it('replays a rejected exchange until the failure memo expires', async () => {
    const exchange = rejecting()
    await expect(
      resolveCoordinatedClientToken(input('memo', exchange, 'revoked'))
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(
      resolveCoordinatedClientToken(input('memo', exchange, 'revoked'))
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(exchange).toHaveBeenCalledOnce()

    await db
      .update(clientCredentialToken)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(like(clientCredentialToken.id, `${applicationKey(NAMESPACE, ['memo'])}:%`))

    await expect(
      resolveCoordinatedClientToken(input('memo', exchange, 'revoked'))
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('reports an exchange that fails outside validation as provider_unavailable and stores nothing', async () => {
    const exchange = vi.fn(async () => {
      throw new Error('socket hang up')
    })

    await expect(resolveCoordinatedClientToken(input('network', exchange))).rejects.toMatchObject({
      code: 'provider_unavailable',
    })

    const rows = await db
      .select({ id: clientCredentialToken.id })
      .from(clientCredentialToken)
      .where(like(clientCredentialToken.id, `${applicationKey(NAMESPACE, ['network'])}%`))
    expect(rows).toEqual([])
  })

  it('mints a replacement once a provider-rejected token is invalidated', async () => {
    const { exchange } = provider('revoked')
    const first = await resolveCoordinatedClientToken(input('revoked', exchange))

    await Promise.all(
      Array.from({ length: 4 }, () => invalidateCoordinatedClientToken(first.accessToken))
    )
    const renewed = await Promise.all(
      Array.from({ length: 4 }, () => resolveCoordinatedClientToken(input('revoked', exchange)))
    )

    expect(new Set(renewed.map((result) => result.accessToken))).toEqual(
      new Set(['revoked:token-2'])
    )
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('leaves a replacement in service when a stale token is invalidated late', async () => {
    const { exchange } = provider('late-invalidation')
    const first = await resolveCoordinatedClientToken(input('late-invalidation', exchange))
    await invalidateCoordinatedClientToken(first.accessToken)
    const replacement = await resolveCoordinatedClientToken(input('late-invalidation', exchange))

    await invalidateCoordinatedClientToken(first.accessToken)

    await expect(
      resolveCoordinatedClientToken(input('late-invalidation', exchange))
    ).resolves.toMatchObject({ accessToken: replacement.accessToken })
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('keeps a token minted within the minimum age when a tool call reports it rejected', async () => {
    const { exchange } = provider('fresh-rejection')
    const first = await resolveCoordinatedClientToken(input('fresh-rejection', exchange))

    for (let attempt = 0; attempt < 3; attempt++) {
      await invalidateCoordinatedClientToken(first.accessToken, { minimumAgeMs: 60_000 })
      await expect(
        resolveCoordinatedClientToken(input('fresh-rejection', exchange))
      ).resolves.toMatchObject({ accessToken: first.accessToken })
    }
    expect(exchange).toHaveBeenCalledOnce()

    await db
      .update(clientCredentialToken)
      .set({ updatedAt: new Date(Date.now() - 120_000) })
      .where(eq(clientCredentialToken.id, applicationKey(NAMESPACE, ['fresh-rejection'])))
    await invalidateCoordinatedClientToken(first.accessToken, { minimumAgeMs: 60_000 })

    await expect(
      resolveCoordinatedClientToken(input('fresh-rejection', exchange))
    ).resolves.toMatchObject({ accessToken: 'fresh-rejection:token-2' })
  })

  it('sweeps expired failure memos', async () => {
    await expect(
      resolveCoordinatedClientToken(input('swept', rejecting(), 'revoked'))
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    const failurePrefix = `${applicationKey(NAMESPACE, ['swept'])}:`
    await db
      .update(clientCredentialToken)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(like(clientCredentialToken.id, `${failurePrefix}%`))

    await resolveCoordinatedClientToken(input('sweeper', provider('sweeper').exchange))

    const rows = await db
      .select({ id: clientCredentialToken.id })
      .from(clientCredentialToken)
      .where(like(clientCredentialToken.id, `${failurePrefix}%`))
    expect(rows).toEqual([])
  })
})

describe('default token rows shared with the previous build during a rolling deploy', () => {
  it('stores tokens and refusals under the ids, digest, and payloads the previous build used', async () => {
    const application = ['legacy.myshopify.com', 'legacy-client']
    const appKey = applicationKey(NAMESPACE, application)
    const fingerprint = (secret: string) => sha256Json([...application, secret])
    const shopify = (clientSecret: string, exchange: CoordinatedClientTokenInput['exchange']) => ({
      namespace: NAMESPACE,
      application,
      clientSecret,
      step: 'mint',
      exchange,
    })

    const { accessToken } = await resolveCoordinatedClientToken(
      shopify('secret-1', provider('legacy-default').exchange)
    )
    const minted = await readStoredRow(appKey)
    expect(minted.decrypted).toBe(
      JSON.stringify({ accessToken, secretFingerprint: fingerprint('secret-1') })
    )
    expect(minted.accessTokenDigest).toBe(sha256Json(['coordinated_client_token', accessToken]))

    await invalidateCoordinatedClientToken(accessToken)
    expect((await readStoredRow(appKey)).expiresAt.getTime()).toBe(0)

    await expect(
      resolveCoordinatedClientToken(shopify('revoked', rejecting()))
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    const refusal = await readStoredRow(`${appKey}:${sha256Json(fingerprint('revoked'))}`)
    expect(refusal.decrypted).toBe(JSON.stringify({ code: 'invalid_credentials', status: 401 }))
  })
})

describe('saving a Shopify client-credentials credential', () => {
  const shop = `fixture-${generateId().slice(0, 8)}.myshopify.com`
  const clientId = `client-${generateId()}`
  ownedKeyPrefixes.add(applicationKey('shopify', [shop, clientId]))

  it('recovers when the shared token was revoked before it expired', async () => {
    const active = new Set<string>()
    let issued = 0
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const target = new URL(typeof url === 'string' || url instanceof URL ? url : url.url)
      if (target.host !== shop) throw new Error('Unexpected provider target')
      if (target.pathname === '/admin/oauth/access_token') {
        issued++
        const token = `shpca_${issued}`
        active.add(token)
        return Response.json({ access_token: token, scope: 'read_products', expires_in: 86399 })
      }
      const token = new Headers(init?.headers).get('x-shopify-access-token') ?? ''
      if (!active.has(token)) {
        return Response.json({ errors: '[API] Invalid API key or access token' }, { status: 401 })
      }
      return Response.json({ data: { shop: { name: 'Fixture', myshopifyDomain: shop } } })
    })
    const fields = {
      authMethod: 'client_credentials',
      clientId,
      clientSecret: 'shopify-secret',
      domain: shop,
    }
    await verifyAndBuildServiceAccountSecret('shopify-service-account', fields)
    active.clear()

    await expect(
      verifyAndBuildServiceAccountSecret('shopify-service-account', fields)
    ).resolves.toMatchObject({ providerId: 'shopify-service-account' })
    expect(issued).toBe(2)
  })
})
