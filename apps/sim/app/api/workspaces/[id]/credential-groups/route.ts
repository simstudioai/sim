import { getWorkspaceAccountsContract } from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getWorkspaceAccountsSettings } from '@/lib/credential-groups/application/manage-groups'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const GET = defineInternalJsonRoute({
  contract: getWorkspaceAccountsContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.workspaceSettings,
  rateLimit: internalRateLimits.none({
    reason: 'Workspace account settings do not require additional admission limits',
  }),
  errorPolicy: createCredentialGroupInternalErrorPolicy(
    'Failed to load connected accounts',
    'Workspace not found'
  ),
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: getWorkspaceAccountsSettings,
})
