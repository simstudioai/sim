import { NextResponse } from 'next/server'
import {
  bulkAddPermissionGroupMembersContract,
  permissionGroupDetailParamsSchema,
} from '@/lib/api/contracts/permission-groups'
import { getValidationErrorMessage } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { authorizePermissionGroupManagement } from '@/lib/permission-groups/application/authorized-management-use-case'
import { bulkAddPermissionGroupMembers } from '@/lib/permission-groups/application/management-members'
import { permissionGroupManagementOperations } from '@/lib/permission-groups/application/management-operations'
import { permissionGroupErrorPolicy } from '@/app/api/organizations/[id]/permission-groups/utils'

export const POST = defineInternalJsonRoute({
  contract: bulkAddPermissionGroupMembersContract,
  auth: internalSessionAuth,
  operation: permissionGroupManagementOperations.bulkAddMembers,
  rateLimit: internalRateLimits.none({
    reason: 'Existing admin-only enterprise access-control management',
  }),
  errorPolicy: permissionGroupErrorPolicy('Failed to add members'),
  beforeParse: async ({ principal, params }) => {
    const scope = permissionGroupDetailParamsSchema.parse(params)
    await authorizePermissionGroupManagement(
      principal,
      permissionGroupManagementOperations.bulkAddMembers,
      { organizationId: scope.id, groupId: scope.groupId }
    )
  },
  parseOptions: {
    validationErrorResponse: (error) =>
      NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
  },
  mapInput: ({ params, body }) => ({ organizationId: params.id, groupId: params.groupId, ...body }),
  useCase: bulkAddPermissionGroupMembers,
  present: ({ added, skipped }) => ({ added, skipped }),
})
