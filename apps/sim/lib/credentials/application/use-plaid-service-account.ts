import { AuditAction, AuditResourceType } from '@sim/audit'
import type { PlaidOperationBody, PlaidOperationResponse } from '@/lib/api/contracts/tools/plaid'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineAuthorizedCredentialUseCase } from '@/lib/credentials/application/authorized-credential-use-case'
import { resolveCredentialApplicationContext } from '@/lib/credentials/application/credential-context'
import { defineCredentialOperation } from '@/lib/credentials/application/operations'
import { decryptPlaidServiceAccountCredential } from '@/lib/credentials/plaid-service-account'
import { PLAID_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { executePlaidProviderRequest } from '@/tools/plaid/utils.server'

export interface UsePlaidServiceAccountInput {
  body: PlaidOperationBody
  signal: AbortSignal
}

const usePlaidCredentialOperation = defineCredentialOperation(
  defineWorkspaceOperation({
    id: 'credentials.plaid.use',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
  }),
  'member'
)

export const usePlaidServiceAccount = defineAuthorizedCredentialUseCase({
  operation: usePlaidCredentialOperation,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: { workspaceId: string }
    input: UsePlaidServiceAccountInput
  }) =>
    resolveCredentialApplicationContext({
      credentialId: input.body.credentialId,
      assertedWorkspaceId: principal.workspaceId,
    }),
  execute: async ({ input, context }): Promise<PlaidOperationResponse> => {
    const stored = await decryptPlaidServiceAccountCredential(context.credential)

    return executePlaidProviderRequest({
      body: input.body,
      credential: stored,
      signal: input.signal,
    })
  },
  projectAudit: ({ input, context }) => ({
    action: AuditAction.CREDENTIAL_ACCESSED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: context.credential.id,
    description: `Accessed Plaid service account credential for ${input.body.operation}`,
    metadata: {
      provider: PLAID_SERVICE_ACCOUNT_PROVIDER_ID,
      credentialType: 'service_account',
      toolId: input.body.operation,
    },
  }),
})
