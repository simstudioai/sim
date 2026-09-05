import { ensureWorkspaceAccountsContract } from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { ensureWorkspaceAccounts } from '@/lib/credential-groups/application/manage-groups'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const POST = defineInternalJsonRoute({
  contract: ensureWorkspaceAccountsContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.ensureWorkspaceAccounts,
  rateLimit: internalRateLimits.none({ reason: 'Idempotent, admin-only workspace account setup' }),
  errorPolicy: createCredentialGroupInternalErrorPolicy(
    'Failed to set up connected accounts',
    'Workspace not found'
  ),
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: ensureWorkspaceAccounts,
  present: ({ credentialGroup }) => ({ credentialGroup }),
})
