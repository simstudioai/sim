import { v2RemoveCredentialMemberContract } from '@/lib/api/contracts/v2/credentials'
import {
  createV2ResourceConcealmentPolicy,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { removeCredentialMemberUseCase } from '@/lib/credentials/application/credential-members'
import { credentialOperations } from '@/lib/credentials/application/operations'

export const DELETE = defineV2JsonRoute({
  contract: v2RemoveCredentialMemberContract,
  operation: credentialOperations.removeMember,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: createV2ResourceConcealmentPolicy({ notFoundMessage: 'Credential not found' }),
  mapInput: ({ params, query }) => ({ ...params, assertedWorkspaceId: query.workspaceId }),
  useCase: removeCredentialMemberUseCase,
  present: ({ targetUserId }) => ({ data: { userId: targetUserId, revoked: true as const } }),
})
