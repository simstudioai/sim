import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { storedAwsAuthType } from '@/lib/credentials/aws-service-account.server'
import { storedDatabricksAuthType } from '@/lib/credentials/databricks-service-account.server'
import { isGoogleWorkloadIdentitySecret } from '@/lib/credentials/google-workload-identity'
import { storedMicrosoftAppAuthType } from '@/lib/credentials/microsoft-app-service-account.server'
import { storedSnowflakeAuthType } from '@/lib/credentials/snowflake-service-account.server'
import {
  fixedWorkloadIdentityAudience,
  isWorkloadIdentityServiceAccountProviderId,
  type WorkloadIdentityProvider,
  type WorkloadIdentityProviderAuthType,
  workloadIdentityProviderFor,
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
  /** The credential being reconnected, so the dialog can open on its current mode. */
  credentialId?: string
}

/** The reconnected credential's stored mode; absent without one, or for anyone but its admin. */
interface ReconnectAuthTypeField {
  reconnectAuthType?: WorkloadIdentityProviderAuthType
}

export type PrepareWorkloadIdentityResult =
  | ({ available: false } & ReconnectAuthTypeField)
  | ({
      available: true
      issuer: string
      /** Absent for Google, whose audience is each credential's own workload identity provider. */
      audience?: string
      subject: string
      subjectProof: string
      expiresAt: string
    } & ReconnectAuthTypeField)

/**
 * Every keyless provider also has key-based modes under the same provider ID, so a
 * reconnect reads the stored secret's mode and the dialog reopens on it rather than
 * on a default that would drop the credential's role, secret, or certificate.
 */
const STORED_AUTH_TYPE: {
  [P in WorkloadIdentityProvider]: (
    decrypted: string
  ) => WorkloadIdentityProviderAuthType<P> | undefined
} = {
  aws: storedAwsAuthType,
  databricks: storedDatabricksAuthType,
  snowflake: storedSnowflakeAuthType,
  microsoft: storedMicrosoftAppAuthType,
  google: (decrypted) =>
    isGoogleWorkloadIdentitySecret(decrypted) ? 'workload_identity' : 'json_key',
}

/**
 * The stored auth mode of a credential of this provider in this workspace, which
 * this person administers. Only the mode leaves the stored secret, and only for
 * someone allowed to reconnect the credential.
 */
async function storedReconnectAuthType(
  provider: WorkloadIdentityProvider,
  credentialId: string,
  workspaceId: string,
  userId: string
): Promise<WorkloadIdentityProviderAuthType | undefined> {
  const access = await getCredentialActorContext(credentialId, userId, { workspaceId })
  const row = access.credential
  if (
    !access.isAdmin ||
    !row ||
    row.workspaceId !== workspaceId ||
    row.type !== 'service_account' ||
    !isWorkloadIdentityServiceAccountProviderId(row.providerId) ||
    workloadIdentityProviderFor(row.providerId) !== provider ||
    !row.encryptedServiceAccountKey
  ) {
    return undefined
  }
  const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
  return STORED_AUTH_TYPE[provider](decrypted)
}

/**
 * Starts a keyless cloud connection (an AWS role, a Databricks service
 * principal, a Snowflake service user, a Microsoft app, or a Google service account): the subject the customer's trust
 * configuration will pin, signed for this person and workspace so only they can attach it to the credential
 * they are about to create. Reports `available: false` when this deployment
 * cannot sign tokens, so the connect dialog offers only key-based modes. On a
 * reconnect it also reports the credential's stored mode, signing or not.
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
    const reconnectAuthType = input.credentialId
      ? await storedReconnectAuthType(
          input.provider,
          input.credentialId,
          input.workspaceId,
          requirePrincipalSubjectUserId(principal)
        )
      : undefined
    const reconnect = reconnectAuthType ? { reconnectAuthType } : {}
    // A deployment without a signing key offers only key- and secret-based credentials.
    if (!(await isWorkloadIdentityConfigured())) return { available: false, ...reconnect }
    const userId = requirePrincipalSubjectUserId(principal)
    const grant = issueWorkloadIdentitySubject(
      input.provider,
      { workspaceId: input.workspaceId },
      userId
    )
    const audience = fixedWorkloadIdentityAudience(input.provider)
    return {
      available: true,
      issuer: getWorkloadIdentityIssuer(),
      ...(audience ? { audience } : {}),
      ...grant,
      ...reconnect,
    }
  },
})
