import {
  getCredentialGroupContract,
  updateCredentialGroupContract,
} from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  getCredentialGroupSettings,
  updateCredentialGroupSettings,
} from '@/lib/credential-groups/application/manage-groups'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

const rateLimit = internalRateLimits.none({
  reason: 'Preserve existing internal Credential Group detail behavior',
})

export const GET = defineInternalJsonRoute({
  contract: getCredentialGroupContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.readSettings,
  rateLimit,
  errorPolicy: createCredentialGroupInternalErrorPolicy('Failed to get credential group'),
  mapInput: ({ params, query }) => ({
    assertedWorkspaceId: params.id,
    credentialGroupId: params.groupId,
    limit: query.limit,
    cursor: query.cursor,
  }),
  useCase: getCredentialGroupSettings,
})

export const PATCH = defineInternalJsonRoute({
  contract: updateCredentialGroupContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.update,
  rateLimit,
  errorPolicy: createCredentialGroupInternalErrorPolicy('Failed to update credential group'),
  mapInput: ({ params, body }) => ({
    assertedWorkspaceId: params.id,
    credentialGroupId: params.groupId,
    update: body,
  }),
  useCase: updateCredentialGroupSettings,
  present: ({ credentialGroup }) => ({ credentialGroup }),
})
