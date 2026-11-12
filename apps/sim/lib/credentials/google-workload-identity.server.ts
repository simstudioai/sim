import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
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
  googleDelegationScopesFor,
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
  storedAudienceField,
  storedWorkloadIdentityAudienceSchema,
  workloadIdentityAudienceSchema,
} from '@/lib/credentials/workload-identity/audiences'
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
import {
  exchangeGoogleServiceAccountJwt,
  GOOGLE_TOKEN_DIAGNOSTIC_ERROR_CODES,
} from '@/lib/oauth/google-service-account-transport'
import { readWriteScopeOf } from '@/lib/oauth/utils'

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

/**
 * A cheap read per delegated service, made with the delegated token when the
 * credential is saved: it proves the API is enabled for the service account's
 * project and the user can use it. Docs and Sheets share Drive's scopes and are
 * checked through the Drive API only: their own APIs have no call that needs no
 * file, so those APIs being enabled shows up only in a run.
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

/**
 * The stored delegation: one Workspace user, and the services whose scopes it
 * authorizes. Services are read as plain strings so a service a later release
 * adds leaves the credential readable here, where it authorizes nothing; any
 * other unknown field still fails the parse, since it could narrow what the
 * credential may do.
 */
const storedDelegationSchema = z
  .object({
    user: delegationUserSchema,
    services: z.array(z.string().min(1)).min(1),
  })
  .strict()

type StoredDelegation = z.infer<typeof storedDelegationSchema>

/** The delegated services this release knows, in their canonical order. */
function knownDelegatedServices(delegation: StoredDelegation): GoogleDelegationService[] {
  return GOOGLE_DELEGATION_SERVICES.filter((service) => delegation.services.includes(service))
}

/**
 * `delegation` and `audience` are absent on every credential saved without them, so
 * their stored secret is unchanged and earlier releases' strict schema still reads it.
 */
const storedConfigSchema = z
  .object({
    ...refShape,
    subject: subjectSchema,
    delegation: storedDelegationSchema.optional(),
    /** A custom `aud` for Sim's token; absent means the provider's resource name. */
    audience: storedWorkloadIdentityAudienceSchema,
  })
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

type SubmittedDelegation = z.infer<typeof submittedDelegationSchema>

const submittedConfigSchema = z
  .object({
    authType: z.literal(SUBMITTED_AUTH_TYPE),
    ...refShape,
    subject: z.string().min(1).max(512).optional(),
    subjectProof: z.string().min(1).max(512).optional(),
    delegation: submittedDelegationSchema.optional(),
    audience: workloadIdentityAudienceSchema('google').optional(),
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

/**
 * The HTTP status of a bearer-authorized GET, with the same redirect and
 * timeout guards as {@link postJson}. The body is discarded unread.
 * Undefined when Google could not be reached.
 */
async function getStatus(url: string, bearer: string): Promise<number | undefined> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    void response.body?.cancel().catch(() => undefined)
    return response.status
  } catch {
    return undefined
  }
}

function parsePayload(body: string): Record<string, unknown> {
  try {
    return toRecord(JSON.parse(body))
  } catch {
    return {}
  }
}

function isProviderOutage(status: number): boolean {
  return providerFailureCode(status) === 'provider_unavailable'
}

function stsRefusedMessage(config: GoogleWorkloadIdentityConfig): string {
  const audiences = config.audience
    ? `with ${config.audience} in its allowed audiences`
    : `with no allowed audiences, or with ${googleWorkloadIdentityAudience(config)} among them`
  return `Google Cloud refused Sim’s token for this workload identity provider. Check the project number, pool ID, and provider ID; that the provider is enabled and is an OIDC provider for the issuer from Sim (the connect dialog or \`sim credentials keyless-subject\`), ${audiences}, and the attribute mapping google.subject=assertion.sub; and that its attribute condition allows this credential’s subject.`
}

/** Copy for an STS refusal. Only Google's documented issuer-connection error is matched by text. */
function stsFailureMessage(
  status: number,
  payload: Record<string, unknown>,
  config: GoogleWorkloadIdentityConfig
): string {
  if (isProviderOutage(status)) return 'Google Cloud STS is unavailable. Try again.'
  const description = typeof payload.error_description === 'string' ? payload.error_description : ''
  if (description.includes('Error connecting to the given credential')) {
    return 'Google Cloud could not fetch the signing keys from Sim’s issuer. The issuer must be reachable over public HTTPS.'
  }
  const code = typeof payload.error === 'string' ? payload.error : ''
  const message = stsRefusedMessage(config)
  return STS_DIAGNOSTIC_ERRORS.has(code) ? `${message} (${code})` : message
}

/**
 * Exchanges a Sim token for this subject at Google STS. The STS audience is
 * always the credential's own provider. The subject token's `aud` is the
 * credential's custom audience, which the provider must list in its allowed
 * audiences, or else that provider's resource name, which a provider with no
 * allowed audiences accepts.
 */
async function exchangeSubjectToken(
  config: GoogleWorkloadIdentityConfig,
  owner: WorkloadIdentityOwner
): Promise<string> {
  const subjectToken = await mintWorkloadIdentityToken({
    subject: config.subject,
    audience: config.audience ?? googleWorkloadIdentityAudience(config),
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
    throw new GoogleWorkloadIdentityError(stsFailureMessage(status, payload, config), status)
  }
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new GoogleWorkloadIdentityError('Google Cloud STS answered without a token.', 502)
  }
  return payload.access_token
}

/**
 * Copy for an IAM Credentials refusal. Signing needs a role the impersonation
 * role lacks, so a refused signature always names the token-creator role.
 */
function iamFailureMessage(
  status: number,
  config: GoogleWorkloadIdentityConfig,
  action: 'impersonate' | 'sign'
) {
  if (isProviderOutage(status)) return 'Google Cloud IAM is unavailable. Try again.'
  if (status === 403) {
    const refusal =
      action === 'sign'
        ? 'does not let this credential sign for it, which domain-wide delegation needs'
        : 'does not let this credential impersonate it'
    const role = googleWorkloadIdentityRole(action === 'sign' || Boolean(config.delegation))
    return `The service account ${config.serviceAccountEmail} ${refusal}. Grant ${role} on the service account to ${googleWorkloadIdentityPrincipal(config, config.subject)}, and enable the IAM Service Account Credentials API. A new binding can take a few minutes to apply.`
  }
  if (status === 404) {
    return `Google Cloud could not find the service account ${config.serviceAccountEmail}. Check the email.`
  }
  const verb = action === 'sign' ? 'sign for' : 'impersonate'
  return `Google Cloud refused to ${verb} ${config.serviceAccountEmail} (HTTP ${status}).`
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
    throw new GoogleWorkloadIdentityError(iamFailureMessage(status, config, 'impersonate'), status)
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
    throw new GoogleWorkloadIdentityError(iamFailureMessage(status, config, 'sign'), status)
  }
  if (typeof payload.signedJwt !== 'string' || !payload.signedJwt) {
    throw new GoogleWorkloadIdentityError('Google Cloud IAM answered without a signature.', 502)
  }
  return payload.signedJwt
}

/**
 * Copy for a refused delegated token, by Google's documented error code. Only
 * `unauthorized_client` and `access_denied` mean the Admin console has not
 * authorized the client ID for the scopes; the rest point elsewhere.
 * @see https://developers.google.com/identity/protocols/oauth2/service-account#error-codes
 */
function delegationFailureMessage(
  status: number,
  payload: Record<string, unknown>,
  input: { serviceAccountEmail: string; user: string; scopes: string[] }
): string {
  if (isProviderOutage(status)) return 'Google’s OAuth token endpoint is unavailable. Try again.'
  const { serviceAccountEmail, user, scopes } = input
  const code = typeof payload.error === 'string' ? payload.error : ''
  const suffix = GOOGLE_TOKEN_DIAGNOSTIC_ERROR_CODES.has(code) ? ` (${code})` : ''
  switch (code) {
    case 'invalid_grant':
      return `Google refused to sign in as ${user}${suffix}. Check that the address belongs to an active user in your Google Workspace domain.`
    case 'unauthorized_client':
    case 'access_denied':
      return `Google Workspace has not authorized this service account’s domain-wide delegation for ${user}${suffix}. In the Admin console, under Security, Access and data control, API controls, Manage Domain Wide Delegation, authorize the service account’s client ID (its numeric Unique ID) for these scopes: ${scopes.join(',')}. A new authorization can take a while to apply.`
    case 'admin_policy_enforced':
      return `Your Google Workspace admin policies block one or more of these scopes for this service account${suffix}. A Workspace administrator must allow its client ID under Security, Access and data control, API controls, third-party app access.`
    case 'disabled_client':
      return `Google reports the service account ${serviceAccountEmail} is disabled${suffix}. Enable it in Google Cloud under IAM & Admin, Service Accounts.`
    case 'deleted_client':
      return `Google reports the service account ${serviceAccountEmail} was deleted${suffix}. Restore it within 30 days of deletion, or connect another service account.`
    default:
      return `Google refused the delegated token for ${user}${suffix}. Check the service account’s configuration in Google Cloud and its domain-wide delegation in the Admin console.`
  }
}

/**
 * Exchanges a signed assertion for an access token acting as the delegated
 * user, through the same transport a JSON key's assertion takes: retries on
 * 429 and 5xx within a budget, and a bounded read of the answer.
 */
async function exchangeDelegationAssertion(
  assertion: string,
  context: { serviceAccountEmail: string; user: string; scopes: string[] }
): Promise<ServiceAccountAccessToken> {
  let response: Awaited<ReturnType<typeof exchangeGoogleServiceAccountJwt>>
  try {
    response = await exchangeGoogleServiceAccountJwt(OAUTH_TOKEN_URL, assertion)
  } catch {
    throw new GoogleWorkloadIdentityError('Could not reach Google. Try again.')
  }
  const payload = parsePayload(response.body)
  if (!response.ok) {
    throw new GoogleWorkloadIdentityError(
      delegationFailureMessage(response.status, payload, context),
      response.status
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
  return exchangeDelegationAssertion(assertion, {
    serviceAccountEmail: config.serviceAccountEmail,
    user,
    scopes,
  })
}

/**
 * Reads one cheap resource per service as the delegated user, with that
 * service's token. Services with the same scopes and read (Drive, Docs, and
 * Sheets) are checked once.
 */
async function verifyDelegation(
  config: GoogleWorkloadIdentityConfig,
  delegation: SubmittedDelegation,
  owner: WorkloadIdentityOwner
): Promise<void> {
  const checks = new Map<string, { scopes: string[]; read: { api: string; url: string } }>()
  for (const service of delegation.services) {
    const scopes = googleDelegationScopes(service)
    const read = DELEGATION_READS[service]
    checks.set(`${[...scopes].sort().join(' ')}|${read.url}`, { scopes, read })
  }
  const federatedToken = await exchangeSubjectToken(config, owner)
  for (const { scopes, read } of checks.values()) {
    const { accessToken } = await mintDelegatedToken(
      config,
      federatedToken,
      delegation.user,
      scopes
    )
    const status = await getStatus(read.url, accessToken)
    if (status === undefined) {
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
        googleDelegationScopesFor(knownDelegatedServices(delegation))
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

/** The configuration a stored keyless secret holds, or undefined for anything else. */
function parseStoredConfig(storedSecret: unknown): GoogleWorkloadIdentityConfig | undefined {
  const parsed = storedSecretSchema.safeParse(storedSecret)
  return parsed.success ? parsed.data.config : undefined
}

/** {@link parseStoredConfig} for the decrypted secret's JSON text. */
function parseDecryptedConfig(decrypted: string): GoogleWorkloadIdentityConfig | undefined {
  try {
    return parseStoredConfig(JSON.parse(decrypted))
  } catch {
    return undefined
  }
}

function readStoredSubject(storedSecret: Record<string, unknown> | null | undefined) {
  return parseStoredConfig(storedSecret)?.subject
}

/** A keyless credential's domain-wide delegation, as a reconnect reopens on it. */
export interface GoogleStoredDelegation {
  user: string
  services: GoogleDelegationService[]
}

/**
 * The non-secret fields a reconnect keeps, from one parse of the decrypted secret:
 * its mode, the domain-wide delegation (Workspace user and the services this
 * release knows), and a custom audience. A JSON key reads as `json_key` alone.
 */
export function storedGoogleReconnectFields(decrypted: string): {
  authType: 'workload_identity' | 'json_key'
  delegation?: GoogleStoredDelegation
  audience?: string
} {
  let secret: unknown
  try {
    secret = JSON.parse(decrypted)
  } catch {
    return { authType: 'json_key' }
  }
  if (toRecord(secret).type !== GOOGLE_WORKLOAD_IDENTITY_SECRET_TYPE) {
    return { authType: 'json_key' }
  }
  const config = parseStoredConfig(secret)
  const services = config?.delegation ? knownDelegatedServices(config.delegation) : []
  return {
    authType: 'workload_identity',
    ...(config?.delegation && services.length > 0
      ? { delegation: { user: config.delegation.user, services } }
      : {}),
    ...(config?.audience ? { audience: config.audience } : {}),
  }
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
  delegation?: SubmittedDelegation
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
    ...storedAudienceField(
      submitted.audience,
      googleWorkloadIdentityAudience(submitted),
      googleStsAudience(submitted)
    ),
  }
  if (!subjectSchema.safeParse(config.subject).success) {
    throw new GoogleWorkloadIdentityError('This credential’s subject is too long for Google Cloud.')
  }

  // A token from generateAccessToken proves the provider accepted Sim's token and the
  // service account lets this subject impersonate it; a delegated read proves the rest
  // of the delegation chain as well.
  const { delegation } = submitted
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
 * and scopes: a reconnect (a changed audience included) re-encrypts the secret
 * and so never reuses the old configuration's token, and a delegated token never
 * answers for the service account's own.
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

/** Reads the stored secret, or fails in the shared service-account codes. */
function readStoredConfig(decrypted: string): GoogleWorkloadIdentityConfig {
  const config = parseDecryptedConfig(decrypted)
  if (!config) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'google_keyless_config',
      reason: 'the stored keyless Google configuration could not be read; reconnect the credential',
    })
  }
  return config
}

/**
 * Read-only scopes whose read-write sibling is not a scope Google defines, by
 * the authorized scope Google documents as covering them. `gmail.readonly`
 * ("View your email messages and settings") is covered by `gmail.modify`
 * ("Read, compose, and send emails"); the Gmail label picker asks for it.
 * `calendar.events.readonly` ("View events on all your calendars") is covered
 * by `calendar` ("See, edit, share, and permanently delete all the calendars
 * you can access"), not by its `calendar.events` sibling, which the Calendar
 * delegation does not authorize; the Calendar connector asks for it.
 * @see https://developers.google.com/workspace/gmail/api/auth/scopes
 * @see https://developers.google.com/workspace/calendar/api/auth
 */
const DELEGATED_READ_COVERS: ReadonlyMap<string, string> = new Map([
  [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
  ],
  [
    'https://www.googleapis.com/auth/calendar.events.readonly',
    'https://www.googleapis.com/auth/calendar',
  ],
])

/**
 * The scopes to sign a delegated assertion for, or undefined when the
 * delegation does not authorize them. A delegation authorizes the scopes the
 * connect dialog asked the Admin console to authorize for its services, and
 * Google refuses an assertion naming any other scope. Authorization is by
 * scope, as Google's is, not by the service asking: Drive, Docs, and Sheets
 * share their scopes, so a delegation for one serves the others. A requested
 * read-only scope is minted as the authorized scope that covers it: its
 * read-write sibling (the Drive file picker asks for `drive.readonly`; `drive`
 * is authorized), the same rule a connected account's granted scopes are
 * checked by, or the scope {@link DELEGATED_READ_COVERS} names.
 */
function delegatedMintScopes(
  delegation: StoredDelegation,
  requested: readonly string[]
): string[] | undefined {
  const authorized = new Set(googleDelegationScopesFor(knownDelegatedServices(delegation)))
  const minted = new Set<string>()
  for (const scope of requested) {
    const mint = [scope, readWriteScopeOf(scope), DELEGATED_READ_COVERS.get(scope)].find(
      (candidate) => candidate !== undefined && authorized.has(candidate)
    )
    if (!mint) return undefined
    minted.add(mint)
  }
  return [...minted]
}

/**
 * Resolves an authorized keyless Google credential to an access token. A
 * Google Cloud service gets a service account token. A delegable Google
 * Workspace service gets a token acting as the delegated user, only when the
 * credential was saved with domain-wide delegation whose scopes cover the
 * request. Anything else is refused before Google is contacted.
 */
export async function resolveGoogleWorkloadIdentityToken(
  input: ResolveGoogleWorkloadIdentityTokenInput
): Promise<string> {
  const config = readStoredConfig(input.decrypted)
  const delegation = googleDelegationServiceFor(input.service) ? config.delegation : undefined

  if (delegation) {
    if (input.impersonateEmail && input.impersonateEmail.trim().toLowerCase() !== delegation.user) {
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
  const scopes = delegation ? delegatedMintScopes(delegation, input.scopes) : input.scopes
  if (!scopes) {
    throw unsupportedUse(
      'google_keyless_delegation_scope',
      'this keyless Google credential’s domain-wide delegation does not authorize the scopes this use needs'
    )
  }
  const scopeKey = [...new Set(scopes)].sort().join(' ')
  const identityKey = delegation ? `delegated:${delegation.user}` : 'service-account'
  const cacheKey = `${input.credentialId}:${input.secretVersion}:${identityKey}:${scopeKey}`
  const cached = tokenCache.get(cacheKey)
  if (cached) return cached

  // Concurrent block runs share one mint, so it is not tied to any one caller's signal.
  return coalesceLocally(`google-keyless:${cacheKey}`, async () => {
    const mintScopes = scopeKey.split(' ')
    let token: ServiceAccountAccessToken
    try {
      token = delegation
        ? await mintDelegatedToken(
            config,
            await exchangeSubjectToken(config, input.owner),
            delegation.user,
            mintScopes
          )
        : await mintServiceAccountToken(config, input.owner, mintScopes)
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
