/**
 * @vitest-environment node
 */
import { clientCredentialToken } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type CoordinatedClientTokenInput,
  resolveCoordinatedClientToken,
} from '@/lib/credentials/coordinated-client-token'
import {
  type TokenServiceAccountValidationCode,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

beforeEach(() => {
  resetDbChainMock()
  encryptionMockFns.mockEncryptSecret.mockImplementation(async (secret: string) => ({
    encrypted: secret,
  }))
  encryptionMockFns.mockDecryptSecret.mockImplementation(async (value: string) => ({
    decrypted: value,
  }))
})

function refusing(code: TokenServiceAccountValidationCode, status: number) {
  return vi.fn<CoordinatedClientTokenInput['exchange']>(async () => {
    throw new TokenServiceAccountValidationError(code, status, { step: 'mint' })
  })
}

/**
 * Resolves once, then again against the rows the first resolution wrote, so the second call sees
 * any failure memo exactly as another worker reading the shared table would.
 */
async function resolveTwice(exchange: CoordinatedClientTokenInput['exchange']) {
  const input: CoordinatedClientTokenInput = {
    namespace: 'fixture',
    application: ['application'],
    clientSecret: 'secret',
    step: 'mint',
    exchange,
  }
  const first = await resolveCoordinatedClientToken(input).catch((error: unknown) => error)
  const written = dbChainMockFns.values.mock.calls.map(([row]) => row)
  queueTableRows(clientCredentialToken, [])
  queueTableRows(clientCredentialToken, written)
  const second = await resolveCoordinatedClientToken(input).catch((error: unknown) => error)
  return { first, second }
}

describe('resolveCoordinatedClientToken failure memo', () => {
  it('replays a refused exchange instead of calling the provider again', async () => {
    const exchange = refusing('invalid_credentials', 401)

    const { first, second } = await resolveTwice(exchange)

    expect(first).toMatchObject({ code: 'invalid_credentials', status: 401 })
    expect(second).toMatchObject({ code: 'invalid_credentials', status: 401 })
    expect(exchange).toHaveBeenCalledOnce()
  })

  it.each([
    ['a timeout or 5xx', 503],
    ['a 429', 429],
  ])('asks the provider again after %s instead of replaying it', async (_label, status) => {
    const exchange = refusing('provider_unavailable', status)

    const { first, second } = await resolveTwice(exchange)

    expect(first).toMatchObject({ code: 'provider_unavailable', status })
    expect(second).toMatchObject({ code: 'provider_unavailable', status })
    expect(exchange).toHaveBeenCalledTimes(2)
  })
})
