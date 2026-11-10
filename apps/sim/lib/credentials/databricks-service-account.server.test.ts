/**
 * @vitest-environment node
 */

import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/credentials/workload-identity/issuer', () => ({
  mintWorkloadIdentityToken: async ({ subject }: { subject: string }) => `token-for:${subject}`,
}))

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

describe('saving a keyless Databricks connection', () => {
  const HOST = 'dbc-1234abcd-5678.cloud.databricks.com'
  const CLIENT_ID = '00000000-0000-0000-0000-000000000000'
  const SUBJECT = 'sim:workspace:ws-1:credential:abcdef0123456789'
  const fetch = vi.fn()
  const config = { authType: 'oidc_federation', host: HOST, clientId: CLIENT_ID }
  const reconnectOwner = {
    ...owner,
    storedSecret: { type: 'databricks_credential_v1', config: { ...config, subject: SUBJECT } },
  }

  /** A service principal whose federation policy pins `subject` to {@link SUBJECT}, or trusts any subject. */
  function principalTrusting(pinsSubject: boolean, probeStatus = 401) {
    fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/oidc/v1/token')) {
        const body = new URLSearchParams(String(init.body))
        const trusted = !pinsSubject || body.get('subject_token') === `token-for:${SUBJECT}`
        return trusted
          ? jsonResponse({ access_token: 'dbx-token' })
          : jsonResponse({ error: 'invalid_grant' }, probeStatus)
      }
      return jsonResponse({ userName: 'sim-workflows' })
    })
  }

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
    encryptionMockFns.mockEncryptSecret.mockReset()
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
  })

  it('exchanges this credential’s token as the service principal and saves', async () => {
    principalTrusting(true)

    await expect(
      verifyAndEncryptDatabricksCredential(JSON.stringify(config), reconnectOwner)
    ).resolves.toMatchObject({ identity: 'sim-workflows' })
    const exchange = fetch.mock.calls
      .map(([url, init]) => ({ url, body: new URLSearchParams(String(init?.body)) }))
      .find(({ body }) => body.get('subject_token') === `token-for:${SUBJECT}`)
    expect(exchange?.url).toBe(`https://${HOST}/oidc/v1/token`)
    expect(Object.fromEntries(exchange?.body ?? [])).toEqual({
      client_id: CLIENT_ID,
      subject_token: `token-for:${SUBJECT}`,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      scope: 'all-apis',
    })
  })

  it('refuses a federation policy that trusts any Sim subject, so no other workspace can use it', async () => {
    principalTrusting(false)

    await expect(
      verifyAndEncryptDatabricksCredential(JSON.stringify(config), reconnectOwner)
    ).rejects.toThrow(/also trusts other Sim credentials/)
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('does not save when the any-subject check cannot be completed', async () => {
    principalTrusting(true, 503)

    await expect(
      verifyAndEncryptDatabricksCredential(JSON.stringify(config), reconnectOwner)
    ).rejects.toThrow(/could not confirm/)
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

  it('reports a token reply without a token as the provider misbehaving, not a bad credential', async () => {
    fetch.mockResolvedValue(jsonResponse({}, 200))

    await expect(resolveDatabricksCredentialToken('cred-1')).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })
})
