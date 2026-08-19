import { AuditAction, AuditResourceType } from '@sim/audit'
import { safeCompare } from '@sim/security/compare'
import type { PlaidOperationBody, PlaidOperationResponse } from '@/lib/api/contracts/tools/plaid'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import { defineAuthorizedCredentialUseCase } from '@/lib/credentials/application/authorized-credential-use-case'
import { resolveCredentialApplicationContext } from '@/lib/credentials/application/credential-context'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { parsePlaidServiceAccountSecretBlob } from '@/lib/credentials/plaid-service-account'
import type { CredentialRow } from '@/lib/credentials/queries'
import { PLAID_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { executePlaidProviderRequest } from '@/tools/plaid/utils.server'

export interface UsePlaidServiceAccountInput {
  body: PlaidOperationBody
  signal: AbortSignal
}

type PlaidCredentialRow = Pick<CredentialRow, 'type' | 'providerId' | 'encryptedServiceAccountKey'>

export async function resolvePlaidServiceAccountForExecution(
  credential: PlaidCredentialRow,
  accessToken: string
) {
  if (
    credential.type !== 'service_account' ||
    credential.providerId !== PLAID_SERVICE_ACCOUNT_PROVIDER_ID ||
    !credential.encryptedServiceAccountKey
  ) {
    throw new OrchestrationError('not_found', 'Credential not found')
  }

  let stored
  try {
    const { decrypted } = await decryptSecret(credential.encryptedServiceAccountKey)
    stored = parsePlaidServiceAccountSecretBlob(decrypted)
  } catch {
    throw new OrchestrationError(
      'unauthorized',
      'Plaid credential is no longer usable; reconnect it from Integrations'
    )
  }

  if (!safeCompare(accessToken, stored.accessToken)) {
    throw new OrchestrationError('forbidden', 'Credential token does not match')
  }
  return stored
}

export const usePlaidServiceAccount = defineAuthorizedCredentialUseCase({
  operation: credentialOperations.useServiceAccount,
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
    const stored = await resolvePlaidServiceAccountForExecution(
      context.credential,
      input.body.accessToken
    )

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
