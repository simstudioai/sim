import { createHash, createPrivateKey, type KeyObject, X509Certificate } from 'node:crypto'
import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { compareStrings } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import { SignJWT } from 'jose'
import { LRUCache } from 'lru-cache'
import { z } from 'zod'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import {
  MICROSOFT_CLOUD_IDS,
  MICROSOFT_CLOUDS,
  type MicrosoftCloudId,
} from '@/lib/credentials/microsoft-clouds'
import { parseServiceAccountConfig } from '@/lib/credentials/service-account-config'
import {
  providerFailureCode,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import {
  storedAudienceField,
  storedWorkloadIdentityAudienceSchema,
  WORKLOAD_IDENTITY_AUDIENCES,
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
import { normalizeMicrosoftDataverseEnvironmentUrl } from '@/lib/oauth/microsoft-dataverse'
import { MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { AZURE_DATA_EXPLORER_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'

/**
 * Saved Microsoft Entra app-only credentials (OAuth 2.0 client credentials).
 *
 * One app registration serves every Microsoft service that runs without a
 * signed-in user: Microsoft Graph for Entra ID, SharePoint, and Intune, the
 * Power BI REST API, the credential's own Dataverse environment for Dataverse
 * and Dynamics 365, and the Azure Data Explorer cluster each call names. The
 * app's application permissions, role assignments, and the environment's
 * application user decide what it can do; Sim stores no permission list of its
 * own. Each audience gets its own token.
 *
 * A credential signs in to one Microsoft cloud (`cloud`, absent for the global
 * cloud); a national cloud has its own Entra and Graph endpoints, listed in
 * `microsoft-clouds.ts`.
 *
 * - `client_secret`: the app's client secret.
 * - `certificate`: a PEM private key and its certificate. Sim signs a PS256
 *   client assertion carrying the certificate's `x5t#S256` thumbprint.
 * - `federated`: no stored secret. Sim signs a short-lived token for this
 *   credential's own subject and presents it as the client assertion, which a
 *   federated identity credential on the app trusts.
 *
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials
 */

const SECRET_TYPE = 'microsoft_app_credential_v1' as const
const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
const REQUEST_TIMEOUT_MS = 15_000
/** Microsoft asks for an assertion that expires "5-10 minutes after nbf at most". */
const CERTIFICATE_ASSERTION_TTL_SECONDS = 300
const MIN_RSA_MODULUS_BITS = 2048
const MAX_RSA_MODULUS_BITS = 4096
const MAX_PEM_LENGTH = 16_384
/** A certificate issued moments ago on a machine whose clock runs ahead is not refused as "not valid yet". */
const CERTIFICATE_CLOCK_SKEW_MS = 5 * 60 * 1000

/** Extra token requests a run makes while a new federated credential propagates through Entra. */
const FEDERATION_PROPAGATION_RETRIES = 2
/**
 * The refusal Microsoft documents for a federated credential that has not reached every Entra
 * node yet. AADSTS700213 is left out: Microsoft documents it only as a case-sensitive mismatch.
 */
const FEDERATION_PROPAGATION_AADSTS = 70021
/**
 * A run's whole token request, retries included, settles inside this budget so it stays under the
 * 30 s deadline that concurrent runs sharing the mint wait for. A retry is only started when even
 * a request that runs to its full timeout would still finish in time.
 */
const RUN_TOKEN_BUDGET_MS = 25_000

/** Re-mint once less than this much of a token's lifetime remains. */
const TOKEN_REUSE_MARGIN_MS = 5 * 60 * 1000
const TOKEN_CACHE_MAX = 10_000

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A verified domain (`contoso.onmicrosoft.com`); `common` and friends have no dot. */
const TENANT_DOMAIN_PATTERN =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

const tenantSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value) => GUID_PATTERN.test(value) || TENANT_DOMAIN_PATTERN.test(value),
    'Enter the Directory (tenant) ID, a GUID like 00000000-0000-0000-0000-000000000000'
  )

const clientIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(GUID_PATTERN, 'Enter the Application (client) ID, a GUID')

const environmentUrlSchema = z
  .string()
  .trim()
  .max(255)
  .transform((value, context) => {
    try {
      return normalizeMicrosoftDataverseEnvironmentUrl(value)
    } catch {
      context.addIssue({
        code: 'custom',
        message:
          'Enter the Dataverse environment URL, like https://contoso.crm.dynamics.com, with no path',
      })
      return z.NEVER
    }
  })

const baseShape = {
  tenantId: tenantSchema,
  clientId: clientIdSchema,
  environmentUrl: environmentUrlSchema.optional(),
  /** Absent for the global cloud, so a global credential's stored shape never changes. */
  cloud: z.enum(MICROSOFT_CLOUD_IDS).optional(),
}

const pemSchema = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(MAX_PEM_LENGTH, `${label} is too large`)

const clientSecretSchema = z
  .object({
    ...baseShape,
    authType: z.literal('client_secret'),
    clientSecret: z
      .string()
      .min(1, 'Client secret is required')
      .max(1024)
      .refine((value) => value.trim().length > 0, 'Client secret is required'),
  })
  .strict()

const certificateSchema = z
  .object({
    ...baseShape,
    authType: z.literal('certificate'),
    privateKey: pemSchema('Private key'),
    certificate: pemSchema('Certificate'),
  })
  .strict()

const federatedShape = {
  ...baseShape,
  authType: z.literal('federated'),
  subject: z.string().min(1).max(512),
  /** The `aud` Sim's token carries; absent for the default, so earlier releases still read it. */
  audience: storedWorkloadIdentityAudienceSchema,
}

const storedConfigSchema = z.discriminatedUnion('authType', [
  clientSecretSchema,
  certificateSchema,
  z.object(federatedShape).strict(),
])

type MicrosoftAppConfig = z.infer<typeof storedConfigSchema>

const submittedConfigSchema = z.discriminatedUnion('authType', [
  clientSecretSchema,
  certificateSchema,
  z
    .object({
      ...federatedShape,
      subject: federatedShape.subject.optional(),
      subjectProof: z.string().min(1).max(512).optional(),
      audience: workloadIdentityAudienceSchema('microsoft').optional(),
    })
    .strict(),
])

const storedSecretSchema = z
  .object({ type: z.literal(SECRET_TYPE), config: storedConfigSchema })
  .strict()

/** A configuration problem Sim can name the fix for; its message is shown to the person saving. */
export class MicrosoftAppCredentialError extends Error {
  /**
   * @param status The HTTP status of the failed exchange: Microsoft's answer, or 502 when Entra
   *   could not be reached or answered without a token. Absent for a problem with the stored
   *   configuration itself (an expired certificate, say), which only a reconnect fixes.
   * @param aadsts The Entra `AADSTS` error code, when Entra reported one.
   */
  constructor(
    message: string,
    readonly status?: number,
    readonly aadsts?: number
  ) {
    super(message)
    this.name = 'MicrosoftAppCredentialError'
  }
}

function federationMismatchMessage(config: MicrosoftAppConfig): string {
  const audience =
    config.authType === 'federated'
      ? ` (${config.audience ?? WORKLOAD_IDENTITY_AUDIENCES.microsoft})`
      : ''
  return `No federated credential on this app matches the issuer, subject, and audience${audience} Sim presents. Add it with the exact values from Sim (the connect dialog or \`sim credentials keyless-subject\`) (matching is case-sensitive). A new federated credential can take a few minutes to take effect.`
}

/**
 * Actionable copy for the Entra errors a person saving the credential can fix.
 * AADSTS70021 (no matching federated identity record) is documented in the
 * workload identity federation considerations, and AADSTS700213 (no matching
 * record for the presented subject, issuer, or audience) in the August 2024
 * breaking-changes entry; any other keyless refusal still names the mismatch.
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes
 * @see https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-considerations
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/reference-breaking-changes
 */
function entraFailureMessage(aadsts: number | undefined, config: MicrosoftAppConfig): string {
  switch (aadsts) {
    case 90002:
      return 'Microsoft Entra could not find this tenant. Check the Directory (tenant) ID.'
    case 700016:
      return 'No app with this Application (client) ID exists in the tenant. Check both IDs on the app registration’s Overview page.'
    case 7000215:
      return 'Microsoft Entra rejected the client secret. Copy the secret’s Value (not its Secret ID) from Certificates & secrets.'
    case 7000222:
      return 'This client secret has expired. Create a new one under Certificates & secrets.'
    case 700027:
      return 'Microsoft Entra could not verify the signed assertion. Upload this certificate (the .cer or .pem public part) to the app registration’s Certificates tab.'
    case 7000112:
      return 'This app registration is disabled in the tenant.'
    case 500011:
      return config.environmentUrl
        ? 'Microsoft Entra does not recognize this Dataverse environment in the tenant. Check the environment URL.'
        : 'Microsoft Entra does not recognize the requested resource in this tenant.'
    case 70021:
    case 700213:
      return federationMismatchMessage(config)
    default:
      return config.authType === 'federated'
        ? `Microsoft Entra refused the keyless sign-in${aadsts ? ` (AADSTS${aadsts})` : ''}. ${federationMismatchMessage(config)}`
        : `Microsoft Entra refused the token request${aadsts ? ` (AADSTS${aadsts})` : ''}. Check the tenant ID, client ID, and credential.`
  }
}

function readAadstsCode(payload: { error_codes?: unknown; error_description?: unknown }) {
  if (Array.isArray(payload.error_codes) && typeof payload.error_codes[0] === 'number') {
    return payload.error_codes[0]
  }
  const match =
    typeof payload.error_description === 'string'
      ? /AADSTS(\d+)/.exec(payload.error_description)
      : null
  return match ? Number(match[1]) : undefined
}

interface CertificateMaterial {
  key: KeyObject
  thumbprintS256: string
}

/**
 * Loads the certificate and its private key, refusing a pair Entra would
 * reject anyway so the person sees what to fix before anything is sent.
 */
function loadCertificateMaterial(
  privateKeyPem: string,
  certificatePem: string
): CertificateMaterial {
  let certificate: X509Certificate
  try {
    certificate = new X509Certificate(certificatePem)
  } catch {
    throw new MicrosoftAppCredentialError(
      'The certificate is not a readable PEM certificate (-----BEGIN CERTIFICATE-----).'
    )
  }
  let key: KeyObject
  try {
    key = createPrivateKey(privateKeyPem)
  } catch {
    throw new MicrosoftAppCredentialError(
      'The private key is not a readable, unencrypted PEM private key.'
    )
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw new MicrosoftAppCredentialError(
      'Microsoft Entra certificate credentials need an RSA key.'
    )
  }
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0
  if (bits < MIN_RSA_MODULUS_BITS || bits > MAX_RSA_MODULUS_BITS) {
    throw new MicrosoftAppCredentialError(
      `The RSA key is ${bits}-bit; use a 2048- to 4096-bit key.`
    )
  }
  if (!certificate.checkPrivateKey(key)) {
    throw new MicrosoftAppCredentialError('The private key does not belong to this certificate.')
  }
  if (Date.parse(certificate.validTo) <= Date.now()) {
    throw new MicrosoftAppCredentialError(
      'This certificate has expired. Upload a new one to the app registration and save it here.'
    )
  }
  const validFrom = Date.parse(certificate.validFrom)
  if (validFrom > Date.now() + CERTIFICATE_CLOCK_SKEW_MS) {
    throw new MicrosoftAppCredentialError(
      `This certificate is not valid until ${new Date(validFrom).toISOString()}. Use a certificate that is already valid.`
    )
  }
  return {
    key,
    thumbprintS256: createHash('sha256').update(certificate.raw).digest('base64url'),
  }
}

function cloudOf(config: MicrosoftAppConfig) {
  return MICROSOFT_CLOUDS[config.cloud ?? 'global']
}

/** The credential's Entra token endpoint: a fixed cloud origin plus the validated tenant. */
function tokenEndpoint(config: MicrosoftAppConfig): string {
  return `${cloudOf(config).loginOrigin}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`
}

/** The PS256 client assertion Microsoft documents for certificate credentials. */
async function signCertificateAssertion(
  config: Extract<MicrosoftAppConfig, { authType: 'certificate' }>
): Promise<string> {
  const { key, thumbprintS256 } = loadCertificateMaterial(config.privateKey, config.certificate)
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'PS256', typ: 'JWT', 'x5t#S256': thumbprintS256 })
    .setIssuer(config.clientId)
    .setSubject(config.clientId)
    .setAudience(tokenEndpoint(config))
    .setJti(generateId())
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + CERTIFICATE_ASSERTION_TTL_SECONDS)
    .sign(key)
}

function mintFederatedAssertion(
  config: Extract<MicrosoftAppConfig, { authType: 'federated' }>,
  owner: WorkloadIdentityOwner
): Promise<string> {
  return mintWorkloadIdentityToken({
    subject: config.subject,
    audience: config.audience ?? WORKLOAD_IDENTITY_AUDIENCES.microsoft,
    owner,
  })
}

async function clientAuthentication(
  config: MicrosoftAppConfig,
  owner: WorkloadIdentityOwner
): Promise<Record<string, string>> {
  if (config.authType === 'client_secret') return { client_secret: config.clientSecret }
  const assertion =
    config.authType === 'certificate'
      ? await signCertificateAssertion(config)
      : await mintFederatedAssertion(config, owner)
  return { client_assertion_type: CLIENT_ASSERTION_TYPE, client_assertion: assertion }
}

interface EntraToken {
  accessToken: string
  expiresInSeconds: number
}

/**
 * Requests an app-only token for one resource (`<resource>/.default`) from the
 * credential's own tenant. The token endpoint's origin is one of the fixed
 * Microsoft clouds; only the tenant segment comes from the credential, and it
 * was validated when the credential was saved.
 */
async function requestEntraToken(
  config: MicrosoftAppConfig,
  resource: string,
  owner: WorkloadIdentityOwner,
  signal?: AbortSignal
): Promise<EntraToken> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    scope: `${resource}/.default`,
    grant_type: 'client_credentials',
    ...(await clientAuthentication(config, owner)),
  })
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(tokenEndpoint(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      // A secret or assertion must never follow a redirect off the Entra host.
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch {
    signal?.throwIfAborted()
    throw new MicrosoftAppCredentialError('Could not reach Microsoft Entra. Try again.', 502)
  }
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: unknown
    expires_in?: unknown
    error_codes?: unknown
    error_description?: unknown
  }
  if (!response.ok) {
    const aadsts = readAadstsCode(payload)
    throw new MicrosoftAppCredentialError(
      providerFailureCode(response.status) === 'invalid_credentials'
        ? entraFailureMessage(aadsts, config)
        : 'Microsoft Entra is unavailable. Try again.',
      response.status,
      aadsts
    )
  }
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new MicrosoftAppCredentialError('Microsoft Entra answered without an access token.', 502)
  }
  const expiresIn = Number(payload.expires_in)
  return {
    accessToken: payload.access_token,
    expiresInSeconds: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
  }
}

async function getJson(url: string, token: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

/**
 * Reads the app's own service principal. Microsoft documents that "a service
 * principal can retrieve its own application and service principal details
 * without being granted any application permissions", so this proves the
 * token without asking for a permission the tools may not need (a SharePoint
 * app on Sites.Selected, say).
 * @see https://learn.microsoft.com/en-us/graph/api/serviceprincipal-get
 */
async function readOwnServicePrincipal(config: MicrosoftAppConfig, token: string) {
  const { status, body } = await getJson(
    `${cloudOf(config).graphOrigin}/v1.0/servicePrincipals(appId='${config.clientId}')?$select=id,appId,displayName`,
    token
  )
  if (status !== 200) {
    throw new MicrosoftAppCredentialError(
      status >= 500
        ? 'Microsoft Graph is unavailable. Try again.'
        : `Microsoft Graph did not accept the app’s token (HTTP ${status}).`,
      status
    )
  }
  const principal = body as { id?: unknown; displayName?: unknown }
  return {
    id: typeof principal.id === 'string' ? principal.id : config.clientId,
    displayName: typeof principal.displayName === 'string' ? principal.displayName : undefined,
  }
}

/**
 * Calls Dataverse `WhoAmI` as the app. A 401/403 means the environment has no
 * application user for this app (or it lacks a security role).
 * @see https://learn.microsoft.com/en-us/power-platform/admin/manage-application-users
 */
async function verifyDataverseApplicationUser(environmentUrl: string, token: string) {
  const { status } = await getJson(`${environmentUrl}/api/data/v9.2/WhoAmI`, token)
  if (status === 200) return
  if (status === 401 || status === 403) {
    throw new MicrosoftAppCredentialError(
      'The app signed in, but the Dataverse environment did not accept it. In the Power Platform admin center, add this app as an application user of the environment and assign it a security role.',
      status
    )
  }
  throw new MicrosoftAppCredentialError(
    status >= 500
      ? 'The Dataverse environment is unavailable. Try again.'
      : `The Dataverse environment refused the request (HTTP ${status}). Check the environment URL.`,
    status
  )
}

/**
 * The auth mode, national cloud, and custom keyless audience a decrypted Microsoft app credential
 * secret holds, for a reconnect to reopen on: empty when it is not one, no cloud for a global
 * credential, and no audience for one that uses the default.
 */
export function storedMicrosoftAppReconnectFields(decrypted: string): {
  authType?: MicrosoftAppConfig['authType']
  cloud?: MicrosoftCloudId
  audience?: string
} {
  try {
    const parsed = storedSecretSchema.safeParse(JSON.parse(decrypted))
    if (!parsed.success) return {}
    const { config } = parsed.data
    return {
      authType: config.authType,
      ...(config.cloud ? { cloud: config.cloud } : {}),
      ...(config.authType === 'federated' && config.audience ? { audience: config.audience } : {}),
    }
  } catch {
    return {}
  }
}

function readStoredSubject(storedSecret: Record<string, unknown> | null | undefined) {
  const parsed = storedSecretSchema.safeParse(storedSecret)
  return parsed.success && parsed.data.config.authType === 'federated'
    ? parsed.data.config.subject
    : undefined
}

/**
 * Entra matches a federated credential on issuer, subject, and audience, so a
 * subject no credential holds must be refused. If it is accepted, the app
 * trusts every Sim credential (a flexible federated credential matching on a
 * looser claim, say), and saving would let other Sim tenants act as the app.
 */
async function assertFederationPinsSubject(
  config: Extract<MicrosoftAppConfig, { authType: 'federated' }>,
  owner: WorkloadIdentityOwner
): Promise<void> {
  try {
    await requestEntraToken(
      { ...config, subject: newWorkloadIdentitySubject(owner) },
      cloudOf(config).graphOrigin,
      owner
    )
  } catch (error) {
    const refused =
      error instanceof MicrosoftAppCredentialError &&
      error.status !== undefined &&
      providerFailureCode(error.status) === 'invalid_credentials'
    if (refused) return
    throw new MicrosoftAppCredentialError(
      'Sim could not confirm this app trusts only this credential. Try again.'
    )
  }
  throw new MicrosoftAppCredentialError(
    'This app also trusts other Sim credentials. Use a federated credential whose subject is exactly the one from Sim (the connect dialog or `sim credentials keyless-subject`), so only this credential can use it.'
  )
}

function bindSubject(
  subject: string | undefined,
  subjectProof: string | undefined,
  owner: WorkloadIdentityCredentialOwner
): string {
  return bindWorkloadIdentitySubject({
    provider: 'microsoft',
    owner,
    storedSubject: readStoredSubject(owner.storedSecret),
    subject,
    subjectProof,
  })
}

export interface MicrosoftAppCredentialSaveResult {
  encryptedServiceAccountKey: string
  /** The app's service principal display name, or its client ID. */
  displayName: string
  /** The app's service principal object ID in the tenant. */
  servicePrincipalId: string
  tenantId: string
  /** A subject this save binds that the credential did not already hold. */
  newSubject?: string
}

/**
 * Validates the submitted configuration, mints a Microsoft Graph token and
 * reads the app's own service principal with it, and, when an environment is
 * set, mints a Dataverse token and calls `WhoAmI`. Returns the encrypted blob.
 */
export async function verifyAndEncryptMicrosoftAppCredential(
  serialized: string,
  owner: WorkloadIdentityCredentialOwner
): Promise<MicrosoftAppCredentialSaveResult> {
  const parsed = parseServiceAccountConfig(
    serialized,
    submittedConfigSchema,
    'Microsoft app credential'
  )
  if (!parsed.success) throw new MicrosoftAppCredentialError(parsed.message)
  const { cloud, ...submitted } = parsed.data
  if (cloud && cloud !== 'global' && submitted.environmentUrl) {
    throw new MicrosoftAppCredentialError(
      'Dataverse environments are supported in the global cloud only. Remove the environment URL or choose the global cloud.'
    )
  }
  const cloudField = cloud && cloud !== 'global' ? { cloud } : {}
  let config: MicrosoftAppConfig
  if (submitted.authType === 'federated') {
    if (!(await isWorkloadIdentityConfigured())) {
      throw new WorkloadIdentityNotConfiguredError('Use a client secret or certificate.')
    }
    const { subject, subjectProof, audience: submittedAudience, ...rest } = submitted
    config = {
      ...rest,
      ...cloudField,
      subject: bindSubject(subject, subjectProof, owner),
      ...storedAudienceField(submittedAudience, WORKLOAD_IDENTITY_AUDIENCES.microsoft),
    }
  } else {
    config = { ...submitted, ...cloudField }
  }
  if (config.authType === 'certificate') {
    loadCertificateMaterial(config.privateKey, config.certificate)
  }

  const verify = async () => {
    const graphToken = await requestEntraToken(config, cloudOf(config).graphOrigin, owner)
    const principal = await readOwnServicePrincipal(config, graphToken.accessToken)
    if (config.environmentUrl) {
      const dataverseToken = await requestEntraToken(config, config.environmentUrl, owner)
      await verifyDataverseApplicationUser(config.environmentUrl, dataverseToken.accessToken)
    }
    return principal
  }
  // The subject-pin probe is independent of the verification, so both run at
  // once; a verification failure still reports first.
  const [verified, pinned] = await Promise.allSettled([
    verify(),
    config.authType === 'federated' ? assertFederationPinsSubject(config, owner) : undefined,
  ])
  if (verified.status === 'rejected') {
    if (verified.reason instanceof MicrosoftAppCredentialError) throw verified.reason
    throw new MicrosoftAppCredentialError(
      `Could not verify the Microsoft app credential: ${getErrorMessage(verified.reason, 'Unknown error')}`
    )
  }
  if (pinned.status === 'rejected') throw pinned.reason

  const { encrypted } = await encryptSecret(JSON.stringify({ type: SECRET_TYPE, config }))
  return {
    encryptedServiceAccountKey: encrypted,
    displayName: verified.value.displayName ?? config.clientId,
    servicePrincipalId: verified.value.id,
    tenantId: config.tenantId,
    ...(config.authType === 'federated' && config.subject !== readStoredSubject(owner.storedSecret)
      ? { newSubject: config.subject }
      : {}),
  }
}

/**
 * Requests a run's token, retrying a federated credential's "no matching federated identity
 * record" refusal: Entra can answer it for several minutes after the federated credential is
 * added, even after a token was issued, and Microsoft asks callers to retry. The retries stop
 * within {@link RUN_TOKEN_BUDGET_MS}. The save-time subject-pin probe never comes here, because
 * it expects that very refusal.
 * @see https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-considerations#time-for-federated-credential-changes-to-propagate
 */
async function requestRunEntraToken(
  config: MicrosoftAppConfig,
  resource: string,
  owner: WorkloadIdentityOwner
): Promise<EntraToken> {
  const deadline = Date.now() + RUN_TOKEN_BUDGET_MS
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestEntraToken(config, resource, owner)
    } catch (error) {
      const propagating =
        config.authType === 'federated' &&
        error instanceof MicrosoftAppCredentialError &&
        error.aadsts === FEDERATION_PROPAGATION_AADSTS
      if (!propagating || attempt > FEDERATION_PROPAGATION_RETRIES) throw error
      const delay = backoffWithJitter(attempt, null)
      if (Date.now() + delay + REQUEST_TIMEOUT_MS > deadline) throw error
      await sleep(delay)
    }
  }
}

export interface MicrosoftAppCredentialToken {
  accessToken: string
  /** The credential's Dataverse environment, for Dataverse and Dynamics 365 tools. */
  instanceUrl?: string
}

/** The token audience a service's tools need, and the host they read back from the credential. */
interface MicrosoftAppResource {
  resource: string
  instanceUrl?: string
}

/**
 * Where a token is for. `key` names the audience before the secret is decrypted, so a cached
 * token is served without decrypting; it must decide `select`'s outcome for one stored-secret
 * version. `select` checks the decrypted config and returns the resource on a cache miss.
 */
interface MicrosoftAppAudience {
  key: string
  select: (config: MicrosoftAppConfig) => MicrosoftAppResource
}

/** Refuses a credential whose cloud is not one a service's resource lives in. */
function requireCloud(
  config: MicrosoftAppConfig,
  clouds: readonly MicrosoftCloudId[],
  serviceLabel: string
) {
  const cloud = config.cloud ?? 'global'
  if (clouds.includes(cloud)) return
  throw new TokenServiceAccountValidationError('cloud_mismatch', 400, {
    step: 'microsoft_app_cloud',
    reason: `${serviceLabel} does not run in the ${MICROSOFT_CLOUDS[cloud].label} cloud this credential signs in to`,
  })
}

/** A fixed-audience service whose tools call the global cloud. */
function globalAudience(resource: string, serviceLabel: string): MicrosoftAppAudience {
  return {
    key: resource,
    select: (config) => {
      requireCloud(config, ['global'], serviceLabel)
      return { resource }
    },
  }
}

const GLOBAL_GRAPH = globalAudience(MICROSOFT_CLOUDS.global.graphOrigin, 'Microsoft Graph')

/**
 * The Power BI REST API's token audience in the global cloud. A service principal needs no Entra
 * API permissions for it; the Power BI tenant setting that lets service principals use the APIs
 * and workspace membership decide what it can reach.
 * @see https://learn.microsoft.com/en-us/power-bi/developer/embedded/embed-service-principal
 */
const POWERBI_RESOURCE = 'https://analysis.windows.net/powerbi/api'

/**
 * The fixed-audience Microsoft services that may use this credential, and the resource each
 * one's token is for. Each service's `serviceAccountProviderId` in `oauth.ts` offers the
 * credential in its picker; the resolver accepts these and the operation-minted Azure Data
 * Explorer service. The resource comes from the service and the stored credential, never from
 * caller params.
 */
const MICROSOFT_APP_SERVICE_AUDIENCES: Record<string, MicrosoftAppAudience> = {
  'microsoft-ad': GLOBAL_GRAPH,
  sharepoint: GLOBAL_GRAPH,
  'microsoft-intune': GLOBAL_GRAPH,
  'microsoft-powerbi': globalAudience(POWERBI_RESOURCE, 'Power BI'),
  'microsoft-dataverse': {
    // The environment is part of the stored secret, so one secret version has one environment.
    key: 'dataverse',
    select: (config) => {
      requireCloud(config, ['global'], 'Dataverse')
      if (!config.environmentUrl) {
        throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
          step: 'microsoft_app_environment',
          reason: 'credential has no Dataverse environment; reconnect it with one',
        })
      }
      return { resource: config.environmentUrl, instanceUrl: config.environmentUrl }
    },
  },
}

/**
 * Minted tokens per credential, stored-secret version, and token audience: a reconnect
 * re-encrypts the secret and so never reuses the old app's token, and services that share an
 * audience (the Graph ones) share one token.
 */
const tokenCache = new LRUCache<string, MicrosoftAppCredentialToken>({ max: TOKEN_CACHE_MAX })

interface StoredMicrosoftAppCredential {
  encryptedKey: string
  /** Distinguishes stored-secret versions, so a reconnect never reuses the old app's token. */
  secretVersion: string
  owner: WorkloadIdentityOwner
}

/**
 * Reads an active Microsoft app credential without decrypting it, refusing any other row. With
 * `scope`, the row must also belong to that workspace or organization: an operation that resolves
 * the credential after the executor authorized it re-checks it against the run's own owner.
 */
async function loadMicrosoftAppCredential(
  credentialId: string,
  scope?: WorkloadIdentityOwner
): Promise<StoredMicrosoftAppCredential> {
  const unavailable = () =>
    new MicrosoftAppCredentialError('Microsoft app credential is unavailable')
  if (scope && !scope.workspaceId && !scope.organizationId) throw unavailable()
  const [row] = await db
    .select({
      workspaceId: credential.workspaceId,
      organizationId: credential.organizationId,
      type: credential.type,
      providerId: credential.providerId,
      revokedAt: credential.revokedAt,
      encryptedServiceAccountKey: credential.encryptedServiceAccountKey,
    })
    .from(credential)
    .where(eq(credential.id, credentialId))
    .limit(1)
  const ownerMatches =
    !scope ||
    (row &&
      ((!!scope.workspaceId &&
        row.workspaceId === scope.workspaceId &&
        row.organizationId === null) ||
        (!!scope.organizationId &&
          row.organizationId === scope.organizationId &&
          row.workspaceId === null)))
  if (
    !row ||
    !ownerMatches ||
    row.type !== 'service_account' ||
    row.providerId !== MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID ||
    row.revokedAt !== null ||
    !row.encryptedServiceAccountKey
  ) {
    throw unavailable()
  }
  return {
    encryptedKey: row.encryptedServiceAccountKey,
    secretVersion: row.encryptedServiceAccountKey.slice(0, 32),
    owner: row.workspaceId
      ? { workspaceId: row.workspaceId }
      : { organizationId: row.organizationId ?? undefined },
  }
}

/** Mints (or reuses) the credential's token for one audience, decrypting only on a cache miss. */
async function mintMicrosoftAppToken(
  credentialId: string,
  stored: StoredMicrosoftAppCredential,
  audience: MicrosoftAppAudience,
  signal?: AbortSignal
): Promise<MicrosoftAppCredentialToken> {
  const cacheKey = `${credentialId}:${stored.secretVersion}:${audience.key}`
  const cached = tokenCache.get(cacheKey)
  if (cached) return cached
  signal?.throwIfAborted()

  // Concurrent block runs share one mint, so it is not tied to any one caller's signal.
  return coalesceLocally(`microsoft-app:${cacheKey}`, async () => {
    const { decrypted } = await decryptSecret(stored.encryptedKey)
    const { config } = storedSecretSchema.parse(JSON.parse(decrypted))
    const { resource, instanceUrl } = audience.select(config)
    let token: EntraToken
    try {
      token = await requestRunEntraToken(config, resource, stored.owner)
    } catch (error) {
      if (!(error instanceof MicrosoftAppCredentialError)) throw error
      // Report in the shared service-account codes: an outage is not a bad credential, and a
      // stored certificate that can no longer sign (expired, say) is one only a reconnect fixes.
      throw new TokenServiceAccountValidationError(
        error.status === undefined ? 'invalid_credentials' : providerFailureCode(error.status),
        error.status ?? 400,
        {
          step: 'microsoft_app_token',
          reason: error.aadsts ? `AADSTS${error.aadsts}` : error.message,
        }
      )
    }
    const value: MicrosoftAppCredentialToken = {
      accessToken: token.accessToken,
      ...(instanceUrl ? { instanceUrl } : {}),
    }
    const ttl = token.expiresInSeconds * 1000 - TOKEN_REUSE_MARGIN_MS
    if (ttl > 0) tokenCache.set(cacheKey, value, { ttl })
    return value
  })
}

/**
 * Resolves an executor-authorized Microsoft app credential (the executor
 * already checked the caller may use it) to a token for the service the tool
 * belongs to. The resource is decided by the tool's service, never by caller
 * params: Graph for Entra ID, SharePoint, and Intune, the Power BI REST API for
 * Power BI, the stored environment for Dataverse. Azure Data Explorer, whose
 * operation chooses the cluster per call, gets the credential ID back (as AWS
 * does) for {@link resolveMicrosoftAppResourceToken}. Any other service is
 * refused, so a Microsoft block that needs a signed-in user can never receive an
 * app-only token.
 */
export async function resolveMicrosoftAppCredentialToken(
  credentialId: string,
  service: string | undefined,
  signal?: AbortSignal
): Promise<MicrosoftAppCredentialToken> {
  const operationMinted = service === AZURE_DATA_EXPLORER_CREDENTIAL_OAUTH.provider
  const audience =
    service && Object.hasOwn(MICROSOFT_APP_SERVICE_AUDIENCES, service)
      ? MICROSOFT_APP_SERVICE_AUDIENCES[service]
      : undefined
  if (!audience && !operationMinted) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'microsoft_app_service',
      reason: 'this Microsoft service needs a signed-in user, not an app-only credential',
    })
  }
  const stored = await loadMicrosoftAppCredential(credentialId)
  if (!audience) return { accessToken: credentialId }
  return mintMicrosoftAppToken(credentialId, stored, audience, signal)
}

/**
 * Resolves an executor-authorized Microsoft app credential to a token for a resource the calling
 * operation chose per call and validated against its own host allowlist: an Azure Data Explorer
 * cluster, whose token audience is the cluster's `https://<host>` with no port or path. The
 * credential must belong to `scope`, the run's own workspace or organization. `clouds` names the
 * Microsoft clouds that resource lives in; a credential signed in to any other cloud is refused,
 * because its tokens would never be accepted there.
 * @see https://learn.microsoft.com/en-us/kusto/api/rest/authenticate-with-msal
 */
export async function resolveMicrosoftAppResourceToken(
  credentialId: string,
  scope: WorkloadIdentityOwner,
  audience: { resource: string; clouds: readonly MicrosoftCloudId[]; serviceLabel: string },
  signal?: AbortSignal
): Promise<string> {
  const origin = URL.canParse(audience.resource) ? new URL(audience.resource) : undefined
  if (origin?.protocol !== 'https:' || `https://${origin.hostname}` !== audience.resource) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'microsoft_app_resource',
      reason: 'the token audience must be an https origin with no port or path',
    })
  }
  const stored = await loadMicrosoftAppCredential(credentialId, scope)
  const token = await mintMicrosoftAppToken(
    credentialId,
    stored,
    {
      // A cached token stands for a passed cloud check, so the clouds are part of the key.
      key: `${audience.resource}|${[...audience.clouds].sort(compareStrings).join(',')}`,
      select: (config) => {
        requireCloud(config, audience.clouds, `This ${audience.serviceLabel} resource`)
        return { resource: audience.resource }
      },
    },
    signal
  )
  return token.accessToken
}
