import { credential } from '@sim/db/schema'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE,
  RAMP_SERVICE_ACCOUNT_PROVIDER_ID,
  VANTA_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import * as clientAccounts from '@/lib/credentials/client-credential-accounts/server'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import {
  forgetRejectedClientCredentialToken,
  resolveServiceAccountToken,
} from '@/lib/oauth/credential-service'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

const token = { accessToken: 'valid-access-token', expiresInSeconds: 3600 }
const storedCredential = { encryptedServiceAccountKey: 'encrypted-ramp-client-credentials' }

beforeEach(() => {
  resetDbChainMock()
  encryptionMockFns.mockDecryptSecret.mockResolvedValue({
    decrypted: JSON.stringify({
      type: CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE,
      providerId: RAMP_SERVICE_ACCOUNT_PROVIDER_ID,
      clientId: 'ramp-client',
      clientSecret: 'ramp-client-secret',
      orgId: '',
    }),
  })
})

describe('client credential cancellation isolation', () => {
  it('lets a caller cancel its wait while another caller and later calls keep the shared token', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Workflow cancelled', 'AbortError')
    const started = createDeferred<void>()
    const issued = createDeferred<clientAccounts.ClientCredentialAccountMintResult>()
    vi.spyOn(clientAccounts, 'getClientCredentialAccountMinter').mockReturnValue(
      async (_fields, options) => {
        options?.signal?.addEventListener('abort', () => issued.reject(options.signal?.reason), {
          once: true,
        })
        started.resolve()
        return issued.promise
      }
    )
    queueTableRows(credential, [storedCredential])
    const first = resolveServiceAccountToken(
      'ramp-cancel-shared',
      RAMP_SERVICE_ACCOUNT_PROVIDER_ID,
      undefined,
      undefined,
      { signal: controller.signal }
    )
    await started.promise
    const second = resolveServiceAccountToken(
      'ramp-cancel-shared',
      RAMP_SERVICE_ACCOUNT_PROVIDER_ID
    )
    const firstRejected = expect(first).rejects.toBe(reason)
    const secondSucceeded = expect(second).resolves.toEqual({ accessToken: token.accessToken })
    controller.abort(reason)
    issued.resolve(token)
    await Promise.all([firstRejected, secondSucceeded])

    queueTableRows(credential, [storedCredential])
    await expect(
      resolveServiceAccountToken('ramp-cancel-shared', RAMP_SERVICE_ACCOUNT_PROVIDER_ID)
    ).resolves.toEqual({ accessToken: token.accessToken })
  })

  it('does not memoize a cancelled mint as a failure for the next credential resolution', async () => {
    const reason = new DOMException('Mint cancelled', 'AbortError')
    const mint = vi.fn<clientAccounts.ClientCredentialAccountMinter>()
    mint.mockRejectedValueOnce(reason).mockResolvedValueOnce(token)
    vi.spyOn(clientAccounts, 'getClientCredentialAccountMinter').mockReturnValue(mint)
    queueTableRows(credential, [storedCredential])
    await expect(
      resolveServiceAccountToken('ramp-cancel-retry', RAMP_SERVICE_ACCOUNT_PROVIDER_ID)
    ).rejects.toBe(reason)

    queueTableRows(credential, [storedCredential])
    await expect(
      resolveServiceAccountToken('ramp-cancel-retry', RAMP_SERVICE_ACCOUNT_PROVIDER_ID)
    ).resolves.toEqual({ accessToken: token.accessToken })
  })
})

describe('client credential token cache', () => {
  it('serves the region and application key a token was minted with along with the cached token', async () => {
    const mint = vi.fn<clientAccounts.ClientCredentialAccountMinter>()
    mint.mockResolvedValue({ ...token, domain: 'eu-1', applicationKey: 'application-key' })
    vi.spyOn(clientAccounts, 'getClientCredentialAccountMinter').mockReturnValue(mint)

    for (let call = 0; call < 2; call++) {
      queueTableRows(credential, [storedCredential])
      await expect(
        resolveServiceAccountToken('ramp-cached-region', RAMP_SERVICE_ACCOUNT_PROVIDER_ID)
      ).resolves.toMatchObject({
        accessToken: token.accessToken,
        domain: 'eu-1',
        applicationKey: 'application-key',
      })
    }
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('mints a replacement once the provider rejects the cached token, and only that token', async () => {
    const mint = vi.fn<clientAccounts.ClientCredentialAccountMinter>()
    mint
      .mockResolvedValueOnce({ ...token, accessToken: 'rejected-token' })
      .mockResolvedValueOnce({ ...token, accessToken: 'replacement-token' })
    vi.spyOn(clientAccounts, 'getClientCredentialAccountMinter').mockReturnValue(mint)
    const resolve = () => {
      queueTableRows(credential, [storedCredential])
      return resolveServiceAccountToken('ramp-rejected', RAMP_SERVICE_ACCOUNT_PROVIDER_ID)
    }

    await expect(resolve()).resolves.toEqual({ accessToken: 'rejected-token' })
    forgetRejectedClientCredentialToken('rejected-token')
    await expect(resolve()).resolves.toEqual({ accessToken: 'replacement-token' })
    forgetRejectedClientCredentialToken('rejected-token')
    await expect(resolve()).resolves.toEqual({ accessToken: 'replacement-token' })
    expect(mint).toHaveBeenCalledTimes(2)
  })
  it('keeps a token minted within the minimum age, and drops it once it is older', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const mint = vi.fn<clientAccounts.ClientCredentialAccountMinter>()
      mint
        .mockResolvedValueOnce({ ...token, accessToken: 'refused-token' })
        .mockResolvedValueOnce({ ...token, accessToken: 'replacement-token' })
      vi.spyOn(clientAccounts, 'getClientCredentialAccountMinter').mockReturnValue(mint)
      const resolve = () => {
        queueTableRows(credential, [storedCredential])
        return resolveServiceAccountToken('ramp-refused-aged', RAMP_SERVICE_ACCOUNT_PROVIDER_ID)
      }

      await expect(resolve()).resolves.toEqual({ accessToken: 'refused-token' })
      vi.advanceTimersByTime(30_000)
      forgetRejectedClientCredentialToken('refused-token', { minimumAgeMs: 60_000 })
      await expect(resolve()).resolves.toEqual({ accessToken: 'refused-token' })

      vi.advanceTimersByTime(31_000)
      forgetRejectedClientCredentialToken('refused-token', { minimumAgeMs: 60_000 })
      await expect(resolve()).resolves.toEqual({ accessToken: 'replacement-token' })
      expect(mint).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('client credential token refresh after a failed mint', () => {
  const refused = () =>
    new TokenServiceAccountValidationError('invalid_credentials', 401, { step: 'mint' })
  const unavailable = (status = 502, retryAfterMs?: number) =>
    new TokenServiceAccountValidationError(
      'provider_unavailable',
      status,
      { step: 'mint' },
      {
        retryAfterMs,
      }
    )

  /** Resolves with fake timers running, so an in-mint retry pause elapses without real waiting. */
  async function resolveFor(
    credentialId: string,
    providerId: string = RAMP_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    queueTableRows(credential, [storedCredential])
    const outcome = resolveServiceAccountToken(credentialId, providerId).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    await vi.runAllTimersAsync()
    return outcome
  }

  function minter() {
    const mint = vi.fn<clientAccounts.ClientCredentialAccountMinter>()
    vi.spyOn(clientAccounts, 'getClientCredentialAccountMinter').mockReturnValue(mint)
    return mint
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps serving a still-valid token while its early refresh fails transiently', async () => {
    const mint = minter()
    mint.mockResolvedValueOnce({ accessToken: 'current-token', expiresInSeconds: 600 })
    await expect(resolveFor('ramp-refresh-outage')).resolves.toEqual({
      value: { accessToken: 'current-token' },
    })
    mint.mockRejectedValue(unavailable())
    vi.advanceTimersByTime(6 * 60_000)

    await expect(resolveFor('ramp-refresh-outage')).resolves.toEqual({
      value: { accessToken: 'current-token' },
    })
    const askedDuringRefresh = mint.mock.calls.length
    await expect(resolveFor('ramp-refresh-outage')).resolves.toEqual({
      value: { accessToken: 'current-token' },
    })
    expect(askedDuringRefresh).toBeGreaterThan(1)
    expect(mint).toHaveBeenCalledTimes(askedDuringRefresh)
  })

  it('reports the failed refresh once the cached token has run out', async () => {
    const mint = minter()
    mint.mockResolvedValueOnce({ accessToken: 'current-token', expiresInSeconds: 600 })
    await resolveFor('ramp-refresh-expired')
    mint.mockRejectedValue(unavailable())
    vi.advanceTimersByTime(600_000 - 20_000)

    await expect(resolveFor('ramp-refresh-expired')).resolves.toEqual({
      error: expect.objectContaining({ code: 'provider_unavailable' }),
    })
  })

  it('does not serve a cached token that a slow failed refresh carried inside its expiry margin', async () => {
    const mint = minter()
    mint.mockResolvedValueOnce({ accessToken: 'current-token', expiresInSeconds: 600 })
    await resolveFor('ramp-refresh-slow')
    mint.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 15_000)
      throw unavailable()
    })
    vi.advanceTimersByTime(600_000 - 40_000)

    await expect(resolveFor('ramp-refresh-slow')).resolves.toEqual({
      error: expect.objectContaining({ code: 'provider_unavailable' }),
    })
  })

  it('does not serve a cached token the provider refused while its failed refresh was in flight', async () => {
    const mint = minter()
    mint.mockResolvedValueOnce({ accessToken: 'current-token', expiresInSeconds: 600 })
    await resolveFor('ramp-refresh-rejected-midway')
    mint.mockImplementation(async () => {
      forgetRejectedClientCredentialToken('current-token')
      throw unavailable()
    })
    vi.advanceTimersByTime(6 * 60_000)

    await expect(resolveFor('ramp-refresh-rejected-midway')).resolves.toEqual({
      error: expect.objectContaining({ code: 'provider_unavailable' }),
    })
  })

  it('stops serving the cached token once the provider refuses the credentials', async () => {
    const mint = minter()
    mint.mockResolvedValueOnce({ accessToken: 'current-token', expiresInSeconds: 600 })
    await resolveFor('ramp-refresh-refused')
    mint.mockRejectedValue(refused())
    vi.advanceTimersByTime(6 * 60_000)

    await expect(resolveFor('ramp-refresh-refused')).resolves.toEqual({
      error: expect.objectContaining({ code: 'invalid_credentials' }),
    })
    expect(mint).toHaveBeenCalledTimes(2)
  })

  it('never serves a refused token again when a later refresh fails with an outage', async () => {
    const mint = minter()
    mint.mockResolvedValueOnce({ accessToken: 'current-token', expiresInSeconds: 600 })
    await resolveFor('ramp-refused-then-outage')
    mint.mockRejectedValueOnce(refused()).mockRejectedValue(unavailable())
    vi.advanceTimersByTime(6 * 60_000)
    await resolveFor('ramp-refused-then-outage')
    vi.advanceTimersByTime(31_000)

    await expect(resolveFor('ramp-refused-then-outage')).resolves.toEqual({
      error: expect.objectContaining({ code: 'provider_unavailable' }),
    })
  })

  it('retries a quick transient failure once inside the mint', async () => {
    const mint = minter()
    mint.mockRejectedValueOnce(unavailable(503)).mockResolvedValueOnce(token)

    await expect(resolveFor('ramp-retry-once')).resolves.toEqual({
      value: { accessToken: token.accessToken },
    })
    expect(mint).toHaveBeenCalledTimes(2)
  })

  it('does not retry an attempt that took as long as a provider timeout', async () => {
    const mint = minter()
    mint.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 10_000)
      throw unavailable()
    })

    await expect(resolveFor('ramp-timed-out')).resolves.toEqual({
      error: expect.objectContaining({ code: 'provider_unavailable' }),
    })
    expect(mint).toHaveBeenCalledOnce()
  })

  it('replays a refusal of the credentials for 30 seconds without retrying it', async () => {
    const mint = minter()
    mint.mockRejectedValue(refused())

    await resolveFor('ramp-refused')
    vi.advanceTimersByTime(29_000)
    await expect(resolveFor('ramp-refused')).resolves.toEqual({
      error: expect.objectContaining({ code: 'invalid_credentials' }),
    })
    expect(mint).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(2_000)
    await resolveFor('ramp-refused')
    expect(mint).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['as long as a throttled provider asks', 120_000, 120_000],
    ['no longer than five minutes, whatever the provider asks', 3_600_000, 300_000],
  ])('waits %s before asking again', async (_case, retryAfterMs, waitMs) => {
    const mint = minter()
    const credentialId = `ramp-throttled-${retryAfterMs}`
    mint.mockRejectedValueOnce(unavailable(429, retryAfterMs)).mockResolvedValueOnce(token)

    await expect(resolveFor(credentialId)).resolves.toEqual({
      error: expect.objectContaining({ code: 'provider_unavailable', status: 429 }),
    })
    vi.advanceTimersByTime(waitMs - 1_000)
    await expect(resolveFor(credentialId)).resolves.toEqual({
      error: expect.objectContaining({ status: 429 }),
    })
    expect(mint).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(2_000)
    await expect(resolveFor(credentialId)).resolves.toEqual({
      value: { accessToken: token.accessToken },
    })
  })

  it('backs off an outage briefly at first, longer while it lasts, and never past 30 seconds', async () => {
    const mint = minter()
    mint.mockRejectedValue(unavailable())

    await resolveFor('ramp-outage')
    const firstAttempt = mint.mock.calls.length
    vi.advanceTimersByTime(6_001)
    await resolveFor('ramp-outage')
    const secondAttempt = mint.mock.calls.length
    expect(secondAttempt).toBeGreaterThan(firstAttempt)

    vi.advanceTimersByTime(6_001)
    await resolveFor('ramp-outage')
    expect(mint).toHaveBeenCalledTimes(secondAttempt)

    for (let attempt = 0; attempt < 6; attempt++) {
      const asked = mint.mock.calls.length
      vi.advanceTimersByTime(30_001)
      await resolveFor('ramp-outage')
      expect(mint.mock.calls.length).toBeGreaterThan(asked)
    }
  })

  it('waits at least a minute after a throttled answer that gave no Retry-After', async () => {
    const mint = minter()
    mint.mockRejectedValueOnce(unavailable(429)).mockResolvedValueOnce(token)

    await resolveFor('ramp-throttled-bare')
    vi.advanceTimersByTime(59_000)
    await expect(resolveFor('ramp-throttled-bare')).resolves.toEqual({
      error: expect.objectContaining({ status: 429 }),
    })
    expect(mint).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(14_000)
    await expect(resolveFor('ramp-throttled-bare')).resolves.toEqual({
      value: { accessToken: token.accessToken },
    })
  })

  it('waits about a minute, not an outage streak longer, for a throttled answer after an outage', async () => {
    const mint = minter()
    const answers = [unavailable(), unavailable(), unavailable(429)]
    mint.mockImplementation(async () => {
      throw answers[0]
    })

    await resolveFor('ramp-outage-then-throttled')
    answers.shift()
    vi.advanceTimersByTime(30_001)
    await resolveFor('ramp-outage-then-throttled')
    answers.shift()
    vi.advanceTimersByTime(30_001)
    await expect(resolveFor('ramp-outage-then-throttled')).resolves.toEqual({
      error: expect.objectContaining({ status: 429 }),
    })
    mint.mockResolvedValueOnce(token)

    vi.advanceTimersByTime(73_000)
    await expect(resolveFor('ramp-outage-then-throttled')).resolves.toEqual({
      value: { accessToken: token.accessToken },
    })
  })

  it('waits at least 5 seconds before asking again after an outage, whatever the jitter', async () => {
    const lowestJitter = vi
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation((array) => array)
    try {
      const mint = minter()
      mint.mockImplementation(async () => {
        vi.setSystemTime(Date.now() + 10_000)
        throw unavailable()
      })

      await resolveFor('ramp-outage-floor')
      vi.advanceTimersByTime(4_900)
      await resolveFor('ramp-outage-floor')

      expect(mint).toHaveBeenCalledOnce()
    } finally {
      lowestJitter.mockRestore()
    }
  })

  it('replays a coordinated failure exactly as long as the coordinated layer still replays it', async () => {
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({
      decrypted: JSON.stringify({
        type: CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE,
        providerId: VANTA_SERVICE_ACCOUNT_PROVIDER_ID,
        clientId: 'vanta-client',
        clientSecret: 'vanta-client-secret',
      }),
    })
    const mint = minter()
    mint
      .mockRejectedValueOnce(
        new TokenServiceAccountValidationError(
          'provider_unavailable',
          502,
          { step: 'mint' },
          { replayForMs: 300 }
        )
      )
      .mockResolvedValueOnce(token)

    await resolveFor('vanta-coordinated-replay', VANTA_SERVICE_ACCOUNT_PROVIDER_ID)
    vi.advanceTimersByTime(301)

    await expect(
      resolveFor('vanta-coordinated-replay', VANTA_SERVICE_ACCOUNT_PROVIDER_ID)
    ).resolves.toEqual({ value: { accessToken: token.accessToken } })
  })

  it('asks the coordinated layer again at once after a failure it does not remember', async () => {
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({
      decrypted: JSON.stringify({
        type: CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE,
        providerId: VANTA_SERVICE_ACCOUNT_PROVIDER_ID,
        clientId: 'vanta-client',
        clientSecret: 'vanta-client-secret',
      }),
    })
    const mint = minter()
    mint
      .mockRejectedValueOnce(
        new TokenServiceAccountValidationError('provider_unavailable', 503, { step: 'mint' })
      )
      .mockResolvedValueOnce(token)

    await resolveFor('vanta-coordination-failed', VANTA_SERVICE_ACCOUNT_PROVIDER_ID)

    await expect(
      resolveFor('vanta-coordination-failed', VANTA_SERVICE_ACCOUNT_PROVIDER_ID)
    ).resolves.toEqual({ value: { accessToken: token.accessToken } })
  })
})
