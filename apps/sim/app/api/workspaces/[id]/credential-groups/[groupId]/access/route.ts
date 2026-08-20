import {
  getCredentialGroupAccessContract,
  updateCredentialGroupAccessContract,
} from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  readCredentialGroupAccess,
  updateCredentialGroupAccess,
} from '@/lib/credential-groups/application/manage-access'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

const rateLimit = internalRateLimits.none({
  reason: 'Credential Group access changes are workspace-admin control-plane operations',
})

export const GET = defineInternalJsonRoute({
  contract: getCredentialGroupAccessContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.readAccess,
  rateLimit,
  errorPolicy: createCredentialGroupInternalErrorPolicy('Failed to read Credential Group access'),
  mapInput: ({ params }) => ({
    assertedWorkspaceId: params.id,
    credentialGroupId: params.groupId,
  }),
  useCase: readCredentialGroupAccess,
})

export const PUT = defineInternalJsonRoute({
  contract: updateCredentialGroupAccessContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.updateAccess,
  rateLimit,
  errorPolicy: createCredentialGroupInternalErrorPolicy('Failed to update Credential Group access'),
  mapInput: ({ params, body }) => ({
    assertedWorkspaceId: params.id,
    credentialGroupId: params.groupId,
    expectedRevision: body.expectedRevision,
    grants: body.grants,
  }),
  useCase: updateCredentialGroupAccess,
})
