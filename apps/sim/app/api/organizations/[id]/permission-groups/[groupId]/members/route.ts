import { NextResponse } from 'next/server'
import {
  addPermissionGroupMemberContract,
  listPermissionGroupMembersContract,
  permissionGroupDetailParamsSchema,
  removePermissionGroupMemberContract,
} from '@/lib/api/contracts/permission-groups'
import { getValidationErrorMessage } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { authorizePermissionGroupManagement } from '@/lib/permission-groups/application/authorized-management-use-case'
import {
  addPermissionGroupMember,
  listPermissionGroupMembers,
  removePermissionGroupMember,
} from '@/lib/permission-groups/application/management-members'
import { permissionGroupManagementOperations } from '@/lib/permission-groups/application/management-operations'
import { permissionGroupErrorPolicy } from '@/app/api/organizations/[id]/permission-groups/utils'

export const GET = defineInternalJsonRoute({
  contract: listPermissionGroupMembersContract,
  auth: internalSessionAuth,
  operation: permissionGroupManagementOperations.listMembers,
  rateLimit: internalRateLimits.none({
    reason: 'Existing admin-only enterprise access-control management',
  }),
  errorPolicy: permissionGroupErrorPolicy('Internal server error'),
  mapInput: ({ params }) => ({ organizationId: params.id, groupId: params.groupId }),
  useCase: listPermissionGroupMembers,
})

export const POST = defineInternalJsonRoute({
  contract: addPermissionGroupMemberContract,
  auth: internalSessionAuth,
  operation: permissionGroupManagementOperations.addMember,
  rateLimit: internalRateLimits.none({
    reason: 'Existing admin-only enterprise access-control management',
  }),
  errorPolicy: permissionGroupErrorPolicy('Failed to add member'),
  beforeParse: async ({ principal, params }) => {
    const scope = permissionGroupDetailParamsSchema.parse(params)
    await authorizePermissionGroupManagement(
      principal,
      permissionGroupManagementOperations.addMember,
      { organizationId: scope.id, groupId: scope.groupId }
    )
  },
  parseOptions: {
    validationErrorResponse: (error) =>
      NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
  },
  mapInput: ({ params, body }) => ({ organizationId: params.id, groupId: params.groupId, ...body }),
  useCase: addPermissionGroupMember,
  present: ({ member }) => ({ member }),
})

export const DELETE = defineInternalJsonRoute({
  contract: removePermissionGroupMemberContract,
  auth: internalSessionAuth,
  operation: permissionGroupManagementOperations.removeMember,
  rateLimit: internalRateLimits.none({
    reason: 'Existing admin-only enterprise access-control management',
  }),
  errorPolicy: permissionGroupErrorPolicy('Failed to remove member'),
  parseOptions: {
    validationErrorResponse: () =>
      NextResponse.json({ error: 'memberId is required' }, { status: 400 }),
  },
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    groupId: params.groupId,
    memberId: query.memberId,
  }),
  useCase: removePermissionGroupMember,
  present: ({ success }) => ({ success }),
})
