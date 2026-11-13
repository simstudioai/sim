/**
 * @vitest-environment node
 */

import {
  createHash,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  X509Certificate,
} from 'node:crypto'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { sleep } from '@sim/utils/helpers'
import { decodeProtectedHeader, jwtVerify } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/credentials/workload-identity/issuer', () => ({
  isWorkloadIdentityConfigured: async () => true,
  mintWorkloadIdentityToken: async ({ subject, audience }: { subject: string; audience: string }) =>
    `sim-oidc|${audience}|${subject}`,
}))

import { credential } from '@sim/db/schema'
import {
  MicrosoftAppCredentialError,
  resolveMicrosoftAppCredentialToken,
  resolveMicrosoftAppResourceToken,
  verifyAndEncryptMicrosoftAppCredential,
} from '@/lib/credentials/microsoft-app-service-account.server'
import { issueWorkloadIdentitySubject } from '@/lib/credentials/workload-identity/subject'
import { MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

/** DER type-length-value, for the one self-signed certificate below. */
function der(tag: number, ...parts: Buffer[]): Buffer {
  const content = Buffer.concat(parts)
  const length =
    content.length < 0x80
      ? Buffer.from([content.length])
      : content.length < 0x100
        ? Buffer.from([0x81, content.length])
        : Buffer.from([0x82, content.length >> 8, content.length & 0xff])
  return Buffer.concat([Buffer.from([tag]), length, content])
}

function derOid(oid: string): Buffer {
  const [first, second, ...rest] = oid.split('.').map(Number)
  const bytes = [first * 40 + second]
  for (const arc of rest) {
    const septets = [arc & 0x7f]
    for (let value = arc >> 7; value > 0; value >>= 7) septets.unshift((value & 0x7f) | 0x80)
    bytes.push(...septets)
  }
  return der(0x06, Buffer.from(bytes))
}

function derUtcTime(date: Date): Buffer {
  const text = date.toISOString().replace(/[-:T]/g, '').slice(2, 14)
  return der(0x17, Buffer.from(`${text}Z`))
}

const DAY_MS = 86_400_000

/**
 * A self-signed RSA certificate (CN=sim-test-app) generated for this test run,
 * so no key material is committed.
 */
function generateTestCertificate(
  validity: { notBefore: number; notAfter: number } = {
    notBefore: Date.now() - DAY_MS,
    notAfter: Date.now() + 365 * DAY_MS,
  }
): { certificate: string; privateKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const sha256WithRsa = der(0x30, derOid('1.2.840.113549.1.1.11'), der(0x05))
  const name = der(
    0x30,
    der(0x31, der(0x30, derOid('2.5.4.3'), der(0x0c, Buffer.from('sim-test-app'))))
  )
  const tbs = der(
    0x30,
    der(0xa0, der(0x02, Buffer.from([0x02]))),
    der(0x02, Buffer.from([0x01])),
    sha256WithRsa,
    name,
    der(0x30, derUtcTime(new Date(validity.notBefore)), derUtcTime(new Date(validity.notAfter))),
    name,
    publicKey.export({ type: 'spki', format: 'der' })
  )
  const signature = createSign('sha256').update(tbs).sign(privateKey)
  const certificate = der(0x30, tbs, sha256WithRsa, der(0x03, Buffer.from([0x00]), signature))
  const pem = (label: string, body: Buffer) =>
    `-----BEGIN ${label}-----\n${body
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n')}\n-----END ${label}-----`
  return {
    certificate: pem('CERTIFICATE', certificate),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

const { certificate: TEST_CERTIFICATE, privateKey: TEST_PRIVATE_KEY } = generateTestCertificate()

const TENANT = '11111111-2222-3333-4444-555555555555'
const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const SECRET = 'entra-secret-value~123'
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`
const ENVIRONMENT = 'https://contoso.api.crm.dynamics.com'
const owner = { workspaceId: 'ws-1', actorUserId: 'user-1' }

interface TokenRequest {
  url: string
  form: Record<string, string>
  redirect: RequestRedirect | undefined
}

/**
 * A fake Entra token endpoint plus Graph and Dataverse. `acceptAssertion`
 * decides whether a client assertion is trusted; every other request succeeds.
 */
function fakeMicrosoft(
  fetch: ReturnType<typeof vi.fn>,
  options: {
    acceptAssertion?: (assertion: string) => boolean
    tokenError?: Response
    /** Refusals answered to the first token requests, in order, before Entra starts issuing tokens. */
    tokenErrorsFirst?: Response[]
    /** Settles when Entra answers each token request; the caller drives it on its fake clock. */
    tokenDelay?: () => Promise<void>
  } = {}
) {
  const tokenRequests: TokenRequest[] = []
  const pendingErrors = [...(options.tokenErrorsFirst ?? [])]
  fetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/oauth2/v2.0/token')) {
      const form = Object.fromEntries(new URLSearchParams(String(init.body)))
      tokenRequests.push({ url, form, redirect: init.redirect })
      await options.tokenDelay?.()
      if (options.tokenError) return options.tokenError.clone()
      const pendingError = pendingErrors.shift()
      if (pendingError) return pendingError
      if (form.client_assertion && options.acceptAssertion?.(form.client_assertion) === false) {
        return jsonResponse(
          { error: 'invalid_client', error_codes: [700213], error_description: 'AADSTS700213: …' },
          400
        )
      }
      return jsonResponse({
        token_type: 'Bearer',
        expires_in: 3599,
        access_token: `at:${form.scope}`,
      })
    }
    if (url.includes('/v1.0/servicePrincipals(')) {
      return jsonResponse({ id: 'sp-object-id', appId: CLIENT_ID, displayName: 'Sim workflows' })
    }
    if (url.endsWith('/api/data/v9.2/WhoAmI')) return jsonResponse({ UserId: 'app-user' })
    return jsonResponse({}, 404)
  })
  return tokenRequests
}

function save(config: Record<string, unknown>, saver = owner) {
  return verifyAndEncryptMicrosoftAppCredential(
    JSON.stringify({ tenantId: TENANT, clientId: CLIENT_ID, ...config }),
    saver
  )
}

describe('saving a Microsoft app credential', () => {
  const fetch = vi.fn()

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
    encryptionMockFns.mockEncryptSecret.mockReset()
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
  })

  it('exchanges a client secret at the tenant’s token endpoint and reads the app’s own service principal', async () => {
    const tokens = fakeMicrosoft(fetch)

    await expect(save({ authType: 'client_secret', clientSecret: SECRET })).resolves.toMatchObject({
      displayName: 'Sim workflows',
      servicePrincipalId: 'sp-object-id',
    })
    expect(tokens).toEqual([
      {
        url: TOKEN_URL,
        redirect: 'error',
        form: {
          client_id: CLIENT_ID,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
          client_secret: SECRET,
        },
      },
    ])
    expect(fetch).toHaveBeenCalledWith(
      `https://graph.microsoft.com/v1.0/servicePrincipals(appId='${CLIENT_ID}')?$select=id,appId,displayName`,
      expect.objectContaining({ redirect: 'error' })
    )
  })

  it('signs a PS256 certificate assertion Entra can verify with the uploaded certificate', async () => {
    const tokens = fakeMicrosoft(fetch)

    await save({
      authType: 'certificate',
      certificate: TEST_CERTIFICATE,
      privateKey: TEST_PRIVATE_KEY,
    })

    const assertion = tokens[0]?.form.client_assertion ?? ''
    expect(tokens[0]?.form).toMatchObject({
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    })
    expect(tokens[0]?.form.client_secret).toBeUndefined()
    const certificate = new X509Certificate(TEST_CERTIFICATE)
    expect(decodeProtectedHeader(assertion)).toEqual({
      alg: 'PS256',
      typ: 'JWT',
      'x5t#S256': createHash('sha256').update(certificate.raw).digest('base64url'),
    })
    const { payload } = await jwtVerify(assertion, createPublicKey(TEST_CERTIFICATE), {
      algorithms: ['PS256'],
      audience: TOKEN_URL,
      issuer: CLIENT_ID,
      subject: CLIENT_ID,
    })
    expect(payload.jti).toEqual(expect.any(String))
    expect((payload.exp ?? 0) - (payload.nbf ?? 0)).toBeLessThanOrEqual(600)
  })

  it('refuses a private key that does not belong to the certificate before contacting Entra', async () => {
    fakeMicrosoft(fetch)
    const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString()

    await expect(
      save({ authType: 'certificate', certificate: TEST_CERTIFICATE, privateKey: otherKey })
    ).rejects.toThrow(/does not belong to this certificate/)
    expect(fetch).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('refuses a certificate that is not valid yet before contacting Entra', async () => {
    fakeMicrosoft(fetch)
    const future = generateTestCertificate({
      notBefore: Date.now() + 2 * DAY_MS,
      notAfter: Date.now() + 365 * DAY_MS,
    })

    await expect(save({ authType: 'certificate', ...future })).rejects.toThrow(/not valid until/)
    expect(fetch).not.toHaveBeenCalled()
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  describe('keyless', () => {
    const SUBJECT = 'sim:workspace:ws-1:credential:abcdef0123456789'
    const reconnectOwner = {
      ...owner,
      storedSecret: {
        type: 'microsoft_app_credential_v1',
        config: { authType: 'federated', tenantId: TENANT, clientId: CLIENT_ID, subject: SUBJECT },
      },
    }

    it('presents a Sim token for this credential’s subject with the Entra exchange audience', async () => {
      const tokens = fakeMicrosoft(fetch, {
        acceptAssertion: (assertion) => assertion.endsWith(`|${SUBJECT}`),
      })

      await expect(save({ authType: 'federated' }, reconnectOwner)).resolves.toMatchObject({
        displayName: 'Sim workflows',
      })
      const used = tokens.map((request) => request.form.client_assertion)
      expect(used).toContain(`sim-oidc|api://AzureADTokenExchange|${SUBJECT}`)
    })

    it('reports a newly issued subject so the save can check no other credential holds it', async () => {
      const grant = issueWorkloadIdentitySubject('microsoft', { workspaceId: 'ws-1' }, 'user-1')
      fakeMicrosoft(fetch, {
        acceptAssertion: (assertion) =>
          assertion.endsWith(`|${grant.subject}`) || assertion.endsWith(`|${SUBJECT}`),
      })

      await expect(
        save({ authType: 'federated', subject: grant.subject, subjectProof: grant.subjectProof })
      ).resolves.toMatchObject({ newSubject: grant.subject })
      await expect(save({ authType: 'federated' }, reconnectOwner)).resolves.not.toHaveProperty(
        'newSubject'
      )
    })

    it('refuses an app that also accepts a subject no credential holds', async () => {
      fakeMicrosoft(fetch, { acceptAssertion: () => true })

      await expect(save({ authType: 'federated' }, reconnectOwner)).rejects.toThrow(
        /also trusts other Sim credentials/
      )
      expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
    })

    it('refuses a subject issued to another member, without contacting Entra', async () => {
      fakeMicrosoft(fetch)
      const grant = issueWorkloadIdentitySubject('microsoft', { workspaceId: 'ws-1' }, 'user-2')

      await expect(
        save({ authType: 'federated', subject: grant.subject, subjectProof: grant.subjectProof })
      ).rejects.toThrow(/belongs to someone else/)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('names the federated credential mismatch when Entra rejects the subject', async () => {
      fakeMicrosoft(fetch, { acceptAssertion: () => false })

      await expect(save({ authType: 'federated' }, reconnectOwner)).rejects.toThrow(
        /No federated credential on this app matches/
      )
    })

    const CUSTOM_AUDIENCE = 'api://contoso-sim-exchange'
    const storedConfig = () =>
      JSON.parse(String(encryptionMockFns.mockEncryptSecret.mock.calls[0]?.[0])).config

    it('verifies and probes the subject pin with a custom audience, and stores it', async () => {
      const tokens = fakeMicrosoft(fetch, {
        acceptAssertion: (assertion) => assertion === `sim-oidc|${CUSTOM_AUDIENCE}|${SUBJECT}`,
      })

      await save({ authType: 'federated', audience: ` ${CUSTOM_AUDIENCE} ` }, reconnectOwner)

      const assertions = tokens.map((request) => request.form.client_assertion)
      expect(assertions).toHaveLength(2)
      for (const assertion of assertions) {
        expect(assertion.startsWith(`sim-oidc|${CUSTOM_AUDIENCE}|`)).toBe(true)
      }
      expect(storedConfig()).toMatchObject({ audience: CUSTOM_AUDIENCE, subject: SUBJECT })
    })

    it('stores no audience when the default is submitted, so earlier releases still read it', async () => {
      const tokens = fakeMicrosoft(fetch, {
        acceptAssertion: (assertion) => assertion.endsWith(`|${SUBJECT}`),
      })

      await save({ authType: 'federated', audience: 'api://AzureADTokenExchange' }, reconnectOwner)

      expect(tokens.map((request) => request.form.client_assertion)).toContain(
        `sim-oidc|api://AzureADTokenExchange|${SUBJECT}`
      )
      expect(storedConfig()).toEqual({
        authType: 'federated',
        tenantId: TENANT,
        clientId: CLIENT_ID,
        subject: SUBJECT,
      })
    })

    it('refuses another cloud’s default audience without contacting Entra', async () => {
      fakeMicrosoft(fetch)

      await expect(
        save({ authType: 'federated', audience: 'sts.amazonaws.com' }, reconnectOwner)
      ).rejects.toThrow(/belongs to another cloud/)
      expect(fetch).not.toHaveBeenCalled()
      expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
    })

    it('names the audience it presented when no federated credential matches', async () => {
      fakeMicrosoft(fetch, { acceptAssertion: () => false })

      await expect(
        save({ authType: 'federated', audience: CUSTOM_AUDIENCE }, reconnectOwner)
      ).rejects.toThrow(CUSTOM_AUDIENCE)
    })
  })

  it('verifies the Dataverse environment with its own token and WhoAmI', async () => {
    const tokens = fakeMicrosoft(fetch)

    await save({
      authType: 'client_secret',
      clientSecret: SECRET,
      environmentUrl: 'https://contoso.crm.dynamics.com/',
    })

    expect(tokens.map((request) => request.form.scope)).toEqual([
      'https://graph.microsoft.com/.default',
      `${ENVIRONMENT}/.default`,
    ])
    expect(fetch).toHaveBeenCalledWith(
      `${ENVIRONMENT}/api/data/v9.2/WhoAmI`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer at:${ENVIRONMENT}/.default` }),
      })
    )
  })

  it.each([
    'https://evil.example.com',
    'https://contoso.crm.dynamics.com.evil.example.com',
    'https://contoso.crm.dynamics.com/api/data',
    'http://contoso.crm.dynamics.com',
    'https://user@contoso.crm.dynamics.com',
  ])('refuses the environment %s without sending a token anywhere', async (environmentUrl) => {
    fakeMicrosoft(fetch)

    await expect(
      save({ authType: 'client_secret', clientSecret: SECRET, environmentUrl })
    ).rejects.toThrow(/Dataverse environment URL/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['common', 'organizations', '../evil', 'contoso.onmicrosoft.com/x'])(
    'refuses the tenant %s',
    async (tenantId) => {
      await expect(
        verifyAndEncryptMicrosoftAppCredential(
          JSON.stringify({
            tenantId,
            clientId: CLIENT_ID,
            authType: 'client_secret',
            clientSecret: SECRET,
          }),
          owner
        )
      ).rejects.toThrow(/tenant/)
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  describe('in a national cloud', () => {
    it('signs in at the cloud’s own Entra endpoint and reads the service principal from its Graph', async () => {
      const tokens = fakeMicrosoft(fetch)

      await save({ authType: 'client_secret', clientSecret: SECRET, cloud: 'usgov_dod' })

      expect(tokens.map(({ url, form }) => [url, form.scope])).toEqual([
        [
          `https://login.microsoftonline.us/${TENANT}/oauth2/v2.0/token`,
          'https://dod-graph.microsoft.us/.default',
        ],
      ])
      expect(fetch).toHaveBeenCalledWith(
        `https://dod-graph.microsoft.us/v1.0/servicePrincipals(appId='${CLIENT_ID}')?$select=id,appId,displayName`,
        expect.objectContaining({ redirect: 'error' })
      )
      expect(fetch.mock.calls.map(([url]) => String(url))).not.toContainEqual(
        expect.stringContaining('microsoftonline.com')
      )
      const stored = JSON.parse(encryptionMockFns.mockEncryptSecret.mock.calls[0]?.[0] ?? '{}')
      expect(stored.config.cloud).toBe('usgov_dod')
    })

    it('addresses the certificate assertion to the cloud’s token endpoint', async () => {
      const tokens = fakeMicrosoft(fetch)

      await save({
        authType: 'certificate',
        certificate: TEST_CERTIFICATE,
        privateKey: TEST_PRIVATE_KEY,
        cloud: 'china',
      })

      const chinaTokenUrl = `https://login.partner.microsoftonline.cn/${TENANT}/oauth2/v2.0/token`
      expect(tokens[0]?.url).toBe(chinaTokenUrl)
      await expect(
        jwtVerify(tokens[0]?.form.client_assertion ?? '', createPublicKey(TEST_CERTIFICATE), {
          algorithms: ['PS256'],
          audience: chinaTokenUrl,
        })
      ).resolves.toBeDefined()
    })

    it('stores a global credential exactly as before, with no cloud field', async () => {
      fakeMicrosoft(fetch)

      await save({ authType: 'client_secret', clientSecret: SECRET, cloud: 'global' })

      const stored = JSON.parse(encryptionMockFns.mockEncryptSecret.mock.calls[0]?.[0] ?? '{}')
      expect(stored.config).not.toHaveProperty('cloud')
    })

    it('refuses a Dataverse environment outside the global cloud before contacting Entra', async () => {
      fakeMicrosoft(fetch)

      await expect(
        save({
          authType: 'client_secret',
          clientSecret: SECRET,
          cloud: 'usgov',
          environmentUrl: ENVIRONMENT,
        })
      ).rejects.toThrow(/global cloud/)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('refuses a cloud Sim does not know', async () => {
      await expect(
        save({ authType: 'client_secret', clientSecret: SECRET, cloud: 'germany' })
      ).rejects.toThrow(MicrosoftAppCredentialError)
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it('never repeats the secret, key, or assertion in a refusal', async () => {
    fakeMicrosoft(fetch, {
      tokenError: jsonResponse(
        {
          error: 'invalid_client',
          error_codes: [7000215],
          error_description: `AADSTS7000215: bad secret ${SECRET} ${TEST_PRIVATE_KEY}`,
        },
        401
      ),
    })

    for (const config of [
      { authType: 'client_secret', clientSecret: SECRET },
      { authType: 'certificate', certificate: TEST_CERTIFICATE, privateKey: TEST_PRIVATE_KEY },
    ]) {
      const error: Error = await save(config).catch((caught) => caught)
      expect(error.message).toMatch(/Microsoft Entra/)
      expect(error.message).not.toContain(SECRET)
      expect(error.message).not.toContain('PRIVATE KEY')
      expect(error.message).not.toContain('eyJ')
    }
  })
})

describe('getting a Microsoft app token for a run', () => {
  const fetch = vi.fn()

  function storeCredential(config: Record<string, unknown>, encrypted = 'ciphertext-a') {
    resetDbChainMock()
    queueTableRows(credential, [
      {
        workspaceId: 'ws-1',
        organizationId: null,
        type: 'service_account',
        providerId: MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
        revokedAt: null,
        encryptedServiceAccountKey: encrypted,
      },
    ])
    encryptionMockFns.mockDecryptSecret.mockResolvedValueOnce({
      decrypted: JSON.stringify({
        type: 'microsoft_app_credential_v1',
        config: { tenantId: TENANT, clientId: CLIENT_ID, ...config },
      }),
    })
  }

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
    encryptionMockFns.mockDecryptSecret.mockReset()
  })

  it.each(['outlook', 'onedrive', 'microsoft-teams', undefined])(
    'refuses to mint for %s before reading the credential',
    async (service) => {
      await expect(resolveMicrosoftAppCredentialToken('cred-1', service)).rejects.toMatchObject({
        code: 'invalid_credentials',
      })
      expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('mints a Dataverse token for the stored environment and returns that environment', async () => {
    const tokens = fakeMicrosoft(fetch)
    storeCredential(
      { authType: 'client_secret', clientSecret: SECRET, environmentUrl: ENVIRONMENT },
      'ciphertext-dataverse'
    )

    await expect(
      resolveMicrosoftAppCredentialToken('cred-dataverse', 'microsoft-dataverse')
    ).resolves.toEqual({ accessToken: `at:${ENVIRONMENT}/.default`, instanceUrl: ENVIRONMENT })
    expect(tokens.map((request) => request.form.scope)).toEqual([`${ENVIRONMENT}/.default`])
  })

  it('mints a Microsoft Graph token for Intune, shared with the other Graph services', async () => {
    const tokens = fakeMicrosoft(fetch)
    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-intune')
    await expect(
      resolveMicrosoftAppCredentialToken('cred-intune', 'microsoft-intune')
    ).resolves.toEqual({ accessToken: 'at:https://graph.microsoft.com/.default' })
    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-intune')
    await resolveMicrosoftAppCredentialToken('cred-intune', 'microsoft-ad')

    expect(tokens.map((request) => request.form.scope)).toEqual([
      'https://graph.microsoft.com/.default',
    ])
  })

  it('mints a Power BI token beside the Graph one, each cached under its own audience', async () => {
    const tokens = fakeMicrosoft(fetch)
    for (const service of ['microsoft-ad', 'microsoft-powerbi', 'microsoft-powerbi']) {
      storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-powerbi')
      await resolveMicrosoftAppCredentialToken('cred-powerbi', service)
    }

    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-powerbi')
    await expect(
      resolveMicrosoftAppCredentialToken('cred-powerbi', 'microsoft-powerbi')
    ).resolves.toEqual({ accessToken: 'at:https://analysis.windows.net/powerbi/api/.default' })
    expect(tokens.map((request) => request.form.scope)).toEqual([
      'https://graph.microsoft.com/.default',
      'https://analysis.windows.net/powerbi/api/.default',
    ])
  })

  it('refuses a national-cloud credential for Power BI, whose tools call the global service', async () => {
    fakeMicrosoft(fetch)
    storeCredential(
      { authType: 'client_secret', clientSecret: SECRET, cloud: 'china' },
      'ciphertext-powerbi-china'
    )

    await expect(
      resolveMicrosoftAppCredentialToken('cred-powerbi-china', 'microsoft-powerbi')
    ).rejects.toMatchObject({ code: 'cloud_mismatch', status: 400 })
    expect(fetch).not.toHaveBeenCalled()
  })

  describe('for a resource the tool operation chooses per call', () => {
    const CLUSTER = 'https://help.westus.kusto.windows.net'
    const adx = (resource: string, clouds: ('global' | 'usgov' | 'usgov_dod' | 'china')[]) => ({
      resource,
      clouds,
      serviceLabel: 'Azure Data Explorer',
    })
    const RUN_SCOPE = { workspaceId: 'ws-1' }

    it('hands the executor the credential ID, not a token, when it authorizes the service', async () => {
      fakeMicrosoft(fetch)
      storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-adx-auth')

      await expect(
        resolveMicrosoftAppCredentialToken('cred-adx', 'azure-data-explorer')
      ).resolves.toEqual({ accessToken: 'cred-adx' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it('authorizes the service without decrypting the stored secret', async () => {
      storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-adx-nokey')
      encryptionMockFns.mockDecryptSecret
        .mockReset()
        .mockRejectedValue(new Error('key unavailable'))

      await expect(
        resolveMicrosoftAppCredentialToken('cred-adx-nokey', 'azure-data-explorer')
      ).resolves.toEqual({ accessToken: 'cred-adx-nokey' })
    })

    it.each([
      ['another workspace', { workspaceId: 'ws-2' }],
      ['no owner scope', {}],
    ])(
      'refuses a credential for a run in %s, without decrypting or minting',
      async (_label, scope) => {
        fakeMicrosoft(fetch)
        storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-adx-scope')

        await expect(
          resolveMicrosoftAppResourceToken('cred-adx-scope', scope, adx(CLUSTER, ['global']))
        ).rejects.toThrow(/unavailable/)
        expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
        expect(fetch).not.toHaveBeenCalled()
      }
    )

    it('refuses to authorize an unavailable credential for it', async () => {
      resetDbChainMock()
      queueTableRows(credential, [])

      await expect(
        resolveMicrosoftAppCredentialToken('cred-missing', 'azure-data-explorer')
      ).rejects.toThrow(/unavailable/)
    })

    it('mints a token for each cluster audience, cached per cluster', async () => {
      const tokens = fakeMicrosoft(fetch)
      const other = 'https://other.eastus.kusto.windows.net'
      for (const resource of [CLUSTER, other, CLUSTER]) {
        storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-adx')
        await expect(
          resolveMicrosoftAppResourceToken('cred-adx-mint', RUN_SCOPE, adx(resource, ['global']))
        ).resolves.toBe(`at:${resource}/.default`)
      }
      expect(tokens.map(({ url, form }) => [url, form.scope])).toEqual([
        [TOKEN_URL, `${CLUSTER}/.default`],
        [TOKEN_URL, `${other}/.default`],
      ])
    })

    it('signs in at the national cloud the credential names', async () => {
      const tokens = fakeMicrosoft(fetch)
      storeCredential(
        { authType: 'client_secret', clientSecret: SECRET, cloud: 'china' },
        'ciphertext-adx-china'
      )
      const cluster = 'https://mycluster.chinaeast2.kusto.chinacloudapi.cn'

      await resolveMicrosoftAppResourceToken('cred-adx-china', RUN_SCOPE, adx(cluster, ['china']))
      expect(tokens.map(({ url, form }) => [url, form.scope])).toEqual([
        [
          `https://login.partner.microsoftonline.cn/${TENANT}/oauth2/v2.0/token`,
          `${cluster}/.default`,
        ],
      ])
    })

    it('does not serve a cached cluster token to a call whose cluster is in no cloud of the credential', async () => {
      const tokens = fakeMicrosoft(fetch)
      storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-adx-mixed')
      await resolveMicrosoftAppResourceToken('cred-adx-mixed', RUN_SCOPE, adx(CLUSTER, ['global']))
      storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-adx-mixed')

      await expect(
        resolveMicrosoftAppResourceToken('cred-adx-mixed', RUN_SCOPE, adx(CLUSTER, []))
      ).rejects.toMatchObject({ code: 'cloud_mismatch' })
      expect(tokens).toHaveLength(1)
    })

    it('refuses a resource outside the credential’s cloud without minting', async () => {
      fakeMicrosoft(fetch)
      storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-adx-gov')

      await expect(
        resolveMicrosoftAppResourceToken(
          'cred-adx-gov',
          RUN_SCOPE,
          adx('https://mycluster.usgovvirginia.kusto.usgovcloudapi.net', ['usgov', 'usgov_dod'])
        )
      ).rejects.toMatchObject({ code: 'cloud_mismatch', status: 400 })
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([
      `${CLUSTER}/v1/rest/query`,
      `${CLUSTER}:8443`,
      'http://help.westus.kusto.windows.net',
      `${CLUSTER}/`,
      'help.westus.kusto.windows.net',
    ])('refuses the audience %s before reading the credential', async (resource) => {
      await expect(
        resolveMicrosoftAppResourceToken('cred-adx-bad', RUN_SCOPE, adx(resource, ['global']))
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it('refuses Dataverse for a credential saved without an environment', async () => {
    fakeMicrosoft(fetch)
    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-graph-only')

    await expect(
      resolveMicrosoftAppCredentialToken('cred-graph-only', 'microsoft-dataverse')
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('serves a cached token without decrypting the stored secret again', async () => {
    const tokens = fakeMicrosoft(fetch)
    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-hit')
    await resolveMicrosoftAppCredentialToken('cred-hit', 'microsoft-ad')
    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-hit')
    encryptionMockFns.mockDecryptSecret.mockReset().mockRejectedValue(new Error('key unavailable'))

    await expect(resolveMicrosoftAppCredentialToken('cred-hit', 'sharepoint')).resolves.toEqual({
      accessToken: 'at:https://graph.microsoft.com/.default',
    })
    expect(tokens).toHaveLength(1)
  })

  it('reuses a minted Graph token until the stored secret changes', async () => {
    const tokens = fakeMicrosoft(fetch)
    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-v1')
    await resolveMicrosoftAppCredentialToken('cred-cache', 'microsoft-ad')
    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-v1')
    await resolveMicrosoftAppCredentialToken('cred-cache', 'sharepoint')
    expect(tokens).toHaveLength(1)
    encryptionMockFns.mockDecryptSecret.mockReset()

    storeCredential({ authType: 'client_secret', clientSecret: 'rotated' }, 'ciphertext-v2')
    await resolveMicrosoftAppCredentialToken('cred-cache', 'sharepoint')
    expect(tokens).toHaveLength(2)
    expect(tokens[1]?.form.client_secret).toBe('rotated')
  })

  it.each(['microsoft-ad', 'sharepoint', 'microsoft-intune', 'microsoft-dataverse'])(
    'refuses a national-cloud credential for %s, whose tools call the global cloud, without minting',
    async (service) => {
      fakeMicrosoft(fetch)
      storeCredential(
        { authType: 'client_secret', clientSecret: SECRET, cloud: 'usgov' },
        `ciphertext-usgov-${service}`
      )

      await expect(
        resolveMicrosoftAppCredentialToken(`cred-usgov-${service}`, service)
      ).rejects.toMatchObject({ code: 'cloud_mismatch', status: 400 })
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('asks for a reconnect once the stored certificate has expired, without contacting Entra', async () => {
    fakeMicrosoft(fetch)
    const expired = generateTestCertificate({
      notBefore: Date.now() - 400 * DAY_MS,
      notAfter: Date.now() - DAY_MS,
    })
    storeCredential({ authType: 'certificate', ...expired }, 'ciphertext-expired-certificate')

    await expect(
      resolveMicrosoftAppCredentialToken('cred-expired-certificate', 'microsoft-ad')
    ).rejects.toMatchObject({ code: 'invalid_credentials', status: 400 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports an unreachable Entra as the provider being unavailable', async () => {
    fetch.mockRejectedValue(new TypeError('fetch failed'))
    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-unreachable')

    await expect(
      resolveMicrosoftAppCredentialToken('cred-unreachable', 'microsoft-ad')
    ).rejects.toMatchObject({ code: 'provider_unavailable', status: 502 })
  })

  describe('a keyless credential at run time', () => {
    const SUBJECT = 'sim:workspace:ws-1:credential:abcdef0123456789'

    it('presents the default audience, then the stored custom one, never a token cached for the old one', async () => {
      const tokens = fakeMicrosoft(fetch)
      storeCredential({ authType: 'federated', subject: SUBJECT }, 'ciphertext-aud-before')
      await resolveMicrosoftAppCredentialToken('cred-aud-change', 'microsoft-ad')
      storeCredential(
        { authType: 'federated', subject: SUBJECT, audience: 'api://contoso-sim' },
        'ciphertext-aud-after'
      )
      await resolveMicrosoftAppCredentialToken('cred-aud-change', 'microsoft-ad')

      expect(tokens.map((request) => request.form.client_assertion)).toEqual([
        `sim-oidc|api://AzureADTokenExchange|${SUBJECT}`,
        `sim-oidc|api://contoso-sim|${SUBJECT}`,
      ])
    })
  })

  describe('while a new federated credential propagates', () => {
    const SUBJECT = 'sim:workspace:ws-1:credential:abcdef0123456789'
    const refusal = (code: number) =>
      jsonResponse(
        {
          error: 'invalid_client',
          error_codes: [code],
          error_description: `AADSTS${code}: No matching federated identity record found for presented assertion.`,
        },
        400
      )

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function settle<T>(promise: Promise<T>): Promise<T> {
      const settled = promise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      )
      await vi.runAllTimersAsync()
      const outcome = await settled
      if ('error' in outcome) throw outcome.error
      return outcome.value
    }

    it('retries an AADSTS70021 refusal and returns the token Entra then issues', async () => {
      const tokens = fakeMicrosoft(fetch, { tokenErrorsFirst: [refusal(70021), refusal(70021)] })
      storeCredential({ authType: 'federated', subject: SUBJECT }, 'ciphertext-propagating')

      await expect(
        settle(resolveMicrosoftAppCredentialToken('cred-propagating', 'microsoft-ad'))
      ).resolves.toEqual({ accessToken: 'at:https://graph.microsoft.com/.default' })
      expect(tokens).toHaveLength(3)
    })

    it('does not retry AADSTS700213, the documented case-sensitive mismatch', async () => {
      const tokens = fakeMicrosoft(fetch, { tokenErrorsFirst: [refusal(700213)] })
      storeCredential({ authType: 'federated', subject: SUBJECT }, 'ciphertext-mismatched')

      await expect(
        settle(resolveMicrosoftAppCredentialToken('cred-mismatched', 'microsoft-ad'))
      ).rejects.toMatchObject({
        code: 'invalid_credentials',
        logDetail: { reason: 'AADSTS700213' },
      })
      expect(tokens).toHaveLength(1)
    })

    it('stops retrying when a slow Entra would push the run past the shared mint deadline', async () => {
      const tokens = fakeMicrosoft(fetch, {
        tokenError: refusal(70021),
        tokenDelay: () => sleep(11_000),
      })
      storeCredential({ authType: 'federated', subject: SUBJECT }, 'ciphertext-slow-refusal')

      await expect(
        settle(resolveMicrosoftAppCredentialToken('cred-slow-refusal', 'microsoft-ad'))
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(tokens).toHaveLength(1)
    })

    it('asks for a reconnect once the retries are spent', async () => {
      const tokens = fakeMicrosoft(fetch, { tokenError: refusal(70021) })
      storeCredential({ authType: 'federated', subject: SUBJECT }, 'ciphertext-never-matches')

      await expect(
        settle(resolveMicrosoftAppCredentialToken('cred-never-matches', 'microsoft-ad'))
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(tokens).toHaveLength(3)
    })

    it('does not retry any other refusal', async () => {
      const tokens = fakeMicrosoft(fetch, { tokenError: refusal(700016) })
      storeCredential({ authType: 'federated', subject: SUBJECT }, 'ciphertext-unknown-app')

      await expect(
        settle(resolveMicrosoftAppCredentialToken('cred-unknown-app', 'microsoft-ad'))
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(tokens).toHaveLength(1)
    })

    it('does not retry the same refusal for a client secret credential', async () => {
      const tokens = fakeMicrosoft(fetch, { tokenError: refusal(70021) })
      storeCredential(
        { authType: 'client_secret', clientSecret: SECRET },
        'ciphertext-secret-70021'
      )

      await expect(
        settle(resolveMicrosoftAppCredentialToken('cred-secret-70021', 'microsoft-ad'))
      ).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(tokens).toHaveLength(1)
    })
  })

  it('reports an Entra outage as the provider being unavailable, not a bad credential', async () => {
    fakeMicrosoft(fetch, { tokenError: jsonResponse({ error: 'temporarily_unavailable' }, 503) })
    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-outage')

    await expect(
      resolveMicrosoftAppCredentialToken('cred-outage', 'microsoft-ad')
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})
