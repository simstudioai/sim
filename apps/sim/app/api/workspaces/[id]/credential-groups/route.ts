import {
  createCredentialGroupContract,
  listCredentialGroupsContract,
} from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  createCredentialGroupSettings,
  listCredentialGroupSettings,
} from '@/lib/credential-groups/application/manage-groups'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const GET = defineInternalJsonRoute({
  contract: listCredentialGroupsContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.listSettings,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal Credential Group list behavior',
  }),
  errorPolicy: createCredentialGroupInternalErrorPolicy(
    'Failed to list credential groups',
    'Workspace not found'
  ),
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: listCredentialGroupSettings,
})

export const POST = defineInternalJsonRoute({
  contract: createCredentialGroupContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.create,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal Credential Group create behavior',
  }),
  errorPolicy: createCredentialGroupInternalErrorPolicy(
    'Failed to create credential group',
    'Workspace not found'
  ),
  mapInput: ({ params, body }) => ({ workspaceId: params.id, credentialGroup: body }),
  useCase: createCredentialGroupSettings,
})
