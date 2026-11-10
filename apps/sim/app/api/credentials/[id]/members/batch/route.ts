import { addWorkspaceCredentialMembersContract } from '@/lib/api/contracts/credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  credentialValidationParseOptions,
  internalCredentialMemberMutationErrorPolicy,
} from '@/lib/credentials/api/route-policies'
import { addCredentialMembersUseCase } from '@/lib/credentials/application/members'
import { credentialOperations } from '@/lib/credentials/application/operations'

export const POST = defineInternalJsonRoute({
  contract: addWorkspaceCredentialMembersContract,
  auth: internalSessionAuth,
  operation: credentialOperations.addMembers,
  rateLimit: internalRateLimits.none({ reason: 'Matches the single-member grant it batches' }),
  errorPolicy: internalCredentialMemberMutationErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ params, body }) => ({
    credentialId: params.id,
    userIds: body.userIds,
    role: body.role,
  }),
  useCase: addCredentialMembersUseCase,
  present: ({ added, roleChanged, unchanged, refused }) => ({
    added,
    updated: roleChanged.map((change) => change.userId),
    unchanged,
    refused,
  }),
})
