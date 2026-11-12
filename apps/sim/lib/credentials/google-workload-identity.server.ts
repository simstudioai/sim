import { getErrorMessage } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { z } from 'zod'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  GOOGLE_DELEGATION_SERVICES,
  GOOGLE_KEYLESS_SERVICES,
  GOOGLE_WORKLOAD_IDENTITY_SECRET_TYPE,
  type GoogleDelegationService,
  googleDelegationScopes,
  googleDelegationServiceFor,
  googleStsAudience,
  googleWorkloadIdentityAudience,
  googleWorkloadIdentityPrincipal,
  googleWorkloadIdentityProviderName,
  googleWorkloadIdentityRole,
  isGoogleDelegationUser,
  isGoogleProjectNumber,
  isGoogleServiceAccountEmail,
  isGoogleWorkloadIdentityId,
} from '@/lib/credentials/google-workload-identity'
import { parseServiceAccountConfig } from '@/lib/credentials/service-account-config'
import {
  providerFailureCode,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import {
  isWorkloadIdentityConfigured,
  mintWorkloadIdentityToken,
  type WorkloadIdentityOwner,
} from '@/lib/credentials/workload-identity/issuer'
import {
  bindWorkloadIdentitySubject,
  newWorkloadIdentitySubject,
  type WorkloadIdentityCredentialOwner,
  WorkloadIdentityNotConfiguredError,
} from '@/lib/credentials/workload-identity/subject'

/**
 * Keyless Google Cloud credentials: Workload Identity Federation with service
 * account impersonation. Sim signs a short-lived token for the credential's own
 * subject, Google STS exchanges it for a federated token on the customer's
 * workload identity provider, and the federated token calls
 * `generateAccessToken` for the service account.
 *
 * Impersonation rather than direct federated access: some Google Cloud APIs
 * don't accept federated tokens, and impersonation gives the same identity
 * (the service account and its IAM roles) that JSON-key credentials use, so
 * BigQuery and Vertex AI behave exactly as they do with a key.
 *
 * With domain-wide delegation the federated token instead asks IAM to sign a
 * JWT-bearer assertion for the service account with `sub` set to the delegated
 * Workspace user, and Google's OAuth token endpoint exchanges it: the same
 * assertion a JSON key signs locally, signed by a Google-managed key instead.
 *
 * @see https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
 * @see https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token
 * @see https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken
 * @see https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/signJwt
 * @see https://developers.google.com/identity/protocols/oauth2/service-account
 */

const SUBMITTED_AUTH_TYPE = 'workload_identity' as const

const STS_TOKEN_URL = 'https://sts.googleapis.com/v1/token'
const IAM_CREDENTIALS_ORIGIN = 'https://iamcredentials.googleapis.com'
/** The JWT-bearer `aud`, which Google documents as always this URL. */
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
/** A JWT-bearer assertion's `exp` may be at most one hour after its `iat`. */
const ASSERTION_LIFETIME_SECONDS = 3600
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'
const JWT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt'
/** generateAccessToken's default and, without an organization policy change, its maximum. */
const SERVICE_ACCOUNT_TOKEN_LIFETIME = '3600s'
const REQUEST_TIMEOUT_MS = 15_000
/** `google.subject` "Cannot exceed 127 bytes". */
const MAX_GOOGLE_SUBJECT_BYTES = 127

/** Re-mint once less than this much of a token's lifetime remains. */
const TOKEN_REUSE_MARGIN_MS = 5 * 60 * 1000
const TOKEN_CACHE_MAX = 10_000

/** OAuth token endpoint error codes safe to show; descriptions stay out of the message. */
const DELEGATION_DIAGNOSTIC_ERRORS = new Set([
  'access_denied',
  'admin_policy_enforced',
  'invalid_grant',
  'invalid_scope',
  'unauthorized_client',
])

/**
 * A cheap read per delegated service, made with the delegated token when the
 * credential is saved: it proves the API is enabled for the service account's
 * project and the user can use it. Docs and Sheets reach their files through
 * Drive and share its scopes; their own APIs have no call that needs no file.
 */
const DRIVE_READ = {
  api: 'Google Drive API',
  url: 'https://www.googleapis.com/drive/v3/about?fields=user',
}
const DELEGATION_READS: Record<GoogleDelegationService, { api: string; url: string }> = {
  gmail: { api: 'Gmail API', url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile' },
  'google-drive': DRIVE_READ,
  'google-docs': DRIVE_READ,
  'google-sheets': DRIVE_READ,
  'google-calendar': {
    api: 'Google Calendar API',
    url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1',
  },
}

/** STS error codes safe to show; descriptions stay out of the message. */
const STS_DIAGNOSTIC_ERRORS = new Set([
  'invalid_grant',
  'invalid_request',
  'invalid_target',
  'unauthorized_client',
  'access_denied',
])

const refShape = {
  projectNumber: z
    .string()
    .trim()
    .refine(
      isGoogleProjectNumber,
      'Enter the project number (digits only) of the project that holds the workload identity pool'
    ),
  poolId: z
    .string()
    .trim()
    .refine(
      isGoogleWorkloadIdentityId,
      'Enter the workload identity pool ID: 4-32 lowercase letters, digits, or hyphens'
    ),
  providerId: z
    .string()
    .trim()
    .refine(
      isGoogleWorkloadIdentityId,
      'Enter the workload identity provider ID: 4-32 lowercase letters, digits, or hyphens'
    ),
  serviceAccountEmail: z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      isGoogleServiceAccountEmail,
      'Enter the service account email, like name@project-id.iam.gserviceaccount.com'
    ),
}

const subjectSchema = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_GOOGLE_SUBJECT_BYTES)

const delegationUserSchema = z.string().refine(isGoogleDelegationUser)

/** The stored delegation: one Workspace user, and the services it may be used for. */
const storedDelegationSchema = z
  .object({
    user: delegationUserSchema,
    services: z.array(z.enum(GOOGLE_DELEGATION_SERVICES)).min(1),
  })
  .strict()

type GoogleDelegation = z.infer<typeof storedDelegationSchema>

/** Absent on every credential saved without delegation, so their stored secret is unchanged. */
const storedConfigSchema = z
  .object({ ...refShape, subject: subjectSchema, delegation: storedDelegationSchema.optional() })
  .strict()

type GoogleWorkloadIdentityConfig = z.infer<typeof storedConfigSchema>

const submittedDelegationSchema = z
  .object({
    user: z
      .string()
      .trim()
      .toLowerCase()
      .refine(isGoogleDelegationUser, 'Enter the email address of the Google Workspace user'),
    services: z
      .array(
        z.enum(GOOGLE_DELEGATION_SERVICES, {
          message: `Choose Google Workspace services from: ${GOOGLE_DELEGATION_SERVICES.join(', ')}`,
        })
      )
      .min(1, 'Choose at least one Google Workspace service')
      .transform((services) =>
        GOOGLE_DELEGATION_SERVICES.filter((service) => services.includes(service))
      ),
  })
  .strict()

const submittedConfigSchema = z
  .object({
    authType: z.literal(SUBMITTED_AUTH_TYPE),
    ...refShape,
    subject: z.string().min(1).max(512).optional(),
    subjectProof: z.string().min(1).max(512).optional(),
    delegation: submittedDelegationSchema.optional(),
  })
  .strict()

const storedSecretSchema = z
  .object({ type: z.literal(GOOGLE_WORKLOAD_IDENTITY_SECRET_TYPE), config: storedConfigSchema })
  .strict()

/** A configuration problem Sim can name the fix for; its message is shown to the person saving. */
export class GoogleWorkloadIdentityError extends Error {
  /** @param status The HTTP status Google answered with, when Google itself refused. */
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'GoogleWorkloadIdentityError'
  }
}

/** Whether a submitted Google service-account configuration is the keyless mode. */
export function isGoogleWorkloadIdentitySubmission(serialized: string): boolean {
  try {
    const parsed: unknown = JSON.parse(serialized)
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { authType?: unknown }).authType === SUBMITTED_AUTH_TYPE
    )
  } catch {
    return false
  }
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ status: number; payload: Record<string, unknown> }> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      // A token must never follow a redirect off the Google host it was meant for.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new GoogleWorkloadIdentityError('Could not reach Google Cloud. Try again.')
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  return { status: response.status, payload: payload ?? {} }
}

async function postForm(
  url: string,
  body: Record<string, string>
): Promise<{ status: number; payload: Record<string, unknown> }> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new GoogleWorkloadIdentityError('Could not reach Google. Try again.')
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  return { status: response.status, payload: payload ?? {} }
}

function isProviderOutage(status: number): boolean {
  return providerFailureCode(status) === 'provider_unavailable'
}

const STS_REFUSED_MESSAGE =
  'Google Cloud refused Sim’s token for this workload identity provider. Check the project number, pool ID, and provider ID; that the provider is enabled and is an OIDC provider for the issuer from Sim (the connect dialog or `sim credentials keyless-subject`), with no allowed audiences and the attribute mapping google.subject=assertion.sub; and that its attribute condition allows this credential’s subject.'

/** Copy for an STS refusal. Only Google's documented issuer-connection error is matched by text. */
function stsFailureMessage(status: number, payload: Record<string, unknown>): string {
  if (isProviderOutage(status)) return 'Google Cloud STS is unavailable. Try again.'
  const description = typeof payload.error_description === 'string' ? payload.error_description : ''
  if (description.includes('Error connecting to the given credential')) {
    return 'Google Cloud could not fetch the signing keys from Sim’s issuer. The issuer must be reachable over public HTTPS.'
  }
  const code = typeof payload.error === 'string' ? payload.error : ''
  return STS_DIAGNOSTIC_ERRORS.has(code) ? `${STS_REFUSED_MESSAGE} (${code})` : STS_REFUSED_MESSAGE
}

/**
 * Exchanges a Sim token for this subject at Google STS. The audience is the
 * credential's own provider; the subject token's `aud` is that provider's
 * resource name, which a provider with no allowed audiences accepts.
 */
async function exchangeSubjectToken(
  config: GoogleWorkloadIdentityConfig,
  owner: WorkloadIdentityOwner
): Promise<string> {
  const subjectToken = await mintWorkloadIdentityToken({
    subject: config.subject,
    audience: googleWorkloadIdentityAudience(config),
    owner,
  })
  // Google asks that this request carry no Authorization header.
  const { status, payload } = await postJson(
    STS_TOKEN_URL,
    {
      grantType: TOKEN_EXCHANGE_GRANT,
      audience: googleStsAudience(config),
      scope: CLOUD_PLATFORM_SCOPE,
      requestedTokenType: ACCESS_TOKEN_TYPE,
      subjectTokenType: JWT_TOKEN_TYPE,
      subjectToken,
    },
    {}
  )
  if (status !== 200) {
    throw new GoogleWorkloadIdentityError(stsFailureMessage(status, payload), status)
  }
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new GoogleWorkloadIdentityError('Google Cloud STS answered without a token.', 502)
  }
  return payload.access_token
}

function impersonationFailureMessage(status: number, config: GoogleWorkloadIdentityConfig) {
  if (isProviderOutage(status)) return 'Google Cloud IAM is unavailable. Try again.'
  if (status === 403) {
    return `The service account ${config.serviceAccountEmail} does not let this credential impersonate it. Grant ${googleWorkloadIdentityRole(Boolean(config.delegation))} on the service account to ${googleWorkloadIdentityPrincipal(config, config.subject)}, and enable the IAM Service Account Credentials API. A new binding can take a few minutes to apply.`
  }
  if (status === 404) {
    return `Google Cloud could not find the service account ${config.serviceAccountEmail}. Check the email.`
  }
  return `Google Cloud refused to impersonate ${config.serviceAccountEmail} (HTTP ${status}).`
}

interface ServiceAccountAccessToken {
  accessToken: string
  expiresAtMs: number
}

/** Impersonates the service account with the federated token, for the given scopes. */
async function impersonateServiceAccount(
  config: GoogleWorkloadIdentityConfig,
  federatedToken: string,
  scopes: string[]
): Promise<ServiceAccountAccessToken> {
  // The `-` project wildcard is required; the email was validated when the credential was saved.
  const url = `${IAM_CREDENTIALS_ORIGIN}/v1/projects/-/serviceAccounts/${encodeURIComponent(config.serviceAccountEmail)}:generateAccessToken`
  const { status, payload } = await postJson(
    url,
    { scope: scopes, lifetime: SERVICE_ACCOUNT_TOKEN_LIFETIME },
    { Authorization: `Bearer ${federatedToken}` }
  )
  if (status !== 200) {
    throw new GoogleWorkloadIdentityError(impersonationFailureMessage(status, config), status)
  }
  if (typeof payload.accessToken !== 'string' || !payload.accessToken) {
    throw new GoogleWorkloadIdentityError('Google Cloud IAM answered without a token.', 502)
  }
  const expiresAtMs =
    typeof payload.expireTime === 'string' ? Date.parse(payload.expireTime) : Number.NaN
  return {
    accessToken: payload.accessToken,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 3600_000,
  }
}

async function mintServiceAccountToken(
  config: GoogleWorkloadIdentityConfig,
  owner: WorkloadIdentityOwner,
  scopes: string[]
): Promise<ServiceAccountAccessToken> {
  const federatedToken = await exchangeSubjectToken(config, owner)
  return impersonateServiceAccount(config, federatedToken, scopes)
}

function signFailureMessage(status: number, config: GoogleWorkloadIdentityConfig) {
  if (isProviderOutage(status)) return 'Google Cloud IAM is unavailable. Try again.'
  if (status === 403) {
    return `The service account ${config.serviceAccountEmail} does not let this credential sign for it, which domain-wide delegation needs. Grant ${googleWorkloadIdentityRole(true)} on the service account to ${googleWorkloadIdentityPrincipal(config, config.subject)}, and enable the IAM Service Account Credentials API. A new binding can take a few minutes to apply.`
  }
  if (status === 404) {
    return `Google Cloud could not find the service account ${config.serviceAccountEmail}. Check the email.`
  }
  return `Google Cloud refused to sign for ${config.serviceAccountEmail} (HTTP ${status}).`
}

/**
 * Has IAM sign the JWT-bearer assertion for `user` with the service account's
 * Google-managed key. Google requires `aud` to be its token URL and `exp` at
 * most an hour after `iat`; signJwt allows up to 12 hours.
 */
async function signDelegationAssertion(
  config: GoogleWorkloadIdentityConfig,
  federatedToken: string,
  user: string,
  scopes: string[]
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const claims = {
    iss: config.serviceAccountEmail,
    sub: user,
    scope: scopes.join(' '),
    aud: OAUTH_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
  }
  const url = `${IAM_CREDENTIALS_ORIGIN}/v1/projects/-/serviceAccounts/${encodeURIComponent(config.serviceAccountEmail)}:signJwt`
  const { status, payload } = await postJson(
    url,
    { payload: JSON.stringify(claims) },
    { Authorization: `Bearer ${federatedToken}` }
  )
  if (status !== 200) {
    throw new GoogleWorkloadIdentityError(signFailureMessage(status, config), status)
  }
  if (typeof payload.signedJwt !== 'string' || !payload.signedJwt) {
    throw new GoogleWorkloadIdentityError('Google Cloud IAM answered without a signature.', 502)
  }
  return payload.signedJwt
}

function delegationFailureMessage(
  status: number,
  payload: Record<string, unknown>,
  user: string,
  scopes: string[]
): string {
  if (isProviderOutage(status)) return 'Google’s OAuth token endpoint is unavailable. Try again.'
  const code = typeof payload.error === 'string' ? payload.error : ''
  const suffix = DELEGATION_DIAGNOSTIC_ERRORS.has(code) ? ` (${code})` : ''
  if (code === 'invalid_grant') {
    return `Google refused to sign in as ${user}${suffix}. Check that the address belongs to an active user in your Google Workspace domain.`
  }
  return `Google Workspace has not authorized this service account’s domain-wide delegation for ${user}${suffix}. In the Admin console, under Security, Access and data control, API controls, Manage Domain Wide Delegation, authorize the service account’s client ID for these scopes: ${scopes.join(',')}. A new authorization can take a while to apply.`
}

/** Exchanges a signed assertion for an access token acting as the delegated user. */
async function exchangeDelegationAssertion(
  assertion: string,
  user: string,
  scopes: string[]
): Promise<ServiceAccountAccessToken> {
  const { status, payload } = await postForm(OAUTH_TOKEN_URL, {
    grant_type: JWT_BEARER_GRANT,
    assertion,
  })
  if (status !== 200) {
    throw new GoogleWorkloadIdentityError(
      delegationFailureMessage(status, payload, user, scopes),
      status
    )
  }
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new GoogleWorkloadIdentityError('Google answered without a token.', 502)
  }
  const expiresInSeconds = typeof payload.expires_in === 'number' ? payload.expires_in : 3600
  return { accessToken: payload.access_token, expiresAtMs: Date.now() + expiresInSeconds * 1000 }
}

async function mintDelegatedToken(
  config: GoogleWorkloadIdentityConfig,
  federatedToken: string,
  user: string,
  scopes: string[]
): Promise<ServiceAccountAccessToken> {
  const assertion = await signDelegationAssertion(config, federatedToken, user, scopes)
  return exchangeDelegationAssertion(assertion, user, scopes)
}

/** Reads one cheap resource per service as the delegated user, with that service's token. */
async function verifyDelegation(
  config: GoogleWorkloadIdentityConfig,
  delegation: GoogleDelegation,
  owner: WorkloadIdentityOwner
): Promise<void> {
  const federatedToken = await exchangeSubjectToken(config, owner)
  for (const service of delegation.services) {
    const scopes = googleDelegationScopes(service)
    const { accessToken } = await mintDelegatedToken(
      config,
      federatedToken,
      delegation.user,
      scopes
    )
    const read = DELEGATION_READS[service]
    let status: number
    try {
      const response = await fetch(read.url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      status = response.status
      void response.body?.cancel().catch(() => undefined)
    } catch {
      throw new GoogleWorkloadIdentityError(`Could not reach the ${read.api}. Try again.`)
    }
    if (status === 200) continue
    if (isProviderOutage(status)) {
      throw new GoogleWorkloadIdentityError(`The ${read.api} is unavailable. Try again.`, status)
    }
    throw new GoogleWorkloadIdentityError(
      `Sim signed in as ${delegation.user}, but the ${read.api} refused the request (HTTP ${status}). Enable the ${read.api} in the project that owns ${config.serviceAccountEmail}, and check that ${delegation.user} can use the service.`,
      status
    )
  }
}

function isRefusal(error: unknown): boolean {
  return (
    error instanceof GoogleWorkloadIdentityError &&
    error.status !== undefined &&
    providerFailureCode(error.status) === 'invalid_credentials'
  )
}

/**
 * Google maps every valid token from Sim's issuer to a principal in the pool
 * unless the provider's attribute condition says otherwise, so a subject no
 * credential holds must not be able to impersonate the service account. If it
 * can (a `principalSet` binding for the whole pool, say), every Sim credential
 * could act as this service account, and saving is refused.
 */
async function assertSubjectPinned(
  config: GoogleWorkloadIdentityConfig,
  owner: WorkloadIdentityOwner
): Promise<void> {
  const stray = { ...config, subject: newWorkloadIdentitySubject(owner) }
  const unconfirmed = () =>
    new GoogleWorkloadIdentityError(
      'Sim could not confirm this service account trusts only this credential. Try again.'
    )
  /** Whether Google refused the stray subject this step. */
  const refused = async (step: () => Promise<unknown>): Promise<boolean> => {
    try {
      await step()
    } catch (error) {
      if (isRefusal(error)) return true
      throw unconfirmed()
    }
    return false
  }

  let federatedToken = ''
  if (
    await refused(async () => {
      federatedToken = await exchangeSubjectToken(stray, owner)
    })
  ) {
    return
  }
  // Delegation signs with signJwt, which the impersonation role does not grant, so a
  // pool-wide grant of either permission must be caught.
  const steps: Array<() => Promise<unknown>> = [
    () => impersonateServiceAccount(stray, federatedToken, [CLOUD_PLATFORM_SCOPE]),
  ]
  const { delegation } = config
  if (delegation) {
    steps.push(() =>
      signDelegationAssertion(
        stray,
        federatedToken,
        delegation.user,
        googleDelegationScopes(delegation.services[0])
      )
    )
  }
  for (const step of steps) {
    if (!(await refused(step))) {
      throw new GoogleWorkloadIdentityError(
        `This service account also trusts other Sim credentials. Grant ${googleWorkloadIdentityRole(Boolean(delegation))} to this credential’s principal:// subject only (not a principalSet for the pool), and add the attribute condition from Sim (the connect dialog or \`sim credentials keyless-subject\`) so the provider accepts only this subject.`
      )
    }
  }
}

function readStoredSubject(storedSecret: Record<string, unknown> | null | undefined) {
  const parsed = storedSecretSchema.safeParse(storedSecret)
  return parsed.success ? parsed.data.config.subject : undefined
}

function bindSubject(
  subject: string | undefined,
  subjectProof: string | undefined,
  owner: WorkloadIdentityCredentialOwner
): string {
  return bindWorkloadIdentitySubject({
    provider: 'google',
    owner,
    storedSubject: readStoredSubject(owner.storedSecret),
    subject,
    subjectProof,
  })
}

export interface GoogleWorkloadIdentitySaveResult {
  encryptedServiceAccountKey: string
  serviceAccountEmail: string
  /** The workload identity provider's resource name. */
  workloadIdentityProvider: string
  /** A subject this save binds that the credential did not already hold. */
  newSubject?: string
  /** The verified domain-wide delegation, when the credential was saved with one. */
  delegation?: GoogleDelegation
}

/**
 * Validates the submitted configuration, then proves it end to end: Sim's
 * token is exchanged at STS, the federated token impersonates the service
 * account, or, with domain-wide delegation, signs an assertion for the
 * Workspace user that Google exchanges for each service, and a cheap read per
 * service succeeds as that user. Alongside, a subject no credential holds must
 * be refused. Returns the encrypted blob.
 */
export async function verifyAndEncryptGoogleWorkloadIdentityCredential(
  serialized: string,
  owner: WorkloadIdentityCredentialOwner
): Promise<GoogleWorkloadIdentitySaveResult> {
  const parsed = parseServiceAccountConfig(
    serialized,
    submittedConfigSchema,
    'Google Cloud keyless credential'
  )
  if (!parsed.success) throw new GoogleWorkloadIdentityError(parsed.message)
  if (!(await isWorkloadIdentityConfigured())) {
    throw new WorkloadIdentityNotConfiguredError('Use a JSON key.')
  }
  const submitted = parsed.data
  const config: GoogleWorkloadIdentityConfig = {
    projectNumber: submitted.projectNumber,
    poolId: submitted.poolId,
    providerId: submitted.providerId,
    serviceAccountEmail: submitted.serviceAccountEmail,
    subject: bindSubject(submitted.subject, submitted.subjectProof, owner),
    ...(submitted.delegation ? { delegation: submitted.delegation } : {}),
  }
  if (!subjectSchema.safeParse(config.subject).success) {
    throw new GoogleWorkloadIdentityError('This credential’s subject is too long for Google Cloud.')
  }

  // A token from generateAccessToken proves the provider accepted Sim's token and the
  // service account lets this subject impersonate it; a delegated read proves the rest
  // of the delegation chain as well.
  const { delegation } = config
  const verify = () =>
    delegation
      ? verifyDelegation(config, delegation, owner)
      : mintServiceAccountToken(config, owner, [CLOUD_PLATFORM_SCOPE])
  // The pin probe is independent of the verification, so both run at once; a
  // verification failure still reports first.
  const [verified, pinned] = await Promise.allSettled([
    verify(),
    assertSubjectPinned(config, owner),
  ])
  if (verified.status === 'rejected') {
    if (verified.reason instanceof GoogleWorkloadIdentityError) throw verified.reason
    throw new GoogleWorkloadIdentityError(
      `Could not verify the Google Cloud keyless credential: ${getErrorMessage(verified.reason, 'Unknown error')}`
    )
  }
  if (pinned.status === 'rejected') throw pinned.reason

  const { encrypted } = await encryptSecret(
    JSON.stringify({ type: GOOGLE_WORKLOAD_IDENTITY_SECRET_TYPE, config })
  )
  return {
    encryptedServiceAccountKey: encrypted,
    serviceAccountEmail: config.serviceAccountEmail,
    workloadIdentityProvider: googleWorkloadIdentityProviderName(config),
    ...(config.subject !== readStoredSubject(owner.storedSecret)
      ? { newSubject: config.subject }
      : {}),
    ...(delegation ? { delegation } : {}),
  }
}

/**
 * Minted tokens per credential, stored-secret version, delegated user (if any),
 * and scopes: a reconnect re-encrypts the secret and so never reuses the old
 * configuration's token, and a delegated token never answers for the service
 * account's own.
 */
const tokenCache = new LRUCache<string, string>({ max: TOKEN_CACHE_MAX })

export interface ResolveGoogleWorkloadIdentityTokenInput {
  credentialId: string
  /** The credential's decrypted secret. */
  decrypted: string
  /** Changes whenever the stored secret is re-encrypted. */
  secretVersion: string
  owner: WorkloadIdentityOwner
  scopes: string[]
  /**
   * A domain-wide-delegation subject. Only a credential delegated for the
   * service accepts one, and only its own delegated user.
   */
  impersonateEmail?: string
  /** The Google service the token is for, from server-side policy. */
  service?: string
}

function unsupportedUse(step: string, reason: string): TokenServiceAccountValidationError {
  return new TokenServiceAccountValidationError('unsupported_use', 400, { step, reason })
}

/**
 * Resolves an authorized keyless Google credential to an access token. A
 * Google Cloud service gets a service account token. A Google Workspace service
 * gets a token acting as the delegated user, only when the credential was saved
 * with domain-wide delegation for that service. Anything else is refused before
 * Google is contacted.
 */
export async function resolveGoogleWorkloadIdentityToken(
  input: ResolveGoogleWorkloadIdentityTokenInput
): Promise<string> {
  const { config } = storedSecretSchema.parse(JSON.parse(input.decrypted))
  const delegatedService = googleDelegationServiceFor(input.service)
  const delegation =
    delegatedService && config.delegation?.services.includes(delegatedService)
      ? config.delegation
      : undefined

  if (delegation) {
    if (input.impersonateEmail && input.impersonateEmail.toLowerCase() !== delegation.user) {
      throw unsupportedUse(
        'google_keyless_delegation_user',
        'this keyless Google credential acts only as its delegated Workspace user'
      )
    }
  } else {
    if (input.impersonateEmail) {
      throw unsupportedUse(
        'google_keyless_delegation',
        'this keyless Google credential has no domain-wide delegation for this service'
      )
    }
    if (!input.service || !GOOGLE_KEYLESS_SERVICES.has(input.service)) {
      throw unsupportedUse(
        'google_keyless_service',
        'this keyless Google credential works only with Google Cloud APIs and the Workspace services it was delegated'
      )
    }
  }
  if (input.scopes.length === 0) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'google_keyless_scopes',
      reason: 'scopes are required for service account credentials',
    })
  }
  const scopeKey = [...new Set(input.scopes)].sort().join(' ')
  const identityKey = delegation ? `delegated:${delegation.user}` : 'service-account'
  const cacheKey = `${input.credentialId}:${input.secretVersion}:${identityKey}:${scopeKey}`
  const cached = tokenCache.get(cacheKey)
  if (cached) return cached

  // Concurrent block runs share one mint, so it is not tied to any one caller's signal.
  return coalesceLocally(`google-keyless:${cacheKey}`, async () => {
    const scopes = scopeKey.split(' ')
    let token: ServiceAccountAccessToken
    try {
      token = delegation
        ? await mintDelegatedToken(
            config,
            await exchangeSubjectToken(config, input.owner),
            delegation.user,
            scopes
          )
        : await mintServiceAccountToken(config, input.owner, scopes)
    } catch (error) {
      if (!(error instanceof GoogleWorkloadIdentityError)) throw error
      // Report in the shared service-account codes: an outage is not a bad credential.
      throw new TokenServiceAccountValidationError(
        error.status === undefined ? 'provider_unavailable' : providerFailureCode(error.status),
        error.status ?? 502,
        { step: delegation ? 'google_keyless_delegated_token' : 'google_keyless_token' }
      )
    }
    const ttl = token.expiresAtMs - Date.now() - TOKEN_REUSE_MARGIN_MS
    if (ttl > 0) tokenCache.set(cacheKey, token.accessToken, { ttl })
    return token.accessToken
  })
}
