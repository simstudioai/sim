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
  snowflake: ['workload_identity', 'programmatic_access_token'],
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
    optionalFields: ['stsRegion', 'sessionDurationSeconds'],
  },
  databricks: {
    authType: 'oidc_federation',
    requiredFields: ['host', 'clientId'],
    optionalFields: [],
  },
  snowflake: { authType: 'workload_identity', requiredFields: ['host'], optionalFields: [] },
  microsoft: {
    authType: 'federated',
    requiredFields: ['tenantId', 'clientId'],
    optionalFields: ['environmentUrl'],
  },
  google: {
    authType: 'workload_identity',
    requiredFields: ['projectNumber', 'poolId', 'providerId', 'serviceAccountEmail'],
    optionalFields: [],
    scope:
      'Keyless works only for Google Cloud services such as BigQuery and Vertex AI, not Google Workspace (Gmail, Drive, Sheets, Calendar, and the like), which need a JSON key with domain-wide delegation.',
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
 * The `aud` claim each relying party expects. AWS STS requires its own client
 * ID; Databricks federation policies list whatever audience the customer
 * enters, so Sim publishes one fixed value for them to paste. Snowflake accepts
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

/** The provider's fixed audience, or undefined when each credential has its own (Google). */
export function fixedWorkloadIdentityAudience(
  provider: WorkloadIdentityProvider
): string | undefined {
  return provider === 'google' ? undefined : WORKLOAD_IDENTITY_AUDIENCES[provider]
}
