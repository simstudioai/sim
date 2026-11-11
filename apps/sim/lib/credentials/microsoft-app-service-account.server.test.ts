/**
 * @vitest-environment node
 */

import { createHash, createPublicKey, generateKeyPairSync, X509Certificate } from 'node:crypto'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { decodeProtectedHeader, jwtVerify } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/credentials/workload-identity/issuer', () => ({
  isWorkloadIdentityConfigured: async () => true,
  mintWorkloadIdentityToken: async ({ subject, audience }: { subject: string; audience: string }) =>
    `sim-oidc|${audience}|${subject}`,
}))

import { credential } from '@sim/db/schema'
import {
  resolveMicrosoftAppCredentialToken,
  verifyAndEncryptMicrosoftAppCredential,
} from '@/lib/credentials/microsoft-app-service-account.server'
import { issueWorkloadIdentitySubject } from '@/lib/credentials/workload-identity/subject'
import { MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

/** A throwaway self-signed test certificate (CN=sim-test-app) and its key; not used anywhere real. */
const TEST_CERTIFICATE = [
  '-----BEGIN CERTIFICATE-----',
  'MIIC8DCCAdigAwIBAgIUQscAay/pQghX1nRRknLCHHuel/EwDQYJKoZIhvcNAQEL',
  'BQAwFzEVMBMGA1UEAwwMc2ltLXRlc3QtYXBwMCAXDTI2MTExMDIzNDY1NVoYDzIx',
  'MjYxMDE3MjM0NjU1WjAXMRUwEwYDVQQDDAxzaW0tdGVzdC1hcHAwggEiMA0GCSqG',
  'SIb3DQEBAQUAA4IBDwAwggEKAoIBAQCWiZIqbXoaCMuDVJK8lAWogeXpcfbmlCAm',
  'MnPJNSz751gOsfbHMOBLRaQp5fPqjqNodFw72R4Dpa4aETco5l4JlLUrRToK+y4m',
  'BCDMN6vwyS+4GTJmO2nX1yvEEhYtHphqg/htnVxRoSzB08G0Bb/64CHe0X+DWs6M',
  'CHtfyC9YTG+oc8S8N6Cw1BKV4o+v1C0yEDTjK77qS6YdulAVMjBfhz1cIBLzU/Uy',
  '0Fzm7TAE/9h6gHODYxLW2POJeLPQ7uZBzT6uBDL4wYDWrk1iUK2TuTO+6GouKvoU',
  'tYv2N4i7KKXur5wpbxDlNWUzBp0B4ozgR0K83Qteq02RShAoiyElAgMBAAGjMjAw',
  'MB0GA1UdDgQWBBTVLn0q75C2SHJFPqk4VfXcvH9YWjAPBgNVHRMBAf8EBTADAQH/',
  'MA0GCSqGSIb3DQEBCwUAA4IBAQBw3E87CJJs23t9GKlsh35nuVoHzXyJQXwjn32G',
  'B6W87h58n/RnrBRRbCzwrGjXHlu6XsT2pwlBKdEezikaajmJhmYAVOSPbvHalnXt',
  'TqpY9uvRl/RLnyEe36Y+BrYlr2MoWdsR8etj4aepBzJ8gxq6/tpHiq8ijqR2peCV',
  'QZ/9UuoT8fub9DDxMMrwMmGT8hHGOvTh6342yl6EQkKLgV0klUDtfJLA5wPiitTZ',
  'pdq7nWlDBGpX5MF1WumpW4CM30s7VAi+HuJZSI1AGg0akTfvcyirDUS/GtUoTwq0',
  '/l8LVPe6TsEitCqMpetndCmQ1Y/2TN56MV5Ce1YSkqtYZxi3',
  '-----END CERTIFICATE-----',
].join('\n')
const TEST_PRIVATE_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCWiZIqbXoaCMuD',
  'VJK8lAWogeXpcfbmlCAmMnPJNSz751gOsfbHMOBLRaQp5fPqjqNodFw72R4Dpa4a',
  'ETco5l4JlLUrRToK+y4mBCDMN6vwyS+4GTJmO2nX1yvEEhYtHphqg/htnVxRoSzB',
  '08G0Bb/64CHe0X+DWs6MCHtfyC9YTG+oc8S8N6Cw1BKV4o+v1C0yEDTjK77qS6Yd',
  'ulAVMjBfhz1cIBLzU/Uy0Fzm7TAE/9h6gHODYxLW2POJeLPQ7uZBzT6uBDL4wYDW',
  'rk1iUK2TuTO+6GouKvoUtYv2N4i7KKXur5wpbxDlNWUzBp0B4ozgR0K83Qteq02R',
  'ShAoiyElAgMBAAECggEASV7H1NIC/wlmV54y3qKul1CohD09f2iWusdAU8MNJ8G7',
  '0329r5wM1eMdfiZL2fingFOmWK0byd9Imf/mCJMvJjBKlMpq3ctK1NCSQ7amoPcN',
  'wQbW36j5j2+aLzg5gsg0tUWZIaPeyRJrRBU3hcx/o4D2QSmOorDxlqLTrv1cxgXL',
  'SlnXPZqAHG6oJl8xLjWnb57ju3Y/qCGLCKAEkiCwVXosEOtxpTZmQc5a7SVVoFI0',
  'oZCZyL8vhp96tKPg/Lm3BmontxS+B58QCfMRJs+6SXIZzUa07NjlHjz8PnXVqzVK',
  'pf510iOW+yO+rtBb0CA6oHai5MN39c4xNxR0mvFryQKBgQDTc6Wr6pQFQ9NN/INf',
  'sJIjRrF6wy2iIscjyUjymyhsKxAFtxs0iVVhZUqxCpfPLH80S6qYodVDf+S9KSN9',
  'EI1Yjda4Py9MWtfWYB5smPMprcqQS/UsM0tsRZImmT7r1cES5vVUiN5SQrSqV5cb',
  'GbhHfSRnYiwzDci81SHXBE4iewKBgQC2QJfn70t/amJVB1YeXrRL8urHL5KxWYAn',
  '6JtiPHXg8ZajUav/zBugUeKaFqUmEedlXe9UlDChf4PzRxk0PwFE3a1Z+XaX0KsC',
  '0rx6ZNsofbllX51z+CpxI930SFtuUsd2FmKmg6+PPz7BeQJDsbrpQ0Khr8ELaAed',
  'ydk8DDHI3wKBgQCiudYeZmlBYAAGfTSQ+G6ObUH6SqgcpY0BUk8sPRGvpLgw3cg2',
  '9xVY3b3MX22SxxihozWHPsvDpXHfzP/9qDZOluFOa3m31hVSaigfxNklExTXVU05',
  'lcQOb7/YqoiMr7RlGo5kXuxQ+/rTOJMWDQYPJhRU521CYPJBt/fR5ANJbwKBgQCk',
  'IcXsRdBbPmayJrpC/Y0n/Ou9WLWmbHEC//O347VRUKEWEj5xTtLubfBCTvSKNYOM',
  'Aa3BIPgu6VTe6f/j0n4FFBLDPeu0y2LHVxwQqfXJIHivuA1n3G30mJWSIvvcfkZN',
  'rdlIFr4rpoyQ1rbYWh53ZnCChnK3IAgD7T1rW5wWRwKBgQC2z0nf+2BAGkTYJcIr',
  '7L36kA9k5jno2jWyYmtRmQJr3IN7BFLexor6n4Q/nLIrZrstOgq84Sh3rAhTTh+i',
  'k4YG+ftqbkRwp7RKDpJ3s7mAC0qgNNKhnZAbDEDpmOV79sYch8v1UXw07q2mM5Hj',
  'xS26LDt+YfIj/cwD+QkcBvZfwA==',
  '-----END PRIVATE KEY-----',
].join('\n')

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
  options: { acceptAssertion?: (assertion: string) => boolean; tokenError?: Response } = {}
) {
  const tokenRequests: TokenRequest[] = []
  fetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (url.startsWith('https://login.microsoftonline.com/')) {
      const form = Object.fromEntries(new URLSearchParams(String(init.body)))
      tokenRequests.push({ url, form, redirect: init.redirect })
      if (options.tokenError) return options.tokenError.clone()
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
    if (url.startsWith('https://graph.microsoft.com/')) {
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

  it('refuses Dataverse for a credential saved without an environment', async () => {
    fakeMicrosoft(fetch)
    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-graph-only')

    await expect(
      resolveMicrosoftAppCredentialToken('cred-graph-only', 'microsoft-dataverse')
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(fetch).not.toHaveBeenCalled()
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

  it('reports an Entra outage as the provider being unavailable, not a bad credential', async () => {
    fakeMicrosoft(fetch, { tokenError: jsonResponse({ error: 'temporarily_unavailable' }, 503) })
    storeCredential({ authType: 'client_secret', clientSecret: SECRET }, 'ciphertext-outage')

    await expect(
      resolveMicrosoftAppCredentialToken('cred-outage', 'microsoft-ad')
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})
