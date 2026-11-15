/**
 * @vitest-environment node
 */

import {
  inputValidationMock,
  inputValidationMockFns,
  queueTableRows,
  resetDbChainMock,
} from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mint: vi.fn(async ({ subject }: { subject: string }) => `token-for:${subject}`),
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/credentials/workload-identity/issuer', () => ({
  isWorkloadIdentityConfigured: async () => true,
  MAX_WORKLOAD_IDENTITY_TOKEN_TTL_SECONDS: 3600,
  mintWorkloadIdentityToken: hoisted.mint,
}))

import { credential } from '@sim/db/schema'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { EgressRefusedError } from '@/lib/core/network/transport.server'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  resolveDatabricksCredentialToken,
  verifyAndEncryptDatabricksCredential,
} from '@/lib/credentials/databricks-service-account.server'
import { WorkloadIdentityNotConfiguredError } from '@/lib/credentials/workload-identity/subject'
import { DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

const owner = { workspaceId: 'ws-1', actorUserId: 'user-1' }
const secureFetch = inputValidationMockFns.mockSecureFetchWithValidation

/** A guarded-fetch reply from the workspace's SCIM `Me` endpoint. */
function scimReply(body: unknown, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok: status >= 200 && status < 300, status, text: async () => text }
}

function patConfig(host: string) {
  return JSON.stringify({ authType: 'personal_access_token', host, token: 'dapi-secret' })
}

describe('saving a Databricks connection', () => {
  const fetch = vi.fn()
  const HOST = 'dbc-1234abcd-5678.cloud.databricks.com'

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
    secureFetch.mockReset().mockResolvedValue(scimReply({ userName: 'me@example.com' }))
    encryptionMockFns.mockEncryptSecret.mockReset()
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
  })

  it('verifies through the egress guard, so the organization’s outbound route carries it', async () => {
    await expect(
      verifyAndEncryptDatabricksCredential(patConfig(HOST), owner)
    ).resolves.toMatchObject({ identity: 'me@example.com' })
    expect(secureFetch).toHaveBeenCalledWith(
      `https://${HOST}/api/2.0/preview/scim/v2/Me`,
      expect.objectContaining({ profile: 'configuredEndpoint', maxRedirects: 0 })
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses an identity reply over the size cap instead of saving the host as the identity', async () => {
    secureFetch.mockRejectedValue(
      new PayloadSizeLimitError({ label: 'response', maxBytes: 1024 * 1024 })
    )

    await expect(verifyAndEncryptDatabricksCredential(patConfig(HOST), owner)).rejects.toThrow(
      /Could not verify/
    )
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it.each([
    [
      'an IP access list',
      {
        error_code: '403',
        message:
          'Source IP address: 203.0.113.9 is blocked by Databricks IP ACL for workspace: 1234',
      },
      'Source IP address: 203.0.113.9 is blocked by Databricks IP ACL for workspace: 1234',
    ],
    [
      'a missing entitlement',
      { detail: ' User is not entitled to access this workspace ', status: '403' },
      'User is not entitled to access this workspace',
    ],
  ])(
    'names Databricks’ own reason when %s refuses the identity call',
    async (_case, body, reason) => {
      secureFetch.mockResolvedValue(scimReply(body, 403))

      await expect(verifyAndEncryptDatabricksCredential(patConfig(HOST), owner)).rejects.toThrow(
        `Could not verify the Databricks credential: workspace returned HTTP 403: ${reason}`
      )
      expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
    }
  )

  it('surfaces an unavailable egress route instead of failing verification', async () => {
    secureFetch.mockRejectedValue(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))

    await expect(
      verifyAndEncryptDatabricksCredential(patConfig(HOST), owner)
    ).rejects.toBeInstanceOf(OutboundRoutingError)
  })

  it('reports a host the egress policy refuses as not allowed', async () => {
    secureFetch.mockRejectedValue(new EgressRefusedError('url resolves to a private address'))

    await expect(verifyAndEncryptDatabricksCredential(patConfig(HOST), owner)).rejects.toThrow(
      'Could not verify the Databricks credential: the workspace host is not allowed'
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
    expect(secureFetch).not.toHaveBeenCalled()
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
      throw new Error(`unexpected fetch ${url}`)
    })
  }

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
    secureFetch.mockReset().mockResolvedValue(scimReply({ userName: 'sim-workflows' }))
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

  it('surfaces an unavailable egress route during the any-subject check instead of asking to retry', async () => {
    principalTrusting(true)
    const trusted = fetch.getMockImplementation()
    fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init?.body))
      if (url.endsWith('/oidc/v1/token') && body.get('subject_token') !== `token-for:${SUBJECT}`) {
        throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
      }
      return trusted?.(url, init)
    })

    await expect(
      verifyAndEncryptDatabricksCredential(JSON.stringify(config), reconnectOwner)
    ).rejects.toBeInstanceOf(OutboundRoutingError)
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
      throw new Error(`unexpected fetch ${url}`)
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
    secureFetch.mockReset().mockResolvedValue(scimReply({ userName: 'sim-workflows' }))
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

  it('surfaces an unavailable egress route instead of an unreachable workspace', async () => {
    fetch.mockRejectedValue(new OutboundRoutingError('GATEWAY_UNAVAILABLE'))

    await expect(resolveDatabricksCredentialToken('cred-1')).rejects.toBeInstanceOf(
      OutboundRoutingError
    )
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
