import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialOperations } from '@/lib/credentials/application/operations'
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
    }

/**
 * Starts a keyless cloud connection (an AWS role or a Databricks service
 * principal): the subject the customer's trust configuration will pin, signed
 * for this person and workspace so only they can attach it to the credential
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
    const grant = issueWorkloadIdentitySubject(
      input.provider,
      { workspaceId: input.workspaceId },
      requirePrincipalSubjectUserId(principal)
    )
    return {
      available: true,
      issuer: getWorkloadIdentityIssuer(),
      audience: WORKLOAD_IDENTITY_AUDIENCES[input.provider],
      ...grant,
    }
  },
})
