import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { isGoogleWorkloadIdentitySecret } from '@/lib/credentials/google-workload-identity'
import { isKeylessMicrosoftAppSecret } from '@/lib/credentials/microsoft-app-service-account.server'
import { isKeylessSnowflakeSecret } from '@/lib/credentials/snowflake-service-account.server'
import { SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/token-service-accounts/descriptors'
import {
  fixedWorkloadIdentityAudience,
  type WorkloadIdentityProvider,
} from '@/lib/credentials/workload-identity/audiences'
import {
  getWorkloadIdentityIssuer,
  isWorkloadIdentityConfigured,
} from '@/lib/credentials/workload-identity/issuer'
import { issueWorkloadIdentitySubject } from '@/lib/credentials/workload-identity/subject'
import {
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/oauth/types'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

export interface PrepareWorkloadIdentityInput {
  workspaceId: string
  provider: WorkloadIdentityProvider
  /** The credential being reconnected, so the dialog can open on its current mode. */
  credentialId?: string
}

export type PrepareWorkloadIdentityResult =
  | { available: false }
  | {
      available: true
      issuer: string
      /** Absent for Google, whose audience is each credential's own workload identity provider. */
      audience?: string
      subject: string
      subjectProof: string
      expiresAt: string
      /** The reconnected credential is keyless; absent when there is none or it is not. */
      reconnectsKeyless?: true
    }

/** Providers whose credentials can be keyless or key-based under one provider ID. */
const MIXED_MODE_PROVIDERS: Partial<
  Record<
    WorkloadIdentityProvider,
    { providerId: string; isKeyless: (decrypted: string) => boolean }
  >
> = {
  snowflake: {
    providerId: SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
    isKeyless: isKeylessSnowflakeSecret,
  },
  microsoft: {
    providerId: MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
    isKeyless: isKeylessMicrosoftAppSecret,
  },
  google: {
    providerId: GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
    isKeyless: isGoogleWorkloadIdentitySecret,
  },
}

/**
 * Whether a Snowflake, Microsoft app, or Google credential in this workspace, which this person
 * administers, is keyless. Only that one bit leaves the stored secret, and only
 * for someone allowed to reconnect the credential.
 */
async function isKeylessCredential(
  provider: WorkloadIdentityProvider,
  credentialId: string,
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const mixedMode = MIXED_MODE_PROVIDERS[provider]
  const access = await getCredentialActorContext(credentialId, userId, { workspaceId })
  const row = access.credential
  if (
    !access.isAdmin ||
    !row ||
    row.workspaceId !== workspaceId ||
    row.type !== 'service_account' ||
    !mixedMode ||
    row.providerId !== mixedMode.providerId ||
    !row.encryptedServiceAccountKey
  ) {
    return false
  }
  const { decrypted } = await decryptSecret(row.encryptedServiceAccountKey)
  return mixedMode.isKeyless(decrypted)
}

/**
 * Starts a keyless cloud connection (an AWS role, a Databricks service
 * principal, a Snowflake service user, a Microsoft app, or a Google service account): the subject the customer's trust
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
      MIXED_MODE_PROVIDERS[input.provider] && input.credentialId
        ? await isKeylessCredential(input.provider, input.credentialId, input.workspaceId, userId)
        : false
    const audience = fixedWorkloadIdentityAudience(input.provider)
    return {
      available: true,
      issuer: getWorkloadIdentityIssuer(),
      ...(audience ? { audience } : {}),
      ...grant,
      ...(reconnectsKeyless ? { reconnectsKeyless: true as const } : {}),
    }
  },
})
