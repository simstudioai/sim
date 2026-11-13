import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { storedAwsReconnectFields } from '@/lib/credentials/aws-service-account.server'
import { storedDatabricksReconnectFields } from '@/lib/credentials/databricks-service-account.server'
import {
  type GoogleStoredDelegation,
  storedGoogleReconnectFields,
} from '@/lib/credentials/google-workload-identity.server'
import { storedMicrosoftAppReconnectFields } from '@/lib/credentials/microsoft-app-service-account.server'
import type { MicrosoftCloudId } from '@/lib/credentials/microsoft-clouds'
import { storedSnowflakeReconnectFields } from '@/lib/credentials/snowflake-service-account.server'
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

/**
 * What a reconnect reopens on, read from the stored secret: absent without a
 * credential being reconnected, or for anyone but its admin.
 */
interface ReconnectFields<P extends WorkloadIdentityProvider = WorkloadIdentityProvider> {
  /** The stored mode. */
  reconnectAuthType?: WorkloadIdentityProviderAuthType<P>
  /** A keyless Google credential's domain-wide delegation, so a reconnect keeps it. */
  reconnectDelegation?: GoogleStoredDelegation
  /** A Microsoft app credential's national cloud; absent for a global one. */
  reconnectCloud?: MicrosoftCloudId
  /** A keyless credential's custom audience; absent when it uses the default. */
  reconnectAudience?: string
}

export type PrepareWorkloadIdentityResult =
  | ({ available: false } & ReconnectFields)
  | ({
      available: true
      issuer: string
      /** Absent for Google, whose audience is each credential's own workload identity provider. */
      audience?: string
      subject: string
      subjectProof: string
      expiresAt: string
    } & ReconnectFields)

/** What a provider's stored-secret reader returns: the non-secret fields a reconnect keeps. */
interface StoredReconnectRead<P extends WorkloadIdentityProvider> {
  authType?: WorkloadIdentityProviderAuthType<P>
  audience?: string
  cloud?: MicrosoftCloudId
  delegation?: GoogleStoredDelegation
}

function reconnectFrom<P extends WorkloadIdentityProvider>(
  read: (decrypted: string) => StoredReconnectRead<P>
): (decrypted: string) => ReconnectFields<P> {
  return (decrypted) => {
    const { authType, audience, cloud, delegation } = read(decrypted)
    return {
      ...(authType ? { reconnectAuthType: authType } : {}),
      ...(audience ? { reconnectAudience: audience } : {}),
      ...(cloud ? { reconnectCloud: cloud } : {}),
      ...(delegation ? { reconnectDelegation: delegation } : {}),
    }
  }
}

/**
 * Every keyless provider also has key-based modes under the same provider ID, so a
 * reconnect reads the stored secret's mode and the dialog reopens on it rather than
 * on a default that would drop the credential's role, secret, or certificate. A
 * provider whose mode has further non-secret settings a reconnect must keep (a
 * Google credential's domain-wide delegation, a Microsoft app credential's national
 * cloud, a keyless credential's custom audience) reads those here too.
 */
const STORED_RECONNECT: {
  [P in WorkloadIdentityProvider]: (decrypted: string) => ReconnectFields<P>
} = {
  aws: reconnectFrom<'aws'>(storedAwsReconnectFields),
  databricks: reconnectFrom<'databricks'>(storedDatabricksReconnectFields),
  snowflake: reconnectFrom<'snowflake'>(storedSnowflakeReconnectFields),
  microsoft: reconnectFrom<'microsoft'>(storedMicrosoftAppReconnectFields),
  google: reconnectFrom<'google'>(storedGoogleReconnectFields),
}

/**
 * What a reconnect of this provider's credential in this workspace, which this
 * person administers, reopens on. Only these non-secret fields leave the stored
 * secret, and only for someone allowed to reconnect the credential.
 */
async function storedReconnectFields(
  provider: WorkloadIdentityProvider,
  credentialId: string,
  workspaceId: string,
  userId: string
): Promise<ReconnectFields> {
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
    return {}
  }
  const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
  return STORED_RECONNECT[provider](decrypted)
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
    const reconnect = input.credentialId
      ? await storedReconnectFields(
          input.provider,
          input.credentialId,
          input.workspaceId,
          requirePrincipalSubjectUserId(principal)
        )
      : {}
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
