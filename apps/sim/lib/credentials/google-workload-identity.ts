/**
 * Keyless Google Cloud credentials (Workload Identity Federation): the parts
 * the connect dialog and the server share. A keyless credential is a mode of
 * the `google-service-account` credential that stores no key: Sim's signed
 * token is exchanged at Google STS against the customer's workload identity
 * provider, and the federated token impersonates the service account.
 *
 * Every value here ends up in a Google URL, audience, or signed claim, so each
 * one is checked against Google's documented format and nothing else can reach
 * the request.
 *
 * A keyless credential may also opt into domain-wide delegation: it then acts
 * as one Google Workspace user, for the Workspace services its admin chose.
 *
 * @see https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
 * @see https://knowledge.workspace.google.com/admin/apps/domain-wide-delegation-best-practices
 */

import { impersonateEmailSchema } from '@/lib/api/contracts/oauth-connections'
import { storedAudienceField } from '@/lib/credentials/workload-identity/audiences'
import { getProviderIdFromServiceId, getScopesForService } from '@/lib/oauth/utils'

/**
 * The Google services a keyless credential may mint for as the service account
 * itself: Google Cloud APIs. Google Workspace services need domain-wide
 * delegation; see {@link GOOGLE_DELEGATION_SERVICES}.
 */
export const GOOGLE_KEYLESS_SERVICES: ReadonlySet<string> = new Set([
  'google-bigquery',
  'vertex-ai',
])

/**
 * The Google Workspace services a keyless credential can reach through
 * domain-wide delegation, by OAuth service id.
 */
export const GOOGLE_DELEGATION_SERVICES = [
  'gmail',
  'google-drive',
  'google-docs',
  'google-sheets',
  'google-calendar',
] as const

export type GoogleDelegationService = (typeof GOOGLE_DELEGATION_SERVICES)[number]

const DELEGATION_SERVICE_SET: ReadonlySet<string> = new Set(GOOGLE_DELEGATION_SERVICES)

function isGoogleDelegationService(value: string): value is GoogleDelegationService {
  return DELEGATION_SERVICE_SET.has(value)
}

/**
 * Whether a keyless credential can serve this OAuth service or provider id: a
 * Google Cloud service as the service account, or a Workspace service through
 * delegation.
 */
export function isGoogleKeylessService(service: string): boolean {
  return GOOGLE_KEYLESS_SERVICES.has(service) || googleDelegationServiceFor(service) !== undefined
}

/**
 * The delegated service a caller names. Tools and the Integrations page name
 * the OAuth provider id (`google-email`); selectors and blocks name the
 * service id (`gmail`).
 */
export function googleDelegationServiceFor(
  service: string | undefined
): GoogleDelegationService | undefined {
  if (!service) return undefined
  if (isGoogleDelegationService(service)) return service
  return GOOGLE_DELEGATION_SERVICES.find((id) => getProviderIdFromServiceId(id) === service)
}

/**
 * The services a keyless dialog opens delegating: a reconnected credential's
 * stored services, so a reconnect never drops one, plus the delegable service
 * the dialog was opened for. Anything this release does not know is left out.
 */
export function googleInitialDelegatedServices(
  oauthServiceId: string | undefined,
  storedServices: readonly string[] = []
): GoogleDelegationService[] {
  const services = new Set(storedServices)
  const openedFor = googleDelegationServiceFor(oauthServiceId)
  if (openedFor) services.add(openedFor)
  return GOOGLE_DELEGATION_SERVICES.filter((service) => services.has(service))
}

/**
 * User-identity scopes, which a service account can't be granted: Google
 * rejects a service-account token request that includes them.
 */
export const GOOGLE_SERVICE_ACCOUNT_EXCLUDED_SCOPES: ReadonlySet<string> = new Set([
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
])

/** The scopes Sim requests for a delegated service, which the Admin console must authorize. */
export function googleDelegationScopes(service: GoogleDelegationService): string[] {
  return getScopesForService(service).filter(
    (scope) => !GOOGLE_SERVICE_ACCOUNT_EXCLUDED_SCOPES.has(scope)
  )
}

/** Every scope the given delegated services need, deduplicated and sorted. */
export function googleDelegationScopesFor(services: readonly GoogleDelegationService[]): string[] {
  return [...new Set(services.flatMap(googleDelegationScopes))].sort()
}

/** RFC 5321's limit on a forward path, which a Workspace sign-in address can't exceed. */
const MAX_DELEGATION_USER_LENGTH = 254

/** A Google Workspace user's email address, the `sub` a delegated token acts as. */
export function isGoogleDelegationUser(value: string): boolean {
  return (
    value.length <= MAX_DELEGATION_USER_LENGTH && impersonateEmailSchema.safeParse(value).success
  )
}

/**
 * What a Google service account connect dialog offers for keyless setup.
 *
 * - `offer`: a Google Cloud service or a delegable Google Workspace service
 *   (new or reconnect), or a keyless credential reconnected from a context that
 *   names no service (its own detail page).
 * - `cloud_only`: a keyless credential reconnected from another Google
 *   Workspace service, which can never use it; the dialog explains instead of saving.
 * - `none`: JSON key only.
 */
export function googleKeylessOffer(input: {
  /** The OAuth service or provider id the dialog was opened for, when it was opened for one. */
  oauthServiceId?: string
  /** This deployment can sign workload-identity tokens for this owner. */
  available: boolean
  /** The credential being reconnected is keyless. */
  reconnectsKeyless: boolean
}): 'offer' | 'cloud_only' | 'none' {
  if (!input.available) return 'none'
  const service = input.oauthServiceId
  if (service && isGoogleKeylessService(service)) return 'offer'
  if (!input.reconnectsKeyless) return 'none'
  return service ? 'cloud_only' : 'offer'
}

/** The `type` of a keyless credential's stored secret; a JSON key's is `service_account`. */
export const GOOGLE_WORKLOAD_IDENTITY_SECRET_TYPE = 'google_workload_identity_v1' as const

/** Whether a decrypted `google-service-account` secret is a keyless one. */
export function isGoogleWorkloadIdentitySecret(decrypted: string): boolean {
  try {
    const parsed: unknown = JSON.parse(decrypted)
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === GOOGLE_WORKLOAD_IDENTITY_SECRET_TYPE
    )
  } catch {
    return false
  }
}

/** A project number is Google's numeric project identifier, not the project ID. */
const PROJECT_NUMBER_PATTERN = /^[1-9][0-9]{0,19}$/

/**
 * Pool and provider IDs: "4-32 characters, and may contain the characters
 * [a-z0-9-]. The prefix `gcp-` is reserved for use by Google".
 * @see https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools/create
 */
const POOL_OR_PROVIDER_ID_PATTERN = /^(?!gcp-)[a-z0-9-]{4,32}$/

/**
 * A user-managed service account: an account ID of 6-30 characters matching
 * `[a-z]([-a-z0-9]*[a-z0-9])`, in a project whose ID follows the same rule.
 * @see https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create
 */
const SERVICE_ACCOUNT_EMAIL_PATTERN =
  /^[a-z][-a-z0-9]{4,28}[a-z0-9]@[a-z][-a-z0-9]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/

/**
 * A Google Cloud project number: digits only, no leading zero, up to 20 digits
 * (`123456789012`). The project ID (`my-project`) is not accepted.
 */
export function isGoogleProjectNumber(value: string): boolean {
  return PROJECT_NUMBER_PATTERN.test(value)
}

/**
 * A workload identity pool or provider ID: 4-32 lowercase letters, digits, or
 * hyphens, not starting with the reserved `gcp-` prefix.
 */
export function isGoogleWorkloadIdentityId(value: string): boolean {
  return POOL_OR_PROVIDER_ID_PATTERN.test(value)
}

/**
 * A user-managed service account email, `<account-id>@<project-id>.iam.gserviceaccount.com`,
 * where both IDs are 6-30 characters of lowercase letters, digits, and hyphens,
 * start with a letter, and end with a letter or digit.
 */
export function isGoogleServiceAccountEmail(value: string): boolean {
  return SERVICE_ACCOUNT_EMAIL_PATTERN.test(value)
}

/** The customer's workload identity provider, by the IDs that name it. */
export interface GoogleWorkloadIdentityProviderRef {
  projectNumber: string
  poolId: string
  providerId: string
}

/** `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`. */
export function googleWorkloadIdentityProviderName(ref: GoogleWorkloadIdentityProviderRef): string {
  if (
    !isGoogleProjectNumber(ref.projectNumber) ||
    !isGoogleWorkloadIdentityId(ref.poolId) ||
    !isGoogleWorkloadIdentityId(ref.providerId)
  ) {
    throw new Error('Invalid Google workload identity provider')
  }
  return `projects/${ref.projectNumber}/locations/global/workloadIdentityPools/${ref.poolId}/providers/${ref.providerId}`
}

/**
 * The `aud` of Sim's token. A provider with no allowed audiences accepts "the
 * full canonical resource name of the WorkloadIdentityPoolProvider, with or
 * without the HTTPS prefix"; Google's setup guide shows the `https://` form.
 * @see https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.locations.workloadIdentityPools.providers
 */
export function googleWorkloadIdentityAudience(ref: GoogleWorkloadIdentityProviderRef): string {
  return `https://iam.googleapis.com/${googleWorkloadIdentityProviderName(ref)}`
}

/**
 * The STS `audience` parameter, in the form the token-exchange reference gives
 * for workload identity pools.
 * @see https://docs.cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token
 */
export function googleStsAudience(ref: GoogleWorkloadIdentityProviderRef): string {
  return `//iam.googleapis.com/${googleWorkloadIdentityProviderName(ref)}`
}

/** The federated principal Google maps a Sim token with this subject to. */
export function googleWorkloadIdentityPrincipal(
  ref: GoogleWorkloadIdentityProviderRef,
  subject: string
): string {
  googleWorkloadIdentityProviderName(ref)
  return `principal://iam.googleapis.com/projects/${ref.projectNumber}/locations/global/workloadIdentityPools/${ref.poolId}/subject/${subject}`
}

/**
 * The role this credential's subject needs on the service account.
 * `roles/iam.workloadIdentityUser` grants `getAccessToken` but not `signJwt`,
 * which domain-wide delegation signs its assertion with;
 * `roles/iam.serviceAccountTokenCreator` grants both.
 * @see https://docs.cloud.google.com/iam/docs/roles-permissions/iam
 */
export function googleWorkloadIdentityRole(domainWideDelegation: boolean): string {
  return domainWideDelegation
    ? 'roles/iam.serviceAccountTokenCreator'
    : 'roles/iam.workloadIdentityUser'
}

/**
 * The gcloud commands that set up trust for one credential: the pool, an OIDC
 * provider for Sim's issuer that accepts only this credential's subject, and
 * the binding that lets that subject impersonate the service account (and, with
 * domain-wide delegation, sign for it). Without a custom audience the provider
 * sets no allowed audiences, so it accepts its own resource name; with one, it
 * allows only that audience.
 */
export function googleWorkloadIdentitySetupCommands(input: {
  ref: GoogleWorkloadIdentityProviderRef
  serviceAccountEmail: string
  issuer: string
  subject: string
  domainWideDelegation?: boolean
  /** The audience Sim's tokens carry; the provider's own name or none sets no allowed audiences. */
  audience?: string
}): string {
  const { ref, serviceAccountEmail, issuer, subject } = input
  const { audience: customAudience } = storedAudienceField(
    input.audience?.trim(),
    googleWorkloadIdentityAudience(ref),
    googleStsAudience(ref)
  )
  return [
    `gcloud iam workload-identity-pools create ${ref.poolId} \\`,
    `    --project="${ref.projectNumber}" \\`,
    '    --location="global" \\',
    '    --display-name="Sim"',
    '',
    `gcloud iam workload-identity-pools providers create-oidc ${ref.providerId} \\`,
    `    --project="${ref.projectNumber}" \\`,
    '    --location="global" \\',
    `    --workload-identity-pool="${ref.poolId}" \\`,
    `    --issuer-uri="${issuer}" \\`,
    ...(customAudience ? [`    --allowed-audiences="${customAudience}" \\`] : []),
    '    --attribute-mapping="google.subject=assertion.sub" \\',
    `    --attribute-condition="assertion.sub=='${subject}'"`,
    '',
    `gcloud iam service-accounts add-iam-policy-binding ${serviceAccountEmail} \\`,
    `    --project="${ref.projectNumber}" \\`,
    `    --role="${googleWorkloadIdentityRole(input.domainWideDelegation ?? false)}" \\`,
    `    --member="${googleWorkloadIdentityPrincipal(ref, subject)}"`,
  ].join('\n')
}
