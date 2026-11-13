/**
 * @vitest-environment node
 */

import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mint: vi.fn(async ({ subject }: { subject: string }) => `token-for:${subject}`),
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/credentials/workload-identity/issuer', () => ({
  isWorkloadIdentityConfigured: async () => true,
  MAX_WORKLOAD_IDENTITY_TOKEN_TTL_SECONDS: 3600,
  mintWorkloadIdentityToken: hoisted.mint,
}))

import { credential } from '@sim/db/schema'
import {
  resolveDatabricksCredentialToken,
  verifyAndEncryptDatabricksCredential,
} from '@/lib/credentials/databricks-service-account.server'
import { WorkloadIdentityNotConfiguredError } from '@/lib/credentials/workload-identity/subject'
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

  it('refuses an identity reply over the size cap instead of saving the host as the identity', async () => {
    fetch.mockResolvedValue(
      jsonResponse({ userName: 'me@example.com', groups: 'g'.repeat(1024 * 1024) })
    )

    await expect(
      verifyAndEncryptDatabricksCredential(
        patConfig('dbc-1234abcd-5678.cloud.databricks.com'),
        owner
      )
    ).rejects.toThrow(/Could not verify/)
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
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

  it('reconnects to a keyless refusal with its code when signing stops mid-save', async () => {
    principalTrusting(true)
    hoisted.mint.mockRejectedValueOnce(new WorkloadIdentityNotConfiguredError())

    await expect(
      verifyAndEncryptDatabricksCredential(JSON.stringify(config), reconnectOwner)
    ).rejects.toMatchObject({ detailCode: 'WORKLOAD_IDENTITY_NOT_CONFIGURED' })
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

  it('asks once to try again when the any-subject check cannot reach the workspace', async () => {
    principalTrusting(true)
    const trusted = fetch.getMockImplementation()
    fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init?.body))
      if (url.endsWith('/oidc/v1/token') && body.get('subject_token') !== `token-for:${SUBJECT}`) {
        throw new TypeError('fetch failed')
      }
      return trusted?.(url, init)
    })

    await expect(
      verifyAndEncryptDatabricksCredential(JSON.stringify(config), reconnectOwner)
    ).rejects.toThrow(/this credential: Could not reach the Databricks workspace\. Try again\.$/)
  })
})

describe('a keyless Databricks connection with its own audience', () => {
  const HOST = 'dbc-1234abcd-5678.cloud.databricks.com'
  const CLIENT_ID = '00000000-0000-0000-0000-000000000000'
  const SUBJECT = 'sim:workspace:ws-1:credential:abcdef0123456789'
  const ACCOUNT_ID = '11111111-2222-3333-4444-555555555555'
  const fetch = vi.fn()
  const config = { authType: 'oidc_federation', host: HOST, clientId: CLIENT_ID }
  const reconnectOwner = {
    ...owner,
    storedSecret: { type: 'databricks_credential_v1', config: { ...config, subject: SUBJECT } },
  }

  /** A federation policy that pins {@link SUBJECT} and lists only `audience`. */
  function policyTrusting(audience: string) {
    hoisted.mint.mockImplementation(
      async ({ subject, audience: aud }: { subject: string; audience?: string }) =>
        `token-for:${subject}:${aud}`
    )
    fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/oidc/v1/token')) {
        const body = new URLSearchParams(String(init.body))
        return body.get('subject_token') === `token-for:${SUBJECT}:${audience}`
          ? jsonResponse({ access_token: 'dbx-token' })
          : jsonResponse({ error: 'invalid_grant' }, 401)
      }
      return jsonResponse({ userName: 'sim-workflows' })
    })
  }

  function storedConfig(): Record<string, unknown> {
    const [plaintext] = encryptionMockFns.mockEncryptSecret.mock.calls[0] as [string]
    return JSON.parse(plaintext).config
  }

  function mintedAudiences(): unknown[] {
    return hoisted.mint.mock.calls.map(([input]) => (input as { audience?: string }).audience)
  }

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
    hoisted.mint.mockClear()
    encryptionMockFns.mockEncryptSecret.mockReset()
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
  })

  it('verifies, probes, and stores the custom audience', async () => {
    policyTrusting(ACCOUNT_ID)

    await expect(
      verifyAndEncryptDatabricksCredential(
        JSON.stringify({ ...config, audience: ` ${ACCOUNT_ID} ` }),
        reconnectOwner
      )
    ).resolves.toMatchObject({ identity: 'sim-workflows' })
    // The verification and the any-subject probe both carry the audience real runs use.
    expect(hoisted.mint).toHaveBeenCalledTimes(2)
    expect(mintedAudiences()).toEqual([ACCOUNT_ID, ACCOUNT_ID])
    expect(storedConfig()).toMatchObject({ audience: ACCOUNT_ID })
  })

  it.each([
    ['no audience', {}],
    ['the default audience', { audience: 'sim-databricks' }],
  ])('mints the default and stores no audience when given %s', async (_case, audience) => {
    policyTrusting('sim-databricks')

    await verifyAndEncryptDatabricksCredential(
      JSON.stringify({ ...config, ...audience }),
      reconnectOwner
    )
    expect(mintedAudiences()).toEqual(['sim-databricks', 'sim-databricks'])
    expect(storedConfig()).not.toHaveProperty('audience')
  })

  it('goes back to the default when a reconnect clears a custom audience', async () => {
    policyTrusting('sim-databricks')
    const customOwner = {
      ...owner,
      storedSecret: {
        type: 'databricks_credential_v1',
        config: { ...config, subject: SUBJECT, audience: ACCOUNT_ID },
      },
    }

    await verifyAndEncryptDatabricksCredential(JSON.stringify(config), customOwner)
    expect(mintedAudiences()).toEqual(['sim-databricks', 'sim-databricks'])
    expect(storedConfig()).not.toHaveProperty('audience')
  })

  it('refuses another cloud’s default audience before calling Databricks', async () => {
    await expect(
      verifyAndEncryptDatabricksCredential(
        JSON.stringify({ ...config, audience: 'sts.amazonaws.com' }),
        reconnectOwner
      )
    ).rejects.toThrow(/belongs to another cloud/)
    expect(fetch).not.toHaveBeenCalled()
    expect(hoisted.mint).not.toHaveBeenCalled()
  })

  it('names the audience it sent when the policy does not trust it', async () => {
    policyTrusting('sim-databricks')

    await expect(
      verifyAndEncryptDatabricksCredential(
        JSON.stringify({ ...config, audience: ACCOUNT_ID }),
        reconnectOwner
      )
    ).rejects.toThrow(ACCOUNT_ID)
  })
})

describe('getting a keyless Databricks token for a run', () => {
  const fetch = vi.fn()

  function storeKeyless(extra: Record<string, unknown>) {
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
          authType: 'oidc_federation',
          host: 'dbc-1234abcd-5678.cloud.databricks.com',
          clientId: '00000000-0000-0000-0000-000000000000',
          subject: 'sim:workspace:ws-1:credential:abcdef0123456789',
          ...extra,
        },
      }),
    })
  }

  beforeEach(() => {
    hoisted.mint.mockClear()
    fetch.mockReset().mockResolvedValue(jsonResponse({ access_token: 'dbx-token' }))
    vi.stubGlobal('fetch', fetch)
  })

  it('mints with the stored custom audience', async () => {
    storeKeyless({ audience: 'acct-1234' })

    await resolveDatabricksCredentialToken('cred-1')
    expect(hoisted.mint).toHaveBeenCalledWith(expect.objectContaining({ audience: 'acct-1234' }))
  })

  it('mints exactly the old default for a credential saved before audiences were configurable', async () => {
    storeKeyless({})

    await resolveDatabricksCredentialToken('cred-1')
    expect(hoisted.mint).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'sim-databricks' })
    )
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

  it('reports a token reply over the size cap as oversized, not as a refused request', async () => {
    fetch.mockResolvedValue(jsonResponse({ access_token: 't'.repeat(1024 * 1024) }, 200))

    await expect(resolveDatabricksCredentialToken('cred-1')).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
      logDetail: { reason: 'Databricks token response exceeded the size limit' },
    })
  })

  it('reports a token reply cut off mid-body as the provider being unavailable, not a bad credential', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":"invalid_cl'))
        controller.error(new Error('socket hang up'))
      },
    })
    fetch.mockResolvedValue(
      new Response(body, { status: 401, headers: { 'Content-Type': 'application/json' } })
    )

    await expect(resolveDatabricksCredentialToken('cred-1')).rejects.toMatchObject({
      code: 'provider_unavailable',
      logDetail: { reason: 'Databricks token response could not be read' },
    })
  })

  it('reports a token reply without a token as the provider misbehaving, not a bad credential', async () => {
    fetch.mockResolvedValue(jsonResponse({}, 200))

    await expect(resolveDatabricksCredentialToken('cred-1')).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })

  it.each([
    [
      'the connection fails',
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('connect ECONNREFUSED 203.0.113.7:443'), {
          code: 'ECONNREFUSED',
        }),
      }),
    ],
    ['the workspace answers with a redirect', new TypeError('fetch failed: unexpected redirect')],
    ['the request times out', new DOMException('The operation timed out.', 'TimeoutError')],
  ])(
    'reports a workspace that cannot be reached when %s as unavailable, without connection details',
    async (_case, failure) => {
      fetch.mockRejectedValue(failure)

      const error = await resolveDatabricksCredentialToken('cred-1').catch((caught) => caught)

      expect(error).toMatchObject({ code: 'provider_unavailable', status: 502 })
      expect(JSON.stringify(error)).not.toContain('203.0.113.7')
    }
  )

  it('rethrows when the run itself is cancelled', async () => {
    const controller = new AbortController()
    fetch.mockImplementation(async () => {
      controller.abort()
      throw new DOMException('This operation was aborted', 'AbortError')
    })

    await expect(
      resolveDatabricksCredentialToken('cred-1', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
