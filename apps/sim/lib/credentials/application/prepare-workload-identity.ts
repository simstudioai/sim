import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { isKeylessSnowflakeSecret } from '@/lib/credentials/snowflake-service-account.server'
import { SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/token-service-accounts/descriptors'
import {
  WORKLOAD_IDENTITY_AUDIENCES,
  type WorkloadIdentityProvider,
} from '@/lib/credentials/workload-identity/audiences'
import {
  getWorkloadIdentityIssuer,
  isWorkloadIdentityConfigured,
} from '@/lib/credentials/workload-identity/issuer'
import { issueWorkloadIdentitySubject } from '@/lib/credentials/workload-identity/subject'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

export interface PrepareWorkloadIdentityInput {
  workspaceId: string
  provider: WorkloadIdentityProvider
  /** The Snowflake credential being reconnected, so the dialog can open on its current mode. */
  credentialId?: string
}

export type PrepareWorkloadIdentityResult =
  | { available: false }
  | {
      available: true
      issuer: string
      audience: string
      subject: string
      subjectProof: string
      expiresAt: string
      /** The reconnected credential is keyless; absent when there is none or it is not. */
      reconnectsKeyless?: true
    }

/**
 * Whether a Snowflake credential in this workspace, which this person
 * administers, is keyless. Only that one bit leaves the stored secret, and only
 * for someone allowed to reconnect the credential.
 */
async function isKeylessSnowflakeCredential(
  credentialId: string,
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const access = await getCredentialActorContext(credentialId, userId, { workspaceId })
  const row = access.credential
  if (
    !access.isAdmin ||
    !row ||
    row.workspaceId !== workspaceId ||
    row.type !== 'service_account' ||
    row.providerId !== SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID ||
    !row.encryptedServiceAccountKey
  ) {
    return false
  }
  const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
  return isKeylessSnowflakeSecret(decrypted)
}

/**
 * Starts a keyless cloud connection (an AWS role, a Databricks service
 * principal, or a Snowflake service user): the subject the customer's trust
 * configuration will pin, signed for this person and workspace so only they can attach it to the credential
 * they are about to create. Reports `available: false` when this deployment
 * cannot sign tokens, so the connect dialog offers only key-based modes.
 */
export const prepareWorkloadIdentity = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.prepareWorkloadIdentity,
  resolveContext: async ({ input }: { input: PrepareWorkloadIdentityInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  execute: async ({ principal, input }): Promise<PrepareWorkloadIdentityResult> => {
    // A deployment without a signing key offers only key- and secret-based credentials.
    if (!(await isWorkloadIdentityConfigured())) return { available: false }
    const userId = requirePrincipalSubjectUserId(principal)
    const grant = issueWorkloadIdentitySubject(
      input.provider,
      { workspaceId: input.workspaceId },
      userId
    )
    const reconnectsKeyless =
      input.provider === 'snowflake' && input.credentialId
        ? await isKeylessSnowflakeCredential(input.credentialId, input.workspaceId, userId)
        : false
    return {
      available: true,
      issuer: getWorkloadIdentityIssuer(),
      audience: WORKLOAD_IDENTITY_AUDIENCES[input.provider],
      ...grant,
      ...(reconnectsKeyless ? { reconnectsKeyless: true as const } : {}),
    }
  },
})
