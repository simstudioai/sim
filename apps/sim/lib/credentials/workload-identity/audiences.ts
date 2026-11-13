import { z } from 'zod'
import { SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/token-service-accounts/descriptors'
import {
  AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/oauth/types'

/** Relying parties that trust Sim's workload-identity issuer. */
export const WORKLOAD_IDENTITY_PROVIDERS = [
  'aws',
  'databricks',
  'snowflake',
  'microsoft',
  'google',
] as const

export type WorkloadIdentityProvider = (typeof WORKLOAD_IDENTITY_PROVIDERS)[number]

/**
 * Every auth mode a provider's saved credential can hold, keyless first: the stored
 * `authType` a reconnect reopens on, so a key-based credential keeps its own mode.
 */
export const WORKLOAD_IDENTITY_PROVIDER_AUTH_TYPES = {
  aws: ['oidc_role', 'assume_role', 'access_keys'],
  databricks: ['oidc_federation', 'service_principal', 'personal_access_token'],
  snowflake: ['workload_identity', 'key_pair', 'programmatic_access_token'],
  microsoft: ['federated', 'client_secret', 'certificate'],
  google: ['workload_identity', 'json_key'],
} as const satisfies Record<WorkloadIdentityProvider, readonly string[]>

export type WorkloadIdentityProviderAuthType<
  P extends WorkloadIdentityProvider = WorkloadIdentityProvider,
> = (typeof WORKLOAD_IDENTITY_PROVIDER_AUTH_TYPES)[P][number]

/** Every provider's auth modes in one list, for the reconnect contract. */
export const WORKLOAD_IDENTITY_AUTH_TYPE_LIST = [
  ...new Set(Object.values(WORKLOAD_IDENTITY_PROVIDER_AUTH_TYPES).flat()),
] as [WorkloadIdentityProviderAuthType, ...WorkloadIdentityProviderAuthType[]]

/** The service-account provider ID each relying party's keyless credential is created under. */
const WORKLOAD_IDENTITY_SERVICE_ACCOUNT_PROVIDER_IDS = {
  aws: AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  databricks: DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
  snowflake: SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
  microsoft: MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
  google: GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
} as const satisfies Record<WorkloadIdentityProvider, string>

export type WorkloadIdentityServiceAccountProviderId =
  (typeof WORKLOAD_IDENTITY_SERVICE_ACCOUNT_PROVIDER_IDS)[WorkloadIdentityProvider]

/**
 * What each provider's keyless `serviceAccountJson` holds besides the issued
 * `subject` and `subjectProof`: its `authType`, and the values the customer
 * supplies from their own cloud setup.
 */
export const WORKLOAD_IDENTITY_KEYLESS_CONFIGS: Record<
  WorkloadIdentityProvider,
  {
    authType: string
    requiredFields: readonly string[]
    optionalFields: readonly string[]
    /** Where a keyless credential works, when that is narrower than the provider. */
    scope?: string
  }
> = {
  aws: {
    authType: 'oidc_role',
    requiredFields: ['roleArn'],
    optionalFields: ['stsRegion', 'sessionDurationSeconds', 'audience'],
  },
  databricks: {
    authType: 'oidc_federation',
    requiredFields: ['host', 'clientId'],
    optionalFields: ['audience'],
  },
  snowflake: {
    authType: 'workload_identity',
    requiredFields: ['host'],
    optionalFields: ['audience'],
  },
  microsoft: {
    authType: 'federated',
    requiredFields: ['tenantId', 'clientId'],
    optionalFields: ['environmentUrl', 'cloud', 'audience'],
  },
  google: {
    authType: 'workload_identity',
    requiredFields: ['projectNumber', 'poolId', 'providerId', 'serviceAccountEmail'],
    optionalFields: ['delegation', 'audience'],
    scope:
      'Keyless works for Google Cloud services such as BigQuery and Vertex AI. For Gmail, Google Drive, Google Docs, Google Sheets, and Google Calendar, add `delegation` as {"user": "<Workspace user email>", "services": ["gmail", "google-drive", "google-docs", "google-sheets", "google-calendar"]} (the services you need) for domain-wide delegation: grant the subject roles/iam.serviceAccountTokenCreator instead of roles/iam.workloadIdentityUser, authorize the service account’s client ID for those services’ scopes in the Google Workspace Admin console, and workflows act only as that user. Other Google Workspace services need a JSON key.',
  },
}

/** Every service-account provider ID that can hold a keyless credential. */
export const WORKLOAD_IDENTITY_SERVICE_ACCOUNT_PROVIDER_ID_LIST = WORKLOAD_IDENTITY_PROVIDERS.map(
  (provider) => WORKLOAD_IDENTITY_SERVICE_ACCOUNT_PROVIDER_IDS[provider]
) as [WorkloadIdentityServiceAccountProviderId, ...WorkloadIdentityServiceAccountProviderId[]]

const PROVIDER_BY_SERVICE_ACCOUNT_PROVIDER_ID: ReadonlyMap<string, WorkloadIdentityProvider> =
  new Map(
    WORKLOAD_IDENTITY_PROVIDERS.map((provider) => [
      WORKLOAD_IDENTITY_SERVICE_ACCOUNT_PROVIDER_IDS[provider],
      provider,
    ])
  )

/** Whether a service-account provider can hold a keyless credential. */
export function isWorkloadIdentityServiceAccountProviderId(
  providerId: string | null | undefined
): providerId is WorkloadIdentityServiceAccountProviderId {
  return providerId != null && PROVIDER_BY_SERVICE_ACCOUNT_PROVIDER_ID.has(providerId)
}

/** The relying party a keyless service-account provider ID trusts Sim through. */
export function workloadIdentityProviderFor(
  providerId: WorkloadIdentityServiceAccountProviderId
): WorkloadIdentityProvider {
  const provider = PROVIDER_BY_SERVICE_ACCOUNT_PROVIDER_ID.get(providerId)
  if (!provider) throw new Error(`No workload identity provider for ${providerId}`)
  return provider
}

/**
 * Relying parties that expect one audience for every credential. Google expects
 * each credential's own workload identity provider as its audience (see
 * `googleWorkloadIdentityAudience`), so it has no entry here.
 */
type FixedAudienceWorkloadIdentityProvider = Exclude<WorkloadIdentityProvider, 'google'>

/**
 * The default `aud` claim for each relying party, used when a keyless credential
 * sets no `audience` of its own (see `workloadIdentityAudienceSchema`). AWS STS
 * conventionally uses its own client ID; Databricks federation policies list
 * whatever audience the customer enters, so Sim publishes one default to paste. Snowflake accepts
 * `snowflakecomputing.com` without any `OIDC_AUDIENCE_LIST` on the user, so the
 * customer's `CREATE USER` names only the issuer and subject. Microsoft Entra
 * federated identity credentials take one audience, and Microsoft recommends
 * `api://AzureADTokenExchange`
 * (https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust).
 */
export const WORKLOAD_IDENTITY_AUDIENCES: Record<FixedAudienceWorkloadIdentityProvider, string> = {
  aws: 'sts.amazonaws.com',
  databricks: 'sim-databricks',
  snowflake: 'snowflakecomputing.com',
  microsoft: 'api://AzureADTokenExchange',
}

/** The provider's default audience, or undefined when each credential has its own (Google). */
export function fixedWorkloadIdentityAudience(
  provider: WorkloadIdentityProvider
): string | undefined {
  return provider === 'google' ? undefined : WORKLOAD_IDENTITY_AUDIENCES[provider]
}

/** The longest custom audience accepted: AWS caps an OIDC provider client ID at 255 characters. */
const MAX_WORKLOAD_IDENTITY_AUDIENCE_LENGTH = 255

/**
 * URI, account ID, and ARN characters. Leaving out quotes, commas, backslashes,
 * `$`, and `!` keeps an audience safe to paste into every setup snippet Sim shows
 * (a shell-quoted policy, a SQL string, a gcloud audience list) without escaping.
 */
const AUDIENCE_PATTERN = /^[A-Za-z0-9._~:/?#@&+=%-]+$/

function buildAudienceSchema(provider: WorkloadIdentityProvider) {
  const othersDefaults = new Set(
    WORKLOAD_IDENTITY_PROVIDERS.filter((other) => other !== provider).flatMap((other) => {
      const audience = fixedWorkloadIdentityAudience(other)
      return audience ? [audience] : []
    })
  )
  return z
    .string()
    .trim()
    .min(1, 'Audience cannot be empty')
    .max(
      MAX_WORKLOAD_IDENTITY_AUDIENCE_LENGTH,
      `Audience must be at most ${MAX_WORKLOAD_IDENTITY_AUDIENCE_LENGTH} characters`
    )
    .regex(
      AUDIENCE_PATTERN,
      'Audience can use only letters, digits, and the characters . _ ~ : / ? # @ & + = % -'
    )
    .refine((audience) => !othersDefaults.has(audience), {
      message: 'That audience belongs to another cloud. Use the default or your own value.',
    })
    .refine((audience) => provider === 'google' || !isGoogleProviderAudience(audience), {
      message: 'That audience belongs to Google Cloud. Use the default or your own value.',
    })
}

const AUDIENCE_SCHEMAS = Object.fromEntries(
  WORKLOAD_IDENTITY_PROVIDERS.map((provider) => [provider, buildAudienceSchema(provider)])
) as Record<WorkloadIdentityProvider, ReturnType<typeof buildAudienceSchema>>

/**
 * A keyless credential's own `aud` claim, so a customer can pin their trust
 * configuration to an audience no other Sim credential is issued for (their
 * Databricks account ID, say). Another relying party's default is refused: a
 * credential for one cloud never carries a token another cloud would accept.
 * Built once per provider, so the connect dialog can check each keystroke.
 */
export function workloadIdentityAudienceSchema(provider: WorkloadIdentityProvider) {
  return AUDIENCE_SCHEMAS[provider]
}

/** A Google workload identity provider's resource-name audience. */
function isGoogleProviderAudience(audience: string): boolean {
  return /^(https:)?\/\/iam\.googleapis\.com\//i.test(audience)
}

/**
 * The optional `audience` field of a stored keyless config. Bounded by length only,
 * so a credential saved before a submit-time rule tightened still reads.
 */
export const storedWorkloadIdentityAudienceSchema = z
  .string()
  .min(1)
  .max(MAX_WORKLOAD_IDENTITY_AUDIENCE_LENGTH)
  .optional()

/**
 * The audience field to spread into a stored keyless config: empty when none was
 * submitted or it is a default, so a default-audience credential keeps the exact
 * stored shape earlier releases read. A reconnect that submits none therefore
 * returns to the default.
 */
export function storedAudienceField(
  submitted: string | undefined,
  ...defaultAudiences: string[]
): { audience?: string } {
  return submitted && !defaultAudiences.includes(submitted) ? { audience: submitted } : {}
}
