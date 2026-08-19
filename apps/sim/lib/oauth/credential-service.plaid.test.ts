/**
 * @vitest-environment node
 */
import {
  encryptionMock,
  encryptionMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import { resolveServiceAccountToken } from '@/lib/oauth/credential-service'

const storedPlaidSecret = {
  type: 'plaid_service_account',
  providerId: 'plaid-service-account',
  clientId: 'client-id',
  clientSecret: 'environment-secret',
  environment: 'production',
  accessToken: 'access-production-item',
  itemId: 'item-1',
  institutionId: 'ins_123',
  metadata: { principalKind: 'tenant', principalId: 'item-1' },
}

describe('resolveServiceAccountToken — Plaid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('decrypts the exact Plaid blob and projects only runtime credential fields', async () => {
    queueTableRows(schemaMock.credential, [{ encryptedServiceAccountKey: 'encrypted-plaid' }])
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({
      decrypted: JSON.stringify(storedPlaidSecret),
    })

    await expect(
      resolveServiceAccountToken('credential-1', 'plaid-service-account')
    ).resolves.toEqual({ accessToken: 'access-production-item' })
  })

  it('fails closed if the encrypted blob belongs to another provider', async () => {
    queueTableRows(schemaMock.credential, [{ encryptedServiceAccountKey: 'encrypted-other' }])
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({
      decrypted: JSON.stringify({ ...storedPlaidSecret, providerId: 'other-service-account' }),
    })

    await expect(
      resolveServiceAccountToken('credential-1', 'plaid-service-account')
    ).rejects.toThrow('Stored Plaid service-account secret is malformed')
  })
})
