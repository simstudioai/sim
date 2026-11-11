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
