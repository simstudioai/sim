/**
 * @vitest-environment node
 */

import { jsonResponse } from '@sim/testing/helpers/http'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { workloadIdentityConfigured } = vi.hoisted(() => ({
  workloadIdentityConfigured: { value: true },
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/credentials/workload-identity/issuer', () => ({
  isWorkloadIdentityConfigured: async () => workloadIdentityConfigured.value,
  mintWorkloadIdentityToken: async ({ subject, audience }: { subject: string; audience: string }) =>
    `sim-oidc|${audience}|${subject}`,
}))

import {
  resolveGoogleWorkloadIdentityToken,
  verifyAndEncryptGoogleWorkloadIdentityCredential,
} from '@/lib/credentials/google-workload-identity.server'
import { issueWorkloadIdentitySubject } from '@/lib/credentials/workload-identity/subject'

const PROJECT_NUMBER = '123456789012'
const POOL = 'sim-pool'
const PROVIDER = 'sim-oidc'
const SA_EMAIL = 'bq-runner@analytics-prod.iam.gserviceaccount.com'
const PROVIDER_NAME = `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}`
const SUBJECT = 'sim:workspace:ws-1:credential:abcdef0123456789'
const IMPERSONATE_URL = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(SA_EMAIL)}:generateAccessToken`
const CLOUD_PLATFORM = 'https://www.googleapis.com/auth/cloud-platform'
const BIGQUERY = 'https://www.googleapis.com/auth/bigquery'

const owner = { workspaceId: 'ws-1', actorUserId: 'user-1' }
const storedConfig = {
  projectNumber: PROJECT_NUMBER,
  poolId: POOL,
  providerId: PROVIDER,
  serviceAccountEmail: SA_EMAIL,
  subject: SUBJECT,
}
const reconnectOwner = {
  ...owner,
  storedSecret: { type: 'google_workload_identity_v1', config: storedConfig },
}

interface RecordedRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  redirect: RequestRedirect | undefined
}

/**
 * A fake Google STS and IAM Credentials. STS accepts a Sim token
 * only for the provider's own audience and for subjects `acceptSubject`
 * allows, and returns a federated token naming the subject; IAM lets the
 * subjects `canImpersonate` allows impersonate the service account.
 */
function fakeGoogle(
  fetch: ReturnType<typeof vi.fn>,
  options: {
    acceptSubject?: (subject: string) => boolean
    canImpersonate?: (subject: string) => boolean
    stsError?: Response
    iamError?: Response
  } = {}
) {
  const sts: RecordedRequest[] = []
  const iam: RecordedRequest[] = []
  fetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const record = () => ({
      url,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body ? JSON.parse(String(init.body)) : {},
      redirect: init.redirect,
    })
    if (url === 'https://sts.googleapis.com/v1/token') {
      const request = record()
      sts.push(request)
      if (options.stsError) return options.stsError.clone()
      const [, audience, subject] = String(request.body.subjectToken).split('|')
      if (
        audience !== `https://iam.googleapis.com/${PROVIDER_NAME}` ||
        options.acceptSubject?.(subject) === false
      ) {
        return jsonResponse(
          { error: 'invalid_grant', error_description: 'The audience in ID Token does not match' },
          400
        )
      }
      return jsonResponse({
        access_token: `fed:${subject}`,
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        token_type: 'Bearer',
        expires_in: 3600,
      })
    }
    if (url.startsWith('https://iamcredentials.googleapis.com/')) {
      const request = record()
      iam.push(request)
      if (options.iamError) return options.iamError.clone()
      const subject = (request.headers.authorization ?? '').replace('Bearer fed:', '')
      if (options.canImpersonate && !options.canImpersonate(subject)) {
        return jsonResponse(
          { error: { code: 403, status: 'PERMISSION_DENIED', message: 'denied' } },
          403
        )
      }
      return jsonResponse({
        accessToken: `ya29.sa-token-for-${(request.body.scope as string[]).join(',')}`,
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      })
    }
    return jsonResponse({}, 404)
  })
  return { sts, iam }
}

function save(
  config: Record<string, unknown>,
  saver: Parameters<typeof verifyAndEncryptGoogleWorkloadIdentityCredential>[1] = reconnectOwner
) {
  return verifyAndEncryptGoogleWorkloadIdentityCredential(
    JSON.stringify({
      authType: 'workload_identity',
      projectNumber: PROJECT_NUMBER,
      poolId: POOL,
      providerId: PROVIDER,
      serviceAccountEmail: SA_EMAIL,
      ...config,
    }),
    saver
  )
}

describe('saving a keyless Google Cloud credential', () => {
  const fetch = vi.fn()

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
    workloadIdentityConfigured.value = true
    encryptionMockFns.mockEncryptSecret.mockReset()
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
  })

  it('exchanges a Sim token for the provider’s audience at STS, then impersonates the service account', async () => {
    const google = fakeGoogle(fetch, { canImpersonate: (subject) => subject === SUBJECT })

    await expect(save({})).resolves.toEqual({
      encryptedServiceAccountKey: 'ciphertext',
      serviceAccountEmail: SA_EMAIL,
      workloadIdentityProvider: PROVIDER_NAME,
    })
    const exchange = google.sts.find((request) =>
      String(request.body.subjectToken).endsWith(`|${SUBJECT}`)
    )
    expect(exchange).toEqual({
      url: 'https://sts.googleapis.com/v1/token',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: {
        grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
        audience: `//iam.googleapis.com/${PROVIDER_NAME}`,
        scope: CLOUD_PLATFORM,
        requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
        subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
        subjectToken: `sim-oidc|https://iam.googleapis.com/${PROVIDER_NAME}|${SUBJECT}`,
      },
    })
    expect(google.iam).toContainEqual({
      url: IMPERSONATE_URL,
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer fed:${SUBJECT}`,
      },
      body: { scope: [CLOUD_PLATFORM], lifetime: '3600s' },
    })
    expect(encryptionMockFns.mockEncryptSecret).toHaveBeenCalledWith(
      JSON.stringify({ type: 'google_workload_identity_v1', config: storedConfig })
    )
  })

  it('names the provider settings to check when STS refuses the token', async () => {
    fakeGoogle(fetch, { acceptSubject: () => false })

    await expect(save({})).rejects.toThrow(
      /refused Sim’s token for this workload identity provider.*\(invalid_grant\)/
    )
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('names the binding to add when the subject may not impersonate the service account', async () => {
    fakeGoogle(fetch, { canImpersonate: () => false })

    await expect(save({})).rejects.toThrow(
      `Grant roles/iam.workloadIdentityUser on the service account to principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/subject/${SUBJECT}`
    )
  })

  it('refuses a service account that any Sim subject can impersonate', async () => {
    fakeGoogle(fetch)

    await expect(save({})).rejects.toThrow(/also trusts other Sim credentials/)
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'STS is unavailable for the stray subject',
      fail: (url: string, body: string) =>
        url.startsWith('https://sts.') && !body.includes(SUBJECT)
          ? jsonResponse({ error: 'temporarily_unavailable' }, 503)
          : undefined,
    },
    {
      label: 'IAM is unreachable for the stray subject',
      fail: (url: string, _body: string, auth: string) => {
        if (url.startsWith('https://iamcredentials.') && auth !== `Bearer fed:${SUBJECT}`) {
          throw new TypeError('fetch failed')
        }
        return undefined
      },
    },
  ])('refuses to save when it cannot confirm the subject is pinned: $label', async ({ fail }) => {
    fakeGoogle(fetch, { canImpersonate: (subject) => subject === SUBJECT })
    const google = fetch.getMockImplementation()
    fetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
      const auth = new Headers(init.headers).get('authorization') ?? ''
      return fail(url, String(init.body ?? ''), auth) ?? google?.(url, init)
    })

    await expect(save({})).rejects.toThrow(/could not confirm this service account trusts only/)
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('saves when the provider’s attribute condition refuses every other subject', async () => {
    const google = fakeGoogle(fetch, { acceptSubject: (subject) => subject === SUBJECT })

    await expect(save({})).resolves.toMatchObject({ serviceAccountEmail: SA_EMAIL })
    expect(google.sts.some((request) => !String(request.body.subjectToken).endsWith(SUBJECT))).toBe(
      true
    )
  })

  it('refuses a subject issued to another member, without contacting Google', async () => {
    fakeGoogle(fetch)
    const grant = issueWorkloadIdentitySubject('google', { workspaceId: 'ws-1' }, 'user-2')

    await expect(
      save({ subject: grant.subject, subjectProof: grant.subjectProof }, owner)
    ).rejects.toThrow(/belongs to someone else/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts a subject issued to the saving member', async () => {
    const grant = issueWorkloadIdentitySubject('google', { workspaceId: 'ws-1' }, 'user-1')
    fakeGoogle(fetch, { canImpersonate: (subject) => subject === grant.subject })

    await expect(
      save({ subject: grant.subject, subjectProof: grant.subjectProof }, owner)
    ).resolves.toMatchObject({ serviceAccountEmail: SA_EMAIL, newSubject: grant.subject })
  })

  it.each([
    { projectNumber: 'my-project' },
    { projectNumber: '123/locations/global/workloadIdentityPools/other' },
    { poolId: '../other-pool' },
    { poolId: 'pool/providers/other' },
    { poolId: 'gcp-reserved' },
    { poolId: 'Sim-Pool' },
    { providerId: 'p' },
    { providerId: 'prov?audience=x' },
    { serviceAccountEmail: 'someone@gmail.com' },
    { serviceAccountEmail: 'sa@evil.example.com/x.iam.gserviceaccount.com' },
    { serviceAccountEmail: 'sa@proj.iam.gserviceaccount.com:generateIdToken' },
    { serviceAccountEmail: `a@b@${SA_EMAIL}` },
  ])('refuses %o without contacting Google', async (field) => {
    fakeGoogle(fetch)

    await expect(save(field)).rejects.toThrow(/Enter the/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses keyless setup on a deployment that cannot sign tokens', async () => {
    workloadIdentityConfigured.value = false
    fakeGoogle(fetch)

    await expect(save({})).rejects.toThrow(/not available on this deployment/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never repeats a token or Google’s description in a refusal', async () => {
    const leaked = 'ya29.LEAKED-ACCESS-TOKEN'
    for (const google of [
      {
        stsError: jsonResponse(
          {
            error: 'invalid_grant',
            error_description: `bad token sim-oidc|x|${SUBJECT} ${leaked}`,
          },
          400
        ),
      },
      { iamError: jsonResponse({ error: { code: 403, message: `denied ${leaked}` } }, 403) },
    ]) {
      fakeGoogle(fetch, google)
      const error: Error = await save({}).catch((caught) => caught)
      expect(error.message).toMatch(/Google Cloud|service account/)
      expect(error.message).not.toContain(leaked)
      expect(error.message).not.toContain('sim-oidc')
      expect(error.message).not.toContain('fed:')
    }
  })
})

describe('getting a keyless Google Cloud token for a run', () => {
  const fetch = vi.fn()
  const secret = JSON.stringify({ type: 'google_workload_identity_v1', config: storedConfig })

  function resolve(overrides: Partial<Parameters<typeof resolveGoogleWorkloadIdentityToken>[0]>) {
    return resolveGoogleWorkloadIdentityToken({
      credentialId: 'cred-1',
      decrypted: secret,
      secretVersion: 'v1',
      owner: { workspaceId: 'ws-1' },
      scopes: [BIGQUERY],
      service: 'google-bigquery',
      ...overrides,
    })
  }

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
  })

  it('mints a service account token for the tool’s scopes', async () => {
    const google = fakeGoogle(fetch)

    await expect(resolve({ credentialId: 'cred-scopes' })).resolves.toBe(
      `ya29.sa-token-for-${BIGQUERY}`
    )
    expect(google.iam[0]?.body).toEqual({ scope: [BIGQUERY], lifetime: '3600s' })
  })

  it('refuses domain-wide delegation before contacting Google', async () => {
    fakeGoogle(fetch)

    await expect(
      resolve({ credentialId: 'cred-dwd', impersonateEmail: 'alice@example.com' })
    ).rejects.toMatchObject({ code: 'unsupported_use' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['google-drive', 'gmail', 'google-sheets', undefined])(
    'refuses the Workspace service %s before contacting Google',
    async (service) => {
      fakeGoogle(fetch)

      await expect(resolve({ credentialId: 'cred-workspace', service })).rejects.toMatchObject({
        code: 'unsupported_use',
      })
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('refuses a request with no scopes in the shared validation shape', async () => {
    fakeGoogle(fetch)

    await expect(resolve({ credentialId: 'cred-no-scopes', scopes: [] })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reuses a minted token until the stored secret changes', async () => {
    const google = fakeGoogle(fetch)
    await resolve({ credentialId: 'cred-cache' })
    await resolve({ credentialId: 'cred-cache', service: 'vertex-ai' })
    expect(google.iam).toHaveLength(1)

    await resolve({ credentialId: 'cred-cache', secretVersion: 'v2' })
    expect(google.iam).toHaveLength(2)
  })

  it('reports a refused impersonation as a bad credential and an outage as unavailable', async () => {
    fakeGoogle(fetch, { canImpersonate: () => false })
    await expect(resolve({ credentialId: 'cred-refused' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    })

    fakeGoogle(fetch, { stsError: jsonResponse({ error: 'quota_exceeded' }, 429) })
    await expect(resolve({ credentialId: 'cred-outage' })).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })
})
