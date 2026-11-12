import { credential } from '@sim/db/schema'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLIENT_CREDENTIAL_ACCOUNT_SECRET_TYPE,
  RAMP_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import * as clientAccounts from '@/lib/credentials/client-credential-accounts/server'
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
