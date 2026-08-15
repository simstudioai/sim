import {
  leaveCredentialMembershipContract,
  listCredentialMembershipsContract,
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
  leaveCredentialMembershipUseCase,
  listCredentialMembershipsUseCase,
} from '@/lib/credentials/application/credential-members'
import { credentialUserOperations } from '@/lib/credentials/application/operations'

const rateLimit = internalRateLimits.none({ reason: 'Preserve existing internal behavior' })

export const GET = defineInternalJsonRoute({
  contract: listCredentialMembershipsContract,
  auth: internalSessionAuth,
  operation: credentialUserOperations.listMemberships,
  rateLimit,
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: () => ({}),
  useCase: listCredentialMembershipsUseCase,
  present: ({ memberships }) => ({
    memberships: memberships.map((membership) => ({
      ...membership,
      joinedAt: membership.joinedAt?.toISOString() ?? null,
    })),
  }),
})

export const DELETE = defineInternalJsonRoute({
  contract: leaveCredentialMembershipContract,
  auth: internalSessionAuth,
  operation: credentialUserOperations.leaveMembership,
  rateLimit,
  errorPolicy: internalCredentialErrorPolicy,
  parseOptions: credentialValidationParseOptions,
  mapInput: ({ query }) => query,
  useCase: leaveCredentialMembershipUseCase,
})
