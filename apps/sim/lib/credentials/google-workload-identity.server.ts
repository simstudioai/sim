import { getErrorMessage } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import { z } from 'zod'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  GOOGLE_KEYLESS_SERVICES,
  GOOGLE_WORKLOAD_IDENTITY_SECRET_TYPE,
  googleStsAudience,
  googleWorkloadIdentityAudience,
  googleWorkloadIdentityPrincipal,
  googleWorkloadIdentityProviderName,
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
 * @see https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
 * @see https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token
 * @see https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken
 */

const SUBMITTED_AUTH_TYPE = 'workload_identity' as const

const STS_TOKEN_URL = 'https://sts.googleapis.com/v1/token'
const IAM_CREDENTIALS_ORIGIN = 'https://iamcredentials.googleapis.com'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'
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

const storedConfigSchema = z.object({ ...refShape, subject: subjectSchema }).strict()

type GoogleWorkloadIdentityConfig = z.infer<typeof storedConfigSchema>

const submittedConfigSchema = z
  .object({
    authType: z.literal(SUBMITTED_AUTH_TYPE),
    ...refShape,
    subject: z.string().min(1).max(512).optional(),
    subjectProof: z.string().min(1).max(512).optional(),
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
    return `The service account ${config.serviceAccountEmail} does not let this credential impersonate it. Grant roles/iam.workloadIdentityUser on the service account to ${googleWorkloadIdentityPrincipal(config, config.subject)}, and enable the IAM Service Account Credentials API. A new binding can take a few minutes to apply.`
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
  try {
    await mintServiceAccountToken(stray, owner, [CLOUD_PLATFORM_SCOPE])
  } catch (error) {
    if (isRefusal(error)) return
    throw new GoogleWorkloadIdentityError(
      'Sim could not confirm this service account trusts only this credential. Try again.'
    )
  }
  throw new GoogleWorkloadIdentityError(
    'This service account also trusts other Sim credentials. Grant roles/iam.workloadIdentityUser to this credential’s principal:// subject only (not a principalSet for the pool), and add the attribute condition from Sim (the connect dialog or `sim credentials keyless-subject`) so the provider accepts only this subject.'
  )
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
}

/**
 * Validates the submitted configuration, then proves it end to end: Sim's
 * token is exchanged at STS, the federated token impersonates the service
 * account. Alongside, a subject no credential holds must be refused. Returns the encrypted blob.
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
  }
  if (!subjectSchema.safeParse(config.subject).success) {
    throw new GoogleWorkloadIdentityError('This credential’s subject is too long for Google Cloud.')
  }

  // A token from generateAccessToken proves the provider accepted Sim's token and the
  // service account lets this subject impersonate it.
  const verify = () => mintServiceAccountToken(config, owner, [CLOUD_PLATFORM_SCOPE])
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
  }
}

/**
 * Minted tokens per credential, stored-secret version, and scopes: a reconnect
 * re-encrypts the secret and so never reuses the old configuration's token.
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
  /** A domain-wide-delegation subject, which a keyless credential refuses. */
  impersonateEmail?: string
  /** The Google service the token is for, from server-side policy. */
  service?: string
}

/**
 * Resolves an authorized keyless Google credential to a service account token.
 * It refuses domain-wide delegation and any service that is not a Google Cloud
 * API before doing anything else: Workspace data needs a delegated user, which
 * this mode cannot prove.
 */
export async function resolveGoogleWorkloadIdentityToken(
  input: ResolveGoogleWorkloadIdentityTokenInput
): Promise<string> {
  if (input.impersonateEmail) {
    throw new TokenServiceAccountValidationError('unsupported_use', 400, {
      step: 'google_keyless_delegation',
      reason: 'keyless Google Cloud credentials cannot impersonate a Google Workspace user',
    })
  }
  if (!input.service || !GOOGLE_KEYLESS_SERVICES.has(input.service)) {
    throw new TokenServiceAccountValidationError('unsupported_use', 400, {
      step: 'google_keyless_service',
      reason: 'keyless Google Cloud credentials work only with Google Cloud APIs',
    })
  }
  if (input.scopes.length === 0) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'google_keyless_scopes',
      reason: 'scopes are required for service account credentials',
    })
  }
  const scopeKey = [...new Set(input.scopes)].sort().join(' ')
  const cacheKey = `${input.credentialId}:${input.secretVersion}:${scopeKey}`
  const cached = tokenCache.get(cacheKey)
  if (cached) return cached

  // Concurrent block runs share one mint, so it is not tied to any one caller's signal.
  return coalesceLocally(`google-keyless:${cacheKey}`, async () => {
    const { config } = storedSecretSchema.parse(JSON.parse(input.decrypted))
    let token: ServiceAccountAccessToken
    try {
      token = await mintServiceAccountToken(config, input.owner, scopeKey.split(' '))
    } catch (error) {
      if (!(error instanceof GoogleWorkloadIdentityError)) throw error
      // Report in the shared service-account codes: an outage is not a bad credential.
      throw new TokenServiceAccountValidationError(
        error.status === undefined ? 'provider_unavailable' : providerFailureCode(error.status),
        error.status ?? 502,
        { step: 'google_keyless_token' }
      )
    }
    const ttl = token.expiresAtMs - Date.now() - TOKEN_REUSE_MARGIN_MS
    if (ttl > 0) tokenCache.set(cacheKey, token.accessToken, { ttl })
    return token.accessToken
  })
}
