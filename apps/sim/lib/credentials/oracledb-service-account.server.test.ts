/**
 * @vitest-environment node
 */
import { credential } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/internal/oracledb/client', () => ({ executeOracleStatements: mocks.execute }))

import {
  getOracleDatabaseCredential,
  verifyAndEncryptOracleDatabaseCredential,
} from '@/lib/credentials/oracledb-service-account.server'

const connection = {
  host: 'db.example.com',
  username: 'app_user',
  password: ' exact password ',
  serviceName: 'APP',
  protocol: 'tcps',
  walletContent: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
  walletPassword: ' exact wallet password ',
}
const secret = { type: 'oracledb_connection_v1', connection }
const row = {
  workspaceId: 'workspace-1',
  organizationId: null,
  providerId: 'oracledb-service-account',
  type: 'service_account',
  revokedAt: null,
  encryptedServiceAccountKey: 'ciphertext',
}

describe('Oracle Database saved credential boundary', () => {
  beforeEach(() => {
    resetDbChainMock()
    mocks.execute.mockResolvedValue([{ rows: [{ SIM_CONNECTION_OK: '1' }], rowCount: 1 }])
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: JSON.stringify(secret) })
  })

  it('verifies the exact password and wallet before encryption', async () => {
    await expect(
      verifyAndEncryptOracleDatabaseCredential(JSON.stringify(connection))
    ).resolves.toMatchObject({ encryptedServiceAccountKey: 'ciphertext', username: 'app_user' })
    expect(mocks.execute.mock.calls[0]?.[0]).toMatchObject(connection)
    expect(mocks.execute.mock.invocationCallOrder[0]).toBeLessThan(
      encryptionMockFns.mockEncryptSecret.mock.invocationCallOrder[0]
    )
    const persisted = JSON.parse(encryptionMockFns.mockEncryptSecret.mock.calls[0]?.[0])
    expect(persisted.connection).toMatchObject(connection)
  })

  it('does not persist failed verification or expose provider-echoed secrets', async () => {
    mocks.execute.mockRejectedValue(new Error('provider echoed exact password'))
    await expect(
      verifyAndEncryptOracleDatabaseCredential(JSON.stringify(connection))
    ).rejects.toThrow('Could not verify the Oracle Database connection')
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it.each([
    { providerId: 'different-provider' },
    { workspaceId: 'different-workspace' },
    { revokedAt: new Date() },
    { organizationId: 'organization-1' },
  ])(
    'denies an unavailable or mismatched saved credential before decryption: %j',
    async (override) => {
      queueTableRows(credential, [{ ...row, ...override }])
      await expect(
        getOracleDatabaseCredential('credential-1', { workspaceId: 'workspace-1' })
      ).rejects.toThrow('Oracle Database credential is unavailable')
      expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
    }
  )

  it('loads the bound saved connection and rejects malformed decrypted data', async () => {
    queueTableRows(credential, [row])
    await expect(
      getOracleDatabaseCredential('credential-1', { workspaceId: 'workspace-1' })
    ).resolves.toMatchObject(connection)
    resetDbChainMock()
    queueTableRows(credential, [row])
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({
      decrypted: JSON.stringify({ ...secret, type: 'different-kind' }),
    })
    await expect(
      getOracleDatabaseCredential('credential-1', { workspaceId: 'workspace-1' })
    ).rejects.toThrow('Oracle Database credential is unavailable')
  })
})
