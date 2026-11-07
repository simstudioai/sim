/** Relying parties that trust Sim's workload-identity issuer. */
export const WORKLOAD_IDENTITY_PROVIDERS = ['aws', 'databricks'] as const

export type WorkloadIdentityProvider = (typeof WORKLOAD_IDENTITY_PROVIDERS)[number]

/**
 * The `aud` claim each relying party expects. AWS STS requires its own client
 * ID; Databricks federation policies list whatever audience the customer
 * enters, so Sim publishes one fixed value for them to paste.
 */
export const WORKLOAD_IDENTITY_AUDIENCES: Record<WorkloadIdentityProvider, string> = {
  aws: 'sts.amazonaws.com',
  databricks: 'sim-databricks',
}
