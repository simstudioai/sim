/**
 * @vitest-environment node
 */
import { encryptionMock, encryptionMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import { resolvePlaidServiceAccountForExecution } from '@/lib/credentials/application/use-plaid-service-account'

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

describe('resolvePlaidServiceAccountForExecution', () => {
  beforeEach(() => vi.clearAllMocks())

  it('decrypts the selected Plaid credential and verifies the injected Item token', async () => {
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({
      decrypted: JSON.stringify(stored),
    })

    await expect(
      resolvePlaidServiceAccountForExecution(
        {
          type: 'service_account',
          providerId: 'plaid-service-account',
          encryptedServiceAccountKey: 'encrypted',
        },
        'item-token'
      )
    ).resolves.toMatchObject(stored)
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
      resolvePlaidServiceAccountForExecution(
        {
          encryptedServiceAccountKey: 'encrypted',
          ...credential,
        },
        'item-token'
      )
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
  })

  it('rejects a mismatched injected token', async () => {
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({
      decrypted: JSON.stringify(stored),
    })
    await expect(
      resolvePlaidServiceAccountForExecution(
        {
          type: 'service_account',
          providerId: 'plaid-service-account',
          encryptedServiceAccountKey: 'encrypted',
        },
        'different-token'
      )
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('classifies malformed encrypted material as reconnect-required', async () => {
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({ decrypted: '{}' })
    await expect(
      resolvePlaidServiceAccountForExecution(
        {
          type: 'service_account',
          providerId: 'plaid-service-account',
          encryptedServiceAccountKey: 'encrypted',
        },
        'item-token'
      )
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })
})
