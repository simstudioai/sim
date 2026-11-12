import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { clientCredentialToken } from '@sim/db/schema'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { eq, like, or } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  type CoordinatedClientTokenInput,
  invalidateCoordinatedClientToken,
  resolveCoordinatedClientToken,
} from '@/lib/credentials/coordinated-client-token'
import { verifyAndBuildServiceAccountSecret } from '@/lib/credentials/service-account-secret'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'

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

function failing(status: number, retryAfterMs?: number) {
  return vi.fn(async (): Promise<{ accessToken: string; expiresAt: Date }> => {
    throw new TokenServiceAccountValidationError(
      'provider_unavailable',
      status,
      { step: 'mint' },
      {
        retryAfterMs,
      }
    )
  })
}

/** An exchange that issues one token valid for `lifetimeMs`, then fails with `then`. */
function issuingOnce(
  application: string,
  lifetimeMs: number,
  then: CoordinatedClientTokenInput['exchange']
) {
  return vi
    .fn<CoordinatedClientTokenInput['exchange']>()
    .mockResolvedValueOnce({
      accessToken: `${application}:token-1`,
      expiresAt: new Date(Date.now() + lifetimeMs),
    })
    .mockImplementation(then)
}

async function failureRowOf(application: string) {
  const rows = await db
    .select()
    .from(clientCredentialToken)
    .where(like(clientCredentialToken.id, `${applicationKey(NAMESPACE, [application])}:%`))
  if (rows.length !== 1) throw new Error(`Expected one failure row, found ${rows.length}`)
  return readStoredRow(rows[0].id)
}

async function expireFailureRowsOf(application: string) {
  await db
    .update(clientCredentialToken)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(like(clientCredentialToken.id, `${applicationKey(NAMESPACE, [application])}:%`))
}

/** The previous build's failure decoders, which must keep accepting every failure this build stores. */
const previousBuildDecodesFailure = {
  coordinated: (value: unknown) =>
    isRecordLike(value) &&
    typeof value.code === 'string' &&
    [
      'invalid_credentials',
      'grant_not_permitted',
      'site_not_found',
      'provider_unavailable',
    ].includes(value.code) &&
    typeof value.status === 'number',
  vantaBeforeCoordination: (value: unknown) =>
    isRecordLike(value) &&
    (value.code === 'invalid_credentials' || value.code === 'provider_unavailable') &&
    typeof value.status === 'number',
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
    const replayed = await resolveCoordinatedClientToken(input('memo', exchange, 'revoked')).catch(
      (error: unknown) => error
    )
    expect(replayed).toMatchObject({ code: 'invalid_credentials', replayForMs: expect.any(Number) })
    expect(replayed).not.toHaveProperty('retryAfterMs', expect.anything())
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

  it('sweeps failure memos once they can no longer extend a backoff', async () => {
    for (const application of ['swept', 'retained']) {
      await expect(
        resolveCoordinatedClientToken(input(application, rejecting(), 'revoked'))
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
    }
    const failurePrefix = (application: string) => `${applicationKey(NAMESPACE, [application])}:`
    const expire = (application: string, agoMs: number) =>
      db
        .update(clientCredentialToken)
        .set({ expiresAt: new Date(Date.now() - agoMs) })
        .where(like(clientCredentialToken.id, `${failurePrefix(application)}%`))
    await expire('swept', 6 * 60_000)
    await expire('retained', 60_000)

    await resolveCoordinatedClientToken(input('sweeper', provider('sweeper').exchange))

    const remaining = async (application: string) =>
      db
        .select({ id: clientCredentialToken.id })
        .from(clientCredentialToken)
        .where(like(clientCredentialToken.id, `${failurePrefix(application)}%`))
    expect(await remaining('swept')).toEqual([])
    expect(await remaining('retained')).toHaveLength(1)
  })
})

describe('coordinated token resolution while the provider fails', () => {
  it('serves the stored token while it is still valid when its early refresh is throttled', async () => {
    const exchange = issuingOnce('throttled-refresh', 4 * 60_000, failing(429))
    await resolveCoordinatedClientToken(input('throttled-refresh', exchange))

    for (let call = 0; call < 3; call++) {
      await expect(
        resolveCoordinatedClientToken(input('throttled-refresh', exchange))
      ).resolves.toMatchObject({ accessToken: 'throttled-refresh:token-1' })
    }
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('reports the failed refresh once the stored token has run out', async () => {
    const exchange = issuingOnce('expired-refresh', 20_000, failing(429))
    await resolveCoordinatedClientToken(input('expired-refresh', exchange))

    await expect(
      resolveCoordinatedClientToken(input('expired-refresh', exchange))
    ).rejects.toMatchObject({ code: 'provider_unavailable', status: 429 })
  })

  it('stops serving the stored token once the provider refuses the credentials', async () => {
    const exchange = issuingOnce('refused-refresh', 4 * 60_000, rejecting())
    await resolveCoordinatedClientToken(input('refused-refresh', exchange))

    await expect(
      resolveCoordinatedClientToken(input('refused-refresh', exchange))
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(
      resolveCoordinatedClientToken(input('refused-refresh', exchange))
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('never serves a refused token again once the refusal memo ends and an outage follows', async () => {
    const exchange = issuingOnce('refused-then-outage', 4 * 60_000, rejecting())
    await resolveCoordinatedClientToken(input('refused-then-outage', exchange))
    await expect(
      resolveCoordinatedClientToken(input('refused-then-outage', exchange))
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expireFailureRowsOf('refused-then-outage')
    exchange.mockImplementation(failing(503))

    await expect(
      resolveCoordinatedClientToken(input('refused-then-outage', exchange))
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })

  it('keeps the token another secret minted when a different secret is refused', async () => {
    const exchange = issuingOnce('refused-other-secret', 4 * 60_000, failing(503))
    await resolveCoordinatedClientToken(input('refused-other-secret', exchange))
    await expect(
      resolveCoordinatedClientToken(input('refused-other-secret', rejecting(), 'revoked'))
    ).rejects.toMatchObject({ code: 'invalid_credentials' })

    await expect(
      resolveCoordinatedClientToken(input('refused-other-secret', exchange))
    ).resolves.toMatchObject({ accessToken: 'refused-other-secret:token-1' })
  })

  it('keeps refusing for every worker a refusal whose code the shared row cannot store', async () => {
    const exchange = issuingOnce('consent-refresh', 4 * 60_000, async () => {
      throw new TokenServiceAccountValidationError('consent_required', 400, { step: 'mint' })
    })
    await resolveCoordinatedClientToken(input('consent-refresh', exchange))

    for (let call = 0; call < 2; call++) {
      await expect(
        resolveCoordinatedClientToken(input('consent-refresh', exchange))
      ).rejects.toBeInstanceOf(TokenServiceAccountValidationError)
    }
    expect(exchange).toHaveBeenCalledTimes(2)
    const payload: unknown = JSON.parse((await failureRowOf('consent-refresh')).decrypted)
    expect(previousBuildDecodesFailure.coordinated(payload)).toBe(true)
  })

  it('never serves a still-valid token to a different secret whose refresh fails', async () => {
    const exchange = issuingOnce('rotated-refresh', 4 * 60_000, failing(429))
    await resolveCoordinatedClientToken(input('rotated-refresh', exchange))

    await expect(
      resolveCoordinatedClientToken(input('rotated-refresh', exchange, 'secret-2'))
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })

  it('retries a quick outage once under the application lock, for every waiting resolution', async () => {
    const { exchange: issue } = provider('retried')
    const exchange = vi
      .fn<CoordinatedClientTokenInput['exchange']>()
      .mockRejectedValueOnce(
        new TokenServiceAccountValidationError('provider_unavailable', 503, { step: 'mint' })
      )
      .mockImplementation(issue)

    const results = await Promise.all(
      Array.from({ length: 5 }, () => resolveCoordinatedClientToken(input('retried', exchange)))
    )

    expect(new Set(results.map((result) => result.accessToken))).toEqual(
      new Set(['retried:token-1'])
    )
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['as long as the provider asks', 'throttled-90s', 90_000, 90_000],
    ['for at most five minutes', 'throttled-1h', 3_600_000, 300_000],
  ])(
    "shares a throttled exchange's Retry-After with every worker %s",
    async (_case, application, retryAfterMs, replayMs) => {
      const exchange = failing(429, retryAfterMs)
      const before = Date.now()

      await expect(
        resolveCoordinatedClientToken(input(application, exchange))
      ).rejects.toMatchObject({ code: 'provider_unavailable', status: 429 })
      await expect(
        resolveCoordinatedClientToken(input(application, exchange))
      ).rejects.toMatchObject({ status: 429, replayForMs: expect.any(Number) })

      expect(exchange).toHaveBeenCalledOnce()
      const stored = await failureRowOf(application)
      expect(stored.expiresAt.getTime() - before).toBeGreaterThanOrEqual(replayMs)
      expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(replayMs)
    }
  )

  it('replays a throttled exchange that names no Retry-After for at least a minute', async () => {
    const exchange = failing(429)
    const before = Date.now()

    await expect(
      resolveCoordinatedClientToken(input('throttled-bare', exchange))
    ).rejects.toMatchObject({ code: 'provider_unavailable', status: 429 })

    expect(exchange).toHaveBeenCalledOnce()
    expect(
      (await failureRowOf('throttled-bare')).expiresAt.getTime() - before
    ).toBeGreaterThanOrEqual(60_000)
  })

  it('backs off a throttled answer after an outage from a minute, not by the outage streak', async () => {
    const exchange = vi.fn<CoordinatedClientTokenInput['exchange']>()
    for (const status of [502, 502]) {
      exchange.mockImplementation(failing(status))
      await expect(
        resolveCoordinatedClientToken(input('outage-then-throttled', exchange))
      ).rejects.toThrow()
      await expireFailureRowsOf('outage-then-throttled')
    }
    exchange.mockImplementation(failing(429))
    const before = Date.now()

    await expect(
      resolveCoordinatedClientToken(input('outage-then-throttled', exchange))
    ).rejects.toMatchObject({ status: 429 })

    const replayMs = (await failureRowOf('outage-then-throttled')).expiresAt.getTime() - before
    expect(replayMs).toBeGreaterThanOrEqual(60_000)
    expect(replayMs).toBeLessThanOrEqual(72_000 + 2_500)
  })

  it('backs off throttling that continues for every worker longer than its first minute', async () => {
    const exchange = failing(429)
    await expect(
      resolveCoordinatedClientToken(input('throttled-twice', exchange))
    ).rejects.toThrow()
    await expireFailureRowsOf('throttled-twice')
    const before = Date.now()

    await expect(
      resolveCoordinatedClientToken(input('throttled-twice', exchange))
    ).rejects.toThrow()

    expect(
      (await failureRowOf('throttled-twice')).expiresAt.getTime() - before
    ).toBeGreaterThanOrEqual(96_000)
  })

  it.each([
    [
      'the still-valid token while its refresh is remembered failing',
      'unlocked-fallback',
      'outage',
    ],
    ['a remembered refusal', 'unlocked-refusal', 'refusal'],
  ] as const)(
    'serves %s without waiting for the application lock',
    async (_case, application, remembered) => {
      const appKey = applicationKey(NAMESPACE, [application])
      const fingerprint = sha256Json([application, 'secret-1'])
      const token = await encryptSecret(
        JSON.stringify({ accessToken: `${application}:token-1`, secretFingerprint: fingerprint })
      )
      const failure = await encryptSecret(
        JSON.stringify(
          remembered === 'outage'
            ? { code: 'provider_unavailable', status: 503, consecutiveFailures: 1 }
            : { code: 'invalid_credentials', status: 401 }
        )
      )
      await db.insert(clientCredentialToken).values([
        {
          id: appKey,
          encryptedValue: token.encrypted,
          accessTokenDigest: sha256Json(['coordinated_client_token', `${application}:token-1`]),
          expiresAt: new Date(Date.now() + 4 * 60_000),
        },
        {
          id: `${appKey}:${sha256Json(fingerprint)}`,
          encryptedValue: failure.encrypted,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ])
      const { exchange } = provider(application)
      const lockHeld = createDeferred<void>()
      const release = createDeferred<void>()
      const holder = db.transaction(async (tx) => {
        await acquireAdvisoryXactLock(tx, `${NAMESPACE}_client_token`, appKey)
        lockHeld.resolve()
        await release.promise
      })

      try {
        await lockHeld.promise
        const outcome = await Promise.race([
          resolveCoordinatedClientToken(input(application, exchange)).then(
            (value) => ({ value }),
            (error: unknown) => ({ error })
          ),
          sleep(3_000).then(() => 'waited on the lock' as const),
        ])

        expect(outcome).toEqual(
          remembered === 'outage'
            ? { value: expect.objectContaining({ accessToken: `${application}:token-1` }) }
            : { error: expect.objectContaining({ code: 'invalid_credentials' }) }
        )
        expect(exchange).not.toHaveBeenCalled()
      } finally {
        release.resolve()
        await holder
      }
    }
  )

  it('backs off an outage from a few seconds, longer while it continues, never past 30 seconds', async () => {
    const exchange = failing(502)

    const replays: number[] = []
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = Date.now()
      await expect(resolveCoordinatedClientToken(input('outage', exchange))).rejects.toMatchObject({
        code: 'provider_unavailable',
      })
      replays.push((await failureRowOf('outage')).expiresAt.getTime() - before)
      await expireFailureRowsOf('outage')
    }

    expect(replays[0]).toBeGreaterThanOrEqual(5_000)
    expect(replays[0]).toBeLessThanOrEqual(6_000 + 2_500)
    expect(replays[1]).toBeGreaterThanOrEqual(8_000)
    expect(Math.max(...replays)).toBeLessThanOrEqual(30_000 + 2_500)
  })

  it('starts the backoff over after the provider recovers', async () => {
    const { exchange: issue } = provider('recovered')
    const exchange = vi
      .fn<CoordinatedClientTokenInput['exchange']>()
      .mockImplementation(failing(502))
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(resolveCoordinatedClientToken(input('recovered', exchange))).rejects.toThrow()
      await expireFailureRowsOf('recovered')
    }
    exchange.mockImplementationOnce(issue)
    const { accessToken } = await resolveCoordinatedClientToken(input('recovered', exchange))
    await invalidateCoordinatedClientToken(accessToken)
    exchange.mockImplementation(failing(502))

    const before = Date.now()
    await expect(resolveCoordinatedClientToken(input('recovered', exchange))).rejects.toThrow()

    expect((await failureRowOf('recovered')).expiresAt.getTime() - before).toBeLessThanOrEqual(
      6_000 + 2_500
    )
  })
})

describe('default token rows shared with the previous build during a rolling deploy', () => {
  /** Seeds a still-valid token and the previous build's failure memo of `status` for one secret. */
  async function seedPreviousBuildFailure(application: string, status: number) {
    const appKey = applicationKey(NAMESPACE, [application])
    const fingerprint = sha256Json([application, 'secret-1'])
    const token = await encryptSecret(
      JSON.stringify({ accessToken: 'legacy-token', secretFingerprint: fingerprint })
    )
    const failure = await encryptSecret(JSON.stringify({ code: 'provider_unavailable', status }))
    await db.insert(clientCredentialToken).values([
      {
        id: appKey,
        encryptedValue: token.encrypted,
        accessTokenDigest: sha256Json(['coordinated_client_token', 'legacy-token']),
        expiresAt: new Date(Date.now() + 4 * 60_000),
      },
      {
        id: `${appKey}:${sha256Json(fingerprint)}`,
        encryptedValue: failure.encrypted,
        expiresAt: new Date(Date.now() + 20_000),
      },
    ])
  }

  it('serves a still-valid token when the previous build remembered an outage', async () => {
    const application = 'legacy-outage'
    await seedPreviousBuildFailure(application, 503)
    const { exchange } = provider(application)

    await expect(
      resolveCoordinatedClientToken(input(application, exchange))
    ).resolves.toMatchObject({ accessToken: 'legacy-token' })
    expect(exchange).not.toHaveBeenCalled()
  })

  it('replays a refusal the previous build stored as provider_unavailable without serving the token', async () => {
    const application = 'legacy-unmapped-refusal'
    await seedPreviousBuildFailure(application, 400)
    const { exchange } = provider(application)

    await expect(resolveCoordinatedClientToken(input(application, exchange))).rejects.toMatchObject(
      { code: 'provider_unavailable', status: 400 }
    )
    expect(exchange).not.toHaveBeenCalled()
  })

  it('stores every outage and throttled answer as a failure the previous build reads', async () => {
    for (const [application, exchange] of [
      ['legacy-readable-outage', failing(502)],
      ['legacy-readable-throttle', failing(429, 60_000)],
    ] as const) {
      await expect(resolveCoordinatedClientToken(input(application, exchange))).rejects.toThrow()

      const stored = await failureRowOf(application)
      const payload: unknown = JSON.parse(stored.decrypted)
      expect(previousBuildDecodesFailure.coordinated(payload)).toBe(true)
      expect(previousBuildDecodesFailure.vantaBeforeCoordination(payload)).toBe(true)
      expect(stored.accessTokenDigest).toBeNull()
    }
  })

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
