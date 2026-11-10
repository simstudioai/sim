/**
 * @vitest-environment node
 */

import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import { credential } from '@sim/db/schema'
import {
  resolveDatabricksCredentialToken,
  verifyAndEncryptDatabricksCredential,
} from '@/lib/credentials/databricks-service-account.server'
import { DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

const owner = { workspaceId: 'ws-1', actorUserId: 'user-1' }

function patConfig(host: string) {
  return JSON.stringify({ authType: 'personal_access_token', host, token: 'dapi-secret' })
}

describe('saving a Databricks connection', () => {
  const fetch = vi.fn()

  beforeEach(() => {
    fetch.mockReset().mockResolvedValue(jsonResponse({ userName: 'me@example.com' }))
    vi.stubGlobal('fetch', fetch)
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
  })

  it('verifies a Databricks workspace host by calling only that host', async () => {
    await expect(
      verifyAndEncryptDatabricksCredential(
        patConfig('dbc-1234abcd-5678.cloud.databricks.com'),
        owner
      )
    ).resolves.toMatchObject({ identity: 'me@example.com' })
    expect(fetch).toHaveBeenCalledWith(
      'https://dbc-1234abcd-5678.cloud.databricks.com/api/2.0/preview/scim/v2/Me',
      expect.objectContaining({ redirect: 'error' })
    )
  })

  it.each([
    'attacker.example.com',
    'https://attacker.example.com',
    'dbc-1234abcd-5678.cloud.databricks.com.attacker.example.com',
    '127.0.0.1',
  ])('refuses %s without sending the token anywhere', async (host) => {
    await expect(verifyAndEncryptDatabricksCredential(patConfig(host), owner)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })
})

describe('getting a Databricks token for a run', () => {
  const fetch = vi.fn()

  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(credential, [
      {
        workspaceId: 'ws-1',
        organizationId: null,
        type: 'service_account',
        providerId: DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
        revokedAt: null,
        encryptedServiceAccountKey: 'ciphertext',
      },
    ])
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({
      decrypted: JSON.stringify({
        type: 'databricks_credential_v1',
        config: {
          authType: 'service_principal',
          host: 'dbc-1234abcd-5678.cloud.databricks.com',
          clientId: '00000000-0000-0000-0000-000000000000',
          clientSecret: 'dose-secret',
        },
      }),
    })
    vi.stubGlobal('fetch', fetch)
  })

  it('reports a refused client secret as a credential to reconnect', async () => {
    fetch.mockResolvedValue(jsonResponse({ error: 'invalid_client' }, 401))

    await expect(resolveDatabricksCredentialToken('cred-1')).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('reports a Databricks outage as the provider being unavailable, not a bad credential', async () => {
    fetch.mockResolvedValue(jsonResponse({ error: 'temporarily_unavailable' }, 503))

    await expect(resolveDatabricksCredentialToken('cred-1')).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })
})
