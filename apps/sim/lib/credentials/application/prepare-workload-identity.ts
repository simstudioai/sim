import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { credentialDelegationPolicy } from '@/lib/credentials/application/authorization'
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

export interface PrepareWorkloadIdentityResult {
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
 * they are about to create.
 */
export const prepareWorkloadIdentity = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.prepareWorkloadIdentity,
  resolveContext: async ({ input }: { input: PrepareWorkloadIdentityInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: { delegation: credentialDelegationPolicy },
  execute: async ({ principal, input }): Promise<PrepareWorkloadIdentityResult> => {
    if (!isWorkloadIdentityConfigured()) {
      throw new OrchestrationError(
        'conflict',
        'Keyless connections are not available on this deployment. Use a key or secret instead.'
      )
    }
    const grant = issueWorkloadIdentitySubject(
      input.provider,
      { workspaceId: input.workspaceId },
      requirePrincipalSubjectUserId(principal)
    )
    return {
      issuer: getWorkloadIdentityIssuer(),
      audience: WORKLOAD_IDENTITY_AUDIENCES[input.provider],
      ...grant,
    }
  },
})
