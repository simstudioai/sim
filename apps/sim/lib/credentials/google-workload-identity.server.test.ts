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
const SIGN_JWT_URL = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(SA_EMAIL)}:signJwt`
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
]
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive',
]
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly'
const GMAIL_PROFILE = 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
const CALENDAR_LIST = 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1'
const DRIVE_ABOUT = 'https://www.googleapis.com/drive/v3/about?fields=user'
const WORKSPACE_READS = [GMAIL_PROFILE, CALENDAR_LIST, DRIVE_ABOUT]
const WORKSPACE_USER = 'alice@example.com'

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
    /** Who may call signJwt; defaults to `canImpersonate`. */
    canSign?: (subject: string) => boolean
    stsError?: Response
    iamError?: Response
    /** Answers the OAuth token endpoint instead of issuing a delegated token. */
    tokenError?: Response
    /** Answers the OAuth token endpoint's first request only. */
    firstTokenError?: Response
    /** Answers a Workspace read instead of 200. */
    readError?: Response
    /** The provider's allowed audiences; empty accepts only its own resource name, as Google does. */
    allowedAudiences?: string[]
  } = {}
) {
  const sts: RecordedRequest[] = []
  const iam: RecordedRequest[] = []
  const signJwt: RecordedRequest[] = []
  const token: RecordedRequest[] = []
  const reads: RecordedRequest[] = []
  fetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    const record = () => ({
      url,
      headers,
      body:
        headers['content-type'] === 'application/x-www-form-urlencoded'
          ? Object.fromEntries(new URLSearchParams(String(init.body)))
          : init.body
            ? JSON.parse(String(init.body))
            : {},
      redirect: init.redirect,
    })
    if (url.endsWith(':signJwt')) {
      const request = record()
      signJwt.push(request)
      const subject = (request.headers.authorization ?? '').replace('Bearer fed:', '')
      const canSign = options.canSign ?? options.canImpersonate
      if (canSign && !canSign(subject)) {
        return jsonResponse(
          { error: { code: 403, status: 'PERMISSION_DENIED', message: 'denied' } },
          403
        )
      }
      return jsonResponse({ keyId: 'key-1', signedJwt: `signed|${request.body.payload}` })
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      const request = record()
      token.push(request)
      if (options.tokenError) return options.tokenError.clone()
      if (options.firstTokenError && token.length === 1) return options.firstTokenError.clone()
      const claims = JSON.parse(String(request.body.assertion).replace('signed|', ''))
      return jsonResponse({
        access_token: `ya29.dwd-${claims.sub}-${claims.scope}`,
        expires_in: 3599,
        token_type: 'Bearer',
      })
    }
    if (WORKSPACE_READS.some((read) => url === read)) {
      reads.push(record())
      return options.readError ? options.readError.clone() : jsonResponse({})
    }
    if (url === 'https://sts.googleapis.com/v1/token') {
      const request = record()
      sts.push(request)
      if (options.stsError) return options.stsError.clone()
      const [, audience, subject] = String(request.body.subjectToken).split('|')
      const audienceAccepted = options.allowedAudiences?.length
        ? options.allowedAudiences.includes(audience)
        : audience === `https://iam.googleapis.com/${PROVIDER_NAME}`
      if (!audienceAccepted || options.acceptSubject?.(subject) === false) {
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
  return { sts, iam, signJwt, token, reads }
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
      expect(error.message).not.toContain('sim-oidc|')
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

  it.each(['google-drive', 'gmail', 'google-sheets', 'google-ads', undefined])(
    'refuses %s, which keyless credentials do not serve, before contacting Google',
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

/**
 * Settles a resolution whose token exchange waits between retries, advancing
 * fake timers until it does.
 */
async function settleRetrying<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  let outcome: { value?: T; error?: unknown } | undefined
  promise.then(
    (value) => {
      outcome = { value }
    },
    (error: unknown) => {
      outcome = { error }
    }
  )
  for (let step = 0; !outcome && step < 200; step++) await vi.advanceTimersByTimeAsync(250)
  if (!outcome) throw new Error('The resolution never settled')
  return outcome
}

function claimsOf(request: RecordedRequest | undefined): Record<string, unknown> {
  return JSON.parse(String(request?.body.payload))
}

describe('saving a keyless credential with domain-wide delegation', () => {
  const fetch = vi.fn()
  const delegation = { user: WORKSPACE_USER, services: ['gmail', 'google-calendar'] }

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
    workloadIdentityConfigured.value = true
    encryptionMockFns.mockEncryptSecret.mockReset()
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
  })

  it('signs an assertion for the Workspace user per service, exchanges it, and reads as that user', async () => {
    const google = fakeGoogle(fetch, { canImpersonate: (subject) => subject === SUBJECT })

    await expect(
      save({ delegation: { user: 'Alice@Example.com', services: ['google-calendar', 'gmail'] } })
    ).resolves.toMatchObject({ serviceAccountEmail: SA_EMAIL, delegation })

    const own = google.signJwt.filter((r) => r.headers.authorization === `Bearer fed:${SUBJECT}`)
    expect(own.map((r) => r.url)).toEqual([SIGN_JWT_URL, SIGN_JWT_URL])
    expect(own.every((r) => r.redirect === 'error')).toBe(true)
    const [gmail, calendar] = own.map(claimsOf)
    expect(gmail).toMatchObject({
      iss: SA_EMAIL,
      sub: WORKSPACE_USER,
      aud: 'https://oauth2.googleapis.com/token',
      scope: GMAIL_SCOPES.join(' '),
    })
    expect(calendar).toMatchObject({ sub: WORKSPACE_USER, scope: CALENDAR_SCOPE })
    expect(Number(gmail.exp) - Number(gmail.iat)).toBe(3600)

    expect(google.token).toHaveLength(2)
    expect(google.token[0]).toMatchObject({
      redirect: 'error',
      body: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `signed|${own[0].body.payload}`,
      },
    })
    expect(google.reads.map((r) => [r.url, r.headers.authorization])).toEqual([
      [GMAIL_PROFILE, `Bearer ya29.dwd-${WORKSPACE_USER}-${GMAIL_SCOPES.join(' ')}`],
      [CALENDAR_LIST, `Bearer ya29.dwd-${WORKSPACE_USER}-${CALENDAR_SCOPE}`],
    ])
    expect(encryptionMockFns.mockEncryptSecret).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'google_workload_identity_v1',
        config: { ...storedConfig, delegation },
      })
    )
  })

  it('checks Drive, Docs, and Sheets, which share scopes and a read, once', async () => {
    const google = fakeGoogle(fetch, { canImpersonate: (subject) => subject === SUBJECT })

    await save({
      delegation: {
        user: WORKSPACE_USER,
        services: ['google-drive', 'google-docs', 'google-sheets'],
      },
    })

    const own = google.signJwt.filter((r) => r.headers.authorization === `Bearer fed:${SUBJECT}`)
    expect(own.map((r) => claimsOf(r).scope)).toEqual([DRIVE_SCOPES.join(' ')])
    expect(google.reads.map((r) => r.url)).toEqual([DRIVE_ABOUT])
  })

  it('names the token-creator role when the subject may impersonate but not sign', async () => {
    fakeGoogle(fetch, {
      canImpersonate: (subject) => subject === SUBJECT,
      canSign: () => false,
    })

    await expect(save({ delegation })).rejects.toThrow(
      `Grant roles/iam.serviceAccountTokenCreator on the service account to principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/subject/${SUBJECT}`
    )
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('refuses a service account another Sim subject can sign for', async () => {
    fakeGoogle(fetch, {
      canImpersonate: (subject) => subject === SUBJECT,
      canSign: () => true,
    })

    await expect(save({ delegation })).rejects.toThrow(
      /also trusts other Sim credentials.*roles\/iam\.serviceAccountTokenCreator/
    )
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('names the Admin console step and scopes when Workspace refuses the delegation', async () => {
    const google = fakeGoogle(fetch, {
      canImpersonate: (subject) => subject === SUBJECT,
      tokenError: jsonResponse(
        { error: 'unauthorized_client', error_description: 'Client is unauthorized ya29.LEAK' },
        401
      ),
    })

    const error: Error = await save({ delegation }).catch((caught) => caught)
    expect(error.message).toMatch(/domain-wide delegation/)
    expect(error.message).toContain(GMAIL_SCOPES.join(','))
    expect(error.message).toContain('(unauthorized_client)')
    expect(error.message).not.toContain('LEAK')
    expect(error.message).not.toContain('signed|')
    expect(google.reads).toHaveLength(0)
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it('names the Admin console step when Workspace denies a scope', async () => {
    fakeGoogle(fetch, {
      canImpersonate: (subject) => subject === SUBJECT,
      tokenError: jsonResponse({ error: 'access_denied' }, 403),
    })

    const error: Error = await save({ delegation }).catch((caught) => caught)
    expect(error.message).toContain('Manage Domain Wide Delegation')
    expect(error.message).toContain('(access_denied)')
  })

  it.each([
    { code: 'disabled_client', copy: /service account .* is disabled/ },
    { code: 'deleted_client', copy: /service account .* was deleted/ },
    { code: 'admin_policy_enforced', copy: /admin policies/ },
    { code: 'invalid_client', copy: /Google refused the delegated token/ },
    { code: 'org_internal', copy: /Google refused the delegated token/ },
  ])('does not send the admin to authorize scopes for $code', async ({ code, copy }) => {
    fakeGoogle(fetch, {
      canImpersonate: (subject) => subject === SUBJECT,
      tokenError: jsonResponse({ error: code }, 401),
    })

    const error: Error = await save({ delegation }).catch((caught) => caught)
    expect(error.message).toMatch(copy)
    expect(error.message).toContain(`(${code})`)
    expect(error.message).not.toContain('Manage Domain Wide Delegation')
  })

  it('names the API to enable when a delegated read is refused', async () => {
    fakeGoogle(fetch, {
      canImpersonate: (subject) => subject === SUBJECT,
      readError: jsonResponse({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403),
    })

    await expect(save({ delegation })).rejects.toThrow(/Gmail API/)
    expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
  })

  it.each([
    { user: 'not-an-email', services: ['gmail'] },
    { user: `${'a'.repeat(250)}@example.com`, services: ['gmail'] },
    { user: WORKSPACE_USER, services: [] },
    { user: WORKSPACE_USER, services: ['google-forms'] },
    { user: WORKSPACE_USER, services: ['google-bigquery'] },
    { user: WORKSPACE_USER },
    { services: ['gmail'] },
    { user: WORKSPACE_USER, services: ['gmail'], scopes: ['https://mail.google.com/'] },
  ])('refuses the delegation %o without contacting Google', async (invalid) => {
    fakeGoogle(fetch)

    await expect(save({ delegation: invalid })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('getting a delegated Google Workspace token for a run', () => {
  const fetch = vi.fn()
  const secret = JSON.stringify({
    type: 'google_workload_identity_v1',
    config: { ...storedConfig, delegation: { user: WORKSPACE_USER, services: ['gmail'] } },
  })

  function resolve(overrides: Partial<Parameters<typeof resolveGoogleWorkloadIdentityToken>[0]>) {
    return resolveGoogleWorkloadIdentityToken({
      credentialId: 'dwd-cred',
      decrypted: secret,
      secretVersion: 'v1',
      owner: { workspaceId: 'ws-1' },
      scopes: GMAIL_SCOPES,
      service: 'google-email',
      ...overrides,
    })
  }

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
  })

  it.each([
    { label: 'a tool’s provider id', service: 'google-email', credentialId: 'dwd-tool' },
    { label: 'a selector’s service id', service: 'gmail', credentialId: 'dwd-selector' },
  ])('acts as the delegated user for $label', async ({ service, credentialId }) => {
    const google = fakeGoogle(fetch)

    await expect(resolve({ service, credentialId })).resolves.toBe(
      `ya29.dwd-${WORKSPACE_USER}-${[...GMAIL_SCOPES].sort().join(' ')}`
    )
    expect(claimsOf(google.signJwt[0])).toMatchObject({ iss: SA_EMAIL, sub: WORKSPACE_USER })
    expect(google.iam).toHaveLength(0)
    expect(google.reads).toHaveLength(0)
  })

  it('accepts an Impersonated Account that names the delegated user in any case', async () => {
    fakeGoogle(fetch)

    await expect(
      resolve({ credentialId: 'dwd-same-user', impersonateEmail: 'ALICE@example.com' })
    ).resolves.toContain(WORKSPACE_USER)
  })

  it('accepts an Impersonated Account that names the delegated user with surrounding spaces', async () => {
    fakeGoogle(fetch)

    await expect(
      resolve({ credentialId: 'dwd-spaced-user', impersonateEmail: '  alice@example.com ' })
    ).resolves.toContain(WORKSPACE_USER)
  })

  it('serves the Gmail label picker with the Impersonated Account set, minting gmail.modify', async () => {
    const google = fakeGoogle(fetch)
    const gmailModify = 'https://www.googleapis.com/auth/gmail.modify'

    await expect(
      resolve({
        credentialId: 'dwd-gmail-labels',
        service: 'gmail',
        impersonateEmail: WORKSPACE_USER,
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      })
    ).resolves.toBe(`ya29.dwd-${WORKSPACE_USER}-${gmailModify}`)
    expect(claimsOf(google.signJwt[0])).toMatchObject({ sub: WORKSPACE_USER, scope: gmailModify })
  })

  it('serves the Calendar connector’s calendar.events.readonly, minting calendar', async () => {
    const google = fakeGoogle(fetch)
    const calendarSecret = JSON.stringify({
      type: 'google_workload_identity_v1',
      config: {
        ...storedConfig,
        delegation: { user: WORKSPACE_USER, services: ['google-calendar'] },
      },
    })

    await expect(
      resolve({
        credentialId: 'dwd-calendar-connector',
        decrypted: calendarSecret,
        service: 'google-calendar',
        scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
      })
    ).resolves.toBe(`ya29.dwd-${WORKSPACE_USER}-${CALENDAR_SCOPE}`)
    expect(claimsOf(google.signJwt[0])).toMatchObject({
      sub: WORKSPACE_USER,
      scope: CALENDAR_SCOPE,
    })
  })

  it('refuses another Workspace user before contacting Google', async () => {
    fakeGoogle(fetch)

    await expect(
      resolve({ credentialId: 'dwd-other-user', impersonateEmail: 'bob@example.com' })
    ).rejects.toMatchObject({ code: 'unsupported_use' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['google-forms', undefined])(
    'refuses %s, which keyless delegation does not reach, before contacting Google',
    async (service) => {
      fakeGoogle(fetch)

      await expect(
        resolve({ credentialId: `dwd-${service}`, service, scopes: GMAIL_SCOPES })
      ).rejects.toMatchObject({ code: 'unsupported_use' })
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it.each(['google-calendar', 'google-drive'])(
    'refuses %s scopes a Gmail-only delegation does not authorize, before contacting Google',
    async (service) => {
      fakeGoogle(fetch)

      await expect(
        resolve({ credentialId: `dwd-${service}`, service, scopes: [CALENDAR_SCOPE] })
      ).rejects.toMatchObject({ code: 'unsupported_use' })
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('authorizes by scope, as Google does: a Sheets delegation serves a Docs block', async () => {
    const google = fakeGoogle(fetch)
    const sheetsOnly = JSON.stringify({
      type: 'google_workload_identity_v1',
      config: {
        ...storedConfig,
        delegation: { user: WORKSPACE_USER, services: ['google-sheets'] },
      },
    })

    await expect(
      resolve({
        credentialId: 'dwd-sheets-for-docs',
        decrypted: sheetsOnly,
        service: 'google-docs',
        scopes: DRIVE_SCOPES,
      })
    ).resolves.toContain(WORKSPACE_USER)
    expect(google.signJwt).toHaveLength(1)
  })

  it('still mints a service account token for a Google Cloud service', async () => {
    const google = fakeGoogle(fetch)

    await expect(
      resolve({ credentialId: 'dwd-bq', service: 'google-bigquery', scopes: [BIGQUERY] })
    ).resolves.toBe(`ya29.sa-token-for-${BIGQUERY}`)
    expect(google.signJwt).toHaveLength(0)
    expect(google.iam[0]?.url).toBe(IMPERSONATE_URL)
  })

  it('reuses a delegated token per credential, user, and scopes', async () => {
    const google = fakeGoogle(fetch)
    await resolve({ credentialId: 'dwd-cache' })
    await resolve({ credentialId: 'dwd-cache', service: 'gmail' })
    expect(google.signJwt).toHaveLength(1)

    await resolve({ credentialId: 'dwd-cache', scopes: [GMAIL_SCOPES[1]] })
    expect(google.signJwt).toHaveLength(2)

    await resolve({ credentialId: 'dwd-cache', secretVersion: 'v2' })
    expect(google.signJwt).toHaveLength(3)
  })

  it('never answers a service account request with a delegated token of the same scopes', async () => {
    fakeGoogle(fetch)
    const delegated = await resolve({ credentialId: 'dwd-identity', scopes: [GMAIL_SCOPES[1]] })
    const own = await resolve({
      credentialId: 'dwd-identity',
      service: 'vertex-ai',
      scopes: [GMAIL_SCOPES[1]],
    })

    expect(delegated).toBe(`ya29.dwd-${WORKSPACE_USER}-${GMAIL_SCOPES[1]}`)
    expect(own).toBe(`ya29.sa-token-for-${GMAIL_SCOPES[1]}`)
  })

  it.each([
    { label: 'a Gmail metadata-only scope', service: 'google-email', scope: 'gmail.metadata' },
    {
      label: 'an admin-mode connector',
      service: 'google-email',
      scope: 'admin.directory.user.readonly',
    },
    { label: 'a scope outside Google Workspace', service: 'gmail', scope: 'cloud-platform' },
  ])(
    'refuses $label whose scopes the delegation does not authorize, before contacting Google',
    async ({ service, scope }) => {
      fakeGoogle(fetch)

      await expect(
        resolve({
          credentialId: `dwd-scope-${scope}`,
          service,
          scopes: [`https://www.googleapis.com/auth/${scope}`],
        })
      ).rejects.toMatchObject({ code: 'unsupported_use' })
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('refuses a read-only scope whose read-write scope the delegation does not authorize', async () => {
    fakeGoogle(fetch)

    await expect(
      resolve({
        credentialId: 'dwd-gmail-drive-readonly',
        service: 'google-drive',
        scopes: [DRIVE_READONLY],
      })
    ).rejects.toMatchObject({ code: 'unsupported_use' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['google-docs', 'google-sheets'])(
    'serves the Drive file picker for a credential delegated only for %s, minting the authorized Drive scope',
    async (delegated) => {
      const google = fakeGoogle(fetch)
      const docsOnly = JSON.stringify({
        type: 'google_workload_identity_v1',
        config: { ...storedConfig, delegation: { user: WORKSPACE_USER, services: [delegated] } },
      })

      await expect(
        resolve({
          credentialId: `dwd-picker-${delegated}`,
          decrypted: docsOnly,
          service: 'google-drive',
          scopes: [DRIVE_READONLY],
        })
      ).resolves.toBe(`ya29.dwd-${WORKSPACE_USER}-${DRIVE_SCOPE}`)
      expect(claimsOf(google.signJwt[0])).toMatchObject({ sub: WORKSPACE_USER, scope: DRIVE_SCOPE })
    }
  )

  it('retries a token endpoint outage the way a JSON key’s exchange does', async () => {
    const google = fakeGoogle(fetch, {
      firstTokenError: jsonResponse({ error: 'internal_failure' }, 503),
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { value } = await settleRetrying(resolve({ credentialId: 'dwd-retry' }))
      expect(value).toContain(WORKSPACE_USER)
      expect(google.token).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    {
      label: 'a refused signature',
      google: { canSign: () => false },
      code: 'invalid_credentials',
    },
    {
      label: 'Workspace refusing the client',
      google: { tokenError: jsonResponse({ error: 'unauthorized_client' }, 401) },
      code: 'invalid_credentials',
    },
    {
      label: 'an unavailable token endpoint',
      google: { tokenError: jsonResponse({ error: 'internal_failure' }, 503) },
      code: 'provider_unavailable',
    },
  ])('reports $label in the shared service-account codes', async ({ label, google, code }) => {
    fakeGoogle(fetch, google)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { error } = await settleRetrying(resolve({ credentialId: `dwd-${label}` }))
      expect(error).toMatchObject({ code })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('reading a stored keyless secret', () => {
  const fetch = vi.fn()

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
  })

  function resolveWith(decrypted: string, overrides: { service: string; scopes: string[] }) {
    return resolveGoogleWorkloadIdentityToken({
      credentialId: `stored-${overrides.service}-${decrypted.length}`,
      decrypted,
      secretVersion: 'v1',
      owner: { workspaceId: 'ws-1' },
      ...overrides,
    })
  }

  const withLaterService = JSON.stringify({
    type: 'google_workload_identity_v1',
    config: {
      ...storedConfig,
      delegation: { user: WORKSPACE_USER, services: ['gmail', 'google-keep'] },
    },
  })

  it('keeps Google Cloud tokens working when a later release delegated a service this one does not know', async () => {
    const google = fakeGoogle(fetch)

    await expect(
      resolveWith(withLaterService, { service: 'google-bigquery', scopes: [BIGQUERY] })
    ).resolves.toBe(`ya29.sa-token-for-${BIGQUERY}`)
    expect(google.iam[0]?.url).toBe(IMPERSONATE_URL)
  })

  it('still acts as the delegated user for the services it knows', async () => {
    fakeGoogle(fetch)

    await expect(
      resolveWith(withLaterService, { service: 'google-email', scopes: GMAIL_SCOPES })
    ).resolves.toContain(WORKSPACE_USER)
  })

  it('authorizes nothing for the service it does not know', async () => {
    fakeGoogle(fetch)

    await expect(
      resolveWith(withLaterService, {
        service: 'google-keep',
        scopes: ['https://www.googleapis.com/auth/keep'],
      })
    ).rejects.toMatchObject({ code: 'unsupported_use' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'invalid JSON', decrypted: '{' },
    {
      label: 'a delegation field it does not know',
      decrypted: JSON.stringify({
        type: 'google_workload_identity_v1',
        config: {
          ...storedConfig,
          delegation: { user: WORKSPACE_USER, services: ['gmail'], onlyLabels: ['x'] },
        },
      }),
    },
  ])('refuses $label in the shared service-account codes', async ({ decrypted }) => {
    fakeGoogle(fetch)

    await expect(
      resolveWith(decrypted, { service: 'google-bigquery', scopes: [BIGQUERY] })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('a keyless credential with its own audience', () => {
  const fetch = vi.fn()
  const CUSTOM_AUDIENCE = 'https://sim.example.com/acme-prod'
  const customSecret = JSON.stringify({
    type: 'google_workload_identity_v1',
    config: { ...storedConfig, audience: CUSTOM_AUDIENCE },
  })

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
    workloadIdentityConfigured.value = true
    encryptionMockFns.mockEncryptSecret.mockReset()
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
  })

  it('signs the verification and the pin probe for that audience, still exchanging at the provider', async () => {
    const google = fakeGoogle(fetch, {
      allowedAudiences: [CUSTOM_AUDIENCE],
      acceptSubject: (subject) => subject === SUBJECT,
    })

    await expect(save({ audience: ` ${CUSTOM_AUDIENCE} ` })).resolves.toMatchObject({
      serviceAccountEmail: SA_EMAIL,
    })
    expect(google.sts.length).toBeGreaterThanOrEqual(2)
    for (const request of google.sts) {
      expect(String(request.body.subjectToken).split('|')[1]).toBe(CUSTOM_AUDIENCE)
      expect(request.body.audience).toBe(`//iam.googleapis.com/${PROVIDER_NAME}`)
    }
    expect(google.sts.some((request) => !String(request.body.subjectToken).endsWith(SUBJECT))).toBe(
      true
    )
    expect(encryptionMockFns.mockEncryptSecret).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'google_workload_identity_v1',
        config: { ...storedConfig, audience: CUSTOM_AUDIENCE },
      })
    )
  })

  it('refuses the pin when a stray subject is accepted for that audience', async () => {
    fakeGoogle(fetch, { allowedAudiences: [CUSTOM_AUDIENCE] })

    await expect(save({ audience: CUSTOM_AUDIENCE })).rejects.toThrow(
      /also trusts other Sim credentials/
    )
  })

  it.each([`https://iam.googleapis.com/${PROVIDER_NAME}`, `//iam.googleapis.com/${PROVIDER_NAME}`])(
    'stores no audience when %s, the provider’s own name, is submitted',
    async (audience) => {
      fakeGoogle(fetch, { acceptSubject: (subject) => subject === SUBJECT })

      await expect(save({ audience })).resolves.toMatchObject({ serviceAccountEmail: SA_EMAIL })
      expect(encryptionMockFns.mockEncryptSecret).toHaveBeenCalledWith(
        JSON.stringify({ type: 'google_workload_identity_v1', config: storedConfig })
      )
    }
  )

  it('refuses another cloud’s default audience without contacting Google', async () => {
    fakeGoogle(fetch)

    await expect(save({ audience: 'sts.amazonaws.com' })).rejects.toThrow(
      /belongs to another cloud/
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('names the custom audience to allow when STS refuses the token', async () => {
    fakeGoogle(fetch)

    await expect(save({ audience: CUSTOM_AUDIENCE })).rejects.toThrow(
      `with ${CUSTOM_AUDIENCE} in its allowed audiences`
    )
  })

  it('names the provider’s own name when STS refuses a default-audience token', async () => {
    fakeGoogle(fetch, { allowedAudiences: [CUSTOM_AUDIENCE] })

    await expect(save({})).rejects.toThrow(
      `with no allowed audiences, or with https://iam.googleapis.com/${PROVIDER_NAME} among them`
    )
  })

  it('mints run tokens for the stored audience', async () => {
    const google = fakeGoogle(fetch, { allowedAudiences: [CUSTOM_AUDIENCE] })

    await expect(
      resolveGoogleWorkloadIdentityToken({
        credentialId: 'cred-custom-audience',
        decrypted: customSecret,
        secretVersion: 'v1',
        owner: { workspaceId: 'ws-1' },
        scopes: [BIGQUERY],
        service: 'google-bigquery',
      })
    ).resolves.toBe(`ya29.sa-token-for-${BIGQUERY}`)
    expect(google.sts[0]?.body.subjectToken).toBe(`sim-oidc|${CUSTOM_AUDIENCE}|${SUBJECT}`)
  })
})
