/**
 * @vitest-environment node
 */

import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

import { verifyAndEncryptDatabricksCredential } from '@/lib/credentials/databricks-service-account.server'

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
