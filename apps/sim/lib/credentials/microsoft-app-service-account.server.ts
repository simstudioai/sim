import { createHash, createPrivateKey, type KeyObject, X509Certificate } from 'node:crypto'
import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { eq } from 'drizzle-orm'
import { SignJWT } from 'jose'
import { LRUCache } from 'lru-cache'
import { z } from 'zod'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { parseServiceAccountConfig } from '@/lib/credentials/service-account-config'
import {
  providerFailureCode,
  TokenServiceAccountValidationError,
} from '@/lib/credentials/token-service-accounts/errors'
import { WORKLOAD_IDENTITY_AUDIENCES } from '@/lib/credentials/workload-identity/audiences'
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

/**
 * Saved Microsoft Entra app-only credentials (OAuth 2.0 client credentials).
 *
 * One app registration serves every Microsoft service that runs without a
 * signed-in user: Microsoft Graph for Entra ID, SharePoint, and Intune, and the
 * credential's own Dataverse environment for Dataverse and Dynamics 365. The
 * app's application permissions and the environment's application user decide
 * what it can do; Sim stores no permission list of its own.
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
const LOGIN_ORIGIN = 'https://login.microsoftonline.com'
const GRAPH_RESOURCE = 'https://graph.microsoft.com'
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

/**
 * The Microsoft services that may use this credential. Each one's `serviceAccountProviderId` in
 * `oauth.ts` offers the credential in its picker; this list is what the resolver accepts.
 */
const MICROSOFT_APP_SERVICES = [
  'microsoft-ad',
  'sharepoint',
  'microsoft-intune',
  'microsoft-dataverse',
] as const

type MicrosoftAppService = (typeof MICROSOFT_APP_SERVICES)[number]

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

const FEDERATION_MISMATCH_MESSAGE =
  'No federated credential on this app matches the issuer, subject, and audience Sim presents. Add it with the exact values from Sim (the connect dialog or `sim credentials keyless-subject`) (matching is case-sensitive). A new federated credential can take a few minutes to take effect.'

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
      return FEDERATION_MISMATCH_MESSAGE
    default:
      return config.authType === 'federated'
        ? `Microsoft Entra refused the keyless sign-in${aadsts ? ` (AADSTS${aadsts})` : ''}. ${FEDERATION_MISMATCH_MESSAGE}`
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

function tokenEndpoint(tenantId: string): string {
  return `${LOGIN_ORIGIN}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`
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
    .setAudience(tokenEndpoint(config.tenantId))
    .setJti(generateId())
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + CERTIFICATE_ASSERTION_TTL_SECONDS)
    .sign(key)
}

function mintFederatedAssertion(subject: string, owner: WorkloadIdentityOwner): Promise<string> {
  return mintWorkloadIdentityToken({
    subject,
    audience: WORKLOAD_IDENTITY_AUDIENCES.microsoft,
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
      : await mintFederatedAssertion(config.subject, owner)
  return { client_assertion_type: CLIENT_ASSERTION_TYPE, client_assertion: assertion }
}

interface EntraToken {
  accessToken: string
  expiresInSeconds: number
}

/**
 * Requests an app-only token for one resource (`<resource>/.default`) from the
 * credential's own tenant. The token endpoint is fixed; only the tenant segment
 * comes from the credential, and it was validated when the credential was saved.
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
    response = await fetch(tokenEndpoint(config.tenantId), {
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
    `${GRAPH_RESOURCE}/v1.0/servicePrincipals(appId='${config.clientId}')?$select=id,appId,displayName`,
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

/** The auth mode a decrypted Microsoft app credential secret holds, or undefined when it is not one. */
export function storedMicrosoftAppAuthType(
  decrypted: string
): 'federated' | 'client_secret' | 'certificate' | undefined {
  try {
    const parsed = storedSecretSchema.safeParse(JSON.parse(decrypted))
    return parsed.success ? parsed.data.config.authType : undefined
  } catch {
    return undefined
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
      GRAPH_RESOURCE,
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
  const submitted = parsed.data
  let config: MicrosoftAppConfig
  if (submitted.authType === 'federated') {
    if (!(await isWorkloadIdentityConfigured())) {
      throw new WorkloadIdentityNotConfiguredError('Use a client secret or certificate.')
    }
    const { subject, subjectProof, ...rest } = submitted
    config = { ...rest, subject: bindSubject(subject, subjectProof, owner) }
  } else {
    config = submitted
  }
  if (config.authType === 'certificate') {
    loadCertificateMaterial(config.privateKey, config.certificate)
  }

  const verify = async () => {
    const graphToken = await requestEntraToken(config, GRAPH_RESOURCE, owner)
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

interface CachedToken {
  accessToken: string
  instanceUrl?: string
}

/**
 * Minted tokens per credential, resource, and stored-secret version: a
 * reconnect re-encrypts the secret and so never reuses the old app's token.
 */
const tokenCache = new LRUCache<string, CachedToken>({ max: TOKEN_CACHE_MAX })

export interface MicrosoftAppCredentialToken {
  accessToken: string
  /** The credential's Dataverse environment, for Dataverse and Dynamics 365 tools. */
  instanceUrl?: string
}

function isMicrosoftAppService(value: string | undefined): value is MicrosoftAppService {
  return (MICROSOFT_APP_SERVICES as readonly (string | undefined)[]).includes(value)
}

/**
 * Resolves an executor-authorized Microsoft app credential (the executor
 * already checked the caller may use it) to a token for the service the tool
 * belongs to. The resource is decided by the tool's service, never by caller
 * params: Graph for Entra ID, SharePoint, and Intune, the stored environment for
 * Dataverse. Any other service is refused, so a Microsoft block that needs a
 * signed-in user can never receive an app-only token.
 */
export async function resolveMicrosoftAppCredentialToken(
  credentialId: string,
  service: string | undefined,
  signal?: AbortSignal
): Promise<MicrosoftAppCredentialToken> {
  if (!isMicrosoftAppService(service)) {
    throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
      step: 'microsoft_app_service',
      reason: 'this Microsoft service needs a signed-in user, not an app-only credential',
    })
  }
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
  if (
    !row ||
    row.type !== 'service_account' ||
    row.providerId !== MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID ||
    row.revokedAt !== null ||
    !row.encryptedServiceAccountKey
  ) {
    throw new MicrosoftAppCredentialError('Microsoft app credential is unavailable')
  }
  const encryptedKey = row.encryptedServiceAccountKey
  const cacheKey = `${credentialId}:${service === 'microsoft-dataverse' ? 'dataverse' : 'graph'}:${encryptedKey.slice(0, 32)}`
  const cached = tokenCache.get(cacheKey)
  if (cached) return cached
  signal?.throwIfAborted()

  // Concurrent block runs share one mint, so it is not tied to any one caller's signal.
  return coalesceLocally(`microsoft-app:${cacheKey}`, async () => {
    const { decrypted } = await decryptSecret(encryptedKey)
    const { config } = storedSecretSchema.parse(JSON.parse(decrypted))
    let resource = GRAPH_RESOURCE
    let instanceUrl: string | undefined
    if (service === 'microsoft-dataverse') {
      if (!config.environmentUrl) {
        throw new TokenServiceAccountValidationError('invalid_credentials', 400, {
          step: 'microsoft_app_environment',
          reason: 'credential has no Dataverse environment; reconnect it with one',
        })
      }
      resource = config.environmentUrl
      instanceUrl = config.environmentUrl
    }
    const owner: WorkloadIdentityOwner = row.workspaceId
      ? { workspaceId: row.workspaceId }
      : { organizationId: row.organizationId ?? undefined }
    let token: EntraToken
    try {
      token = await requestRunEntraToken(config, resource, owner)
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
    const value: CachedToken = { accessToken: token.accessToken, instanceUrl }
    const ttl = token.expiresInSeconds * 1000 - TOKEN_REUSE_MARGIN_MS
    if (ttl > 0) tokenCache.set(cacheKey, value, { ttl })
    return value
  })
}
