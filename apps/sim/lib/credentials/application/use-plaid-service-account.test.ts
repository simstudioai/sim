/**
 * @vitest-environment node
 */
import { encryptionMock, encryptionMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import { decryptPlaidServiceAccountCredential } from '@/lib/credentials/plaid-service-account'

const stored = {
  type: 'plaid_service_account',
  providerId: 'plaid-service-account',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  environment: 'production',
  accessToken: 'item-token',
  itemId: 'item-1',
  metadata: {},
}

describe('decryptPlaidServiceAccountCredential', () => {
  beforeEach(() => vi.clearAllMocks())

  it('decrypts the selected Plaid credential once inside the application boundary', async () => {
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({
      decrypted: JSON.stringify(stored),
    })

    await expect(
      decryptPlaidServiceAccountCredential({
        type: 'service_account',
        providerId: 'plaid-service-account',
        encryptedServiceAccountKey: 'encrypted',
      })
    ).resolves.toMatchObject(stored)
    expect(encryptionMockFns.mockDecryptSecret).toHaveBeenCalledTimes(1)
  })

  it.each([
    { type: 'oauth', providerId: 'plaid-service-account' },
    { type: 'service_account', providerId: 'snowflake-service-account' },
    {
      type: 'service_account',
      providerId: 'plaid-service-account',
      encryptedServiceAccountKey: null,
    },
  ])('rejects a non-Plaid credential before decryption', async (credential) => {
    await expect(
      decryptPlaidServiceAccountCredential({
        encryptedServiceAccountKey: 'encrypted',
        ...credential,
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('classifies malformed encrypted material as reconnect-required', async () => {
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({ decrypted: '{}' })
    await expect(
      decryptPlaidServiceAccountCredential({
        type: 'service_account',
        providerId: 'plaid-service-account',
        encryptedServiceAccountKey: 'encrypted',
      })
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })
})
