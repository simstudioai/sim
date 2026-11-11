/**
 * Keyless Google Cloud credentials (Workload Identity Federation): the parts
 * the connect dialog and the server share. A keyless credential is a mode of
 * the `google-service-account` credential that stores no key: Sim's signed
 * token is exchanged at Google STS against the customer's workload identity
 * provider, and the federated token impersonates the service account.
 *
 * Every value here ends up in a Google URL or audience, so each one is checked
 * against Google's documented format and nothing else can reach the request.
 *
 * @see https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
 */

/**
 * The Google services a keyless credential may mint for: Google Cloud APIs the
 * service account calls as itself. Google Workspace services need domain-wide
 * delegation, which keyless credentials do not support.
 */
export const GOOGLE_KEYLESS_SERVICES: ReadonlySet<string> = new Set([
  'google-bigquery',
  'vertex-ai',
])

/**
 * What a Google service account connect dialog offers for keyless setup.
 *
 * - `offer`: a Google Cloud service (new or reconnect), or a keyless credential
 *   reconnected from a context that names no service (its own detail page).
 * - `cloud_only`: a keyless credential reconnected from a Google Workspace
 *   service, which can never use it; the dialog explains instead of saving.
 * - `none`: JSON key only.
 */
export function googleKeylessOffer(input: {
  /** The OAuth service the dialog was opened for, when it was opened for one. */
  oauthServiceId?: string
  /** This deployment can sign workload-identity tokens for this owner. */
  available: boolean
  /** The credential being reconnected is keyless. */
  reconnectsKeyless: boolean
}): 'offer' | 'cloud_only' | 'none' {
  if (!input.available) return 'none'
  if (input.oauthServiceId && GOOGLE_KEYLESS_SERVICES.has(input.oauthServiceId)) return 'offer'
  if (!input.reconnectsKeyless) return 'none'
  return input.oauthServiceId ? 'cloud_only' : 'offer'
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
 * The gcloud commands that set up trust for one credential: the pool, an OIDC
 * provider for Sim's issuer that accepts only this credential's subject, and
 * the binding that lets that subject impersonate the service account. The
 * provider sets no allowed audiences, so it accepts its own resource name.
 */
export function googleWorkloadIdentitySetupCommands(input: {
  ref: GoogleWorkloadIdentityProviderRef
  serviceAccountEmail: string
  issuer: string
  subject: string
}): string {
  const { ref, serviceAccountEmail, issuer, subject } = input
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
    '    --attribute-mapping="google.subject=assertion.sub" \\',
    `    --attribute-condition="assertion.sub=='${subject}'"`,
    '',
    `gcloud iam service-accounts add-iam-policy-binding ${serviceAccountEmail} \\`,
    `    --project="${ref.projectNumber}" \\`,
    '    --role="roles/iam.workloadIdentityUser" \\',
    `    --member="${googleWorkloadIdentityPrincipal(ref, subject)}"`,
  ].join('\n')
}
