import {
  listWorkspaceCredentialMembersContract,
  removeWorkspaceCredentialMemberContract,
  upsertWorkspaceCredentialMemberContract,
} from '@/lib/api/contracts/credentials'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  credentialValidationParseOptions,
  internalCredentialErrorPolicy,
} from '@/lib/credentials/api/route-policies'
import {
  listCredentialMembersUseCase,
  removeCredentialMemberUseCase,
  upsertCredentialMemberUseCase,
} from '@/lib/credentials/application/credential-members'
import { credentialOperations } from '@/lib/credentials/application/operations'

const rateLimit = internalRateLimits.none({ reason: 'Preserve existing internal behavior' })

export const GET = defineInternalJsonRoute({
  contract: listWorkspaceCredentialMembersContract,
  auth: internalSessionAuth,
  operation: credentialOperations.listMembers,
  rateLimit,
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ params }) => ({ credentialId: params.id }),
  useCase: listCredentialMembersUseCase,
  present: ({ members }) => ({
    members: members.map((member) => ({
      ...member,
      joinedAt: member.joinedAt?.toISOString() ?? null,
    })),
  }),
})

export const POST = defineInternalJsonRoute({
  contract: upsertWorkspaceCredentialMemberContract,
  auth: internalSessionAuth,
  operation: credentialOperations.upsertMember,
  rateLimit,
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ params, body }) => ({ credentialId: params.id, ...body }),
  useCase: upsertCredentialMemberUseCase,
  present: () => ({ success: true as const }),
  statusForResult: ({ created }) => (created ? 201 : 200),
})

export const DELETE = defineInternalJsonRoute({
  contract: removeWorkspaceCredentialMemberContract,
  auth: internalSessionAuth,
  operation: credentialOperations.removeMember,
  rateLimit,
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ params, query }) => ({ credentialId: params.id, userId: query.userId }),
  useCase: removeCredentialMemberUseCase,
  present: () => ({ success: true as const }),
})
