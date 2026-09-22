import {
  addPermissionGroupMemberContract,
  listPermissionGroupMembersContract,
  removePermissionGroupMemberContract,
} from '@/lib/api/contracts/permission-groups'
import { presentPermissionGroupMember } from '@/lib/api/server/permission-group-presenters'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalPermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import {
  addPermissionGroupMember,
  listPermissionGroupMembers,
  removePermissionGroupMember,
} from '@/lib/permission-groups/application/use-cases'

export const GET = defineInternalJsonRoute({
  contract: listPermissionGroupMembersContract,
  auth: internalSessionAuth,
  operation: permissionGroupOperations.listMembers,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing permission group settings behavior',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, groupId: params.groupId }),
  useCase: listPermissionGroupMembers,
  present: ({ data }) => ({ members: data.map(presentPermissionGroupMember) }),
})

export const POST = defineInternalJsonRoute({
  contract: addPermissionGroupMemberContract,
  auth: internalSessionAuth,
  operation: permissionGroupOperations.addMember,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing permission group settings behavior',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    groupId: params.groupId,
    userId: body.userId,
  }),
  useCase: addPermissionGroupMember,
  present: ({ member }) => ({ member: presentPermissionGroupMember(member) }),
})

export const DELETE = defineInternalJsonRoute({
  contract: removePermissionGroupMemberContract,
  auth: internalSessionAuth,
  operation: permissionGroupOperations.removeMember,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing permission group settings behavior',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    groupId: params.groupId,
    memberId: query.memberId,
  }),
  useCase: removePermissionGroupMember,
  present: () => ({ success: true as const }),
})
