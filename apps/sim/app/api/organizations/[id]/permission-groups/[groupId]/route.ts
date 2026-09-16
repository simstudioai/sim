import { NextResponse } from 'next/server'
import {
  deletePermissionGroupContract,
  getPermissionGroupContract,
  permissionGroupDetailParamsSchema,
  updatePermissionGroupContract,
} from '@/lib/api/contracts/permission-groups'
import { getValidationErrorMessage } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { authorizePermissionGroupManagement } from '@/lib/permission-groups/application/authorized-management-use-case'
import {
  deletePermissionGroup,
  getPermissionGroup,
  updatePermissionGroup,
} from '@/lib/permission-groups/application/management'
import { permissionGroupManagementOperations } from '@/lib/permission-groups/application/management-operations'
import { permissionGroupErrorPolicy } from '@/app/api/organizations/[id]/permission-groups/utils'

export const GET = defineInternalJsonRoute({
  contract: getPermissionGroupContract,
  auth: internalSessionAuth,
  operation: permissionGroupManagementOperations.get,
  rateLimit: internalRateLimits.none({
    reason: 'Existing admin-only enterprise access-control management',
  }),
  errorPolicy: permissionGroupErrorPolicy('Internal server error'),
  mapInput: ({ params }) => ({ organizationId: params.id, groupId: params.groupId }),
  useCase: getPermissionGroup,
})

export const PUT = defineInternalJsonRoute({
  contract: updatePermissionGroupContract,
  auth: internalSessionAuth,
  operation: permissionGroupManagementOperations.update,
  rateLimit: internalRateLimits.none({
    reason: 'Existing admin-only enterprise access-control management',
  }),
  errorPolicy: permissionGroupErrorPolicy('Failed to update permission group'),
  beforeParse: async ({ principal, params }) => {
    const scope = permissionGroupDetailParamsSchema.parse(params)
    await authorizePermissionGroupManagement(
      principal,
      permissionGroupManagementOperations.update,
      { organizationId: scope.id, groupId: scope.groupId }
    )
  },
  parseOptions: {
    validationErrorResponse: (error) =>
      NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
  },
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    groupId: params.groupId,
    settings: body,
  }),
  useCase: updatePermissionGroup,
})

export const DELETE = defineInternalJsonRoute({
  contract: deletePermissionGroupContract,
  auth: internalSessionAuth,
  operation: permissionGroupManagementOperations.delete,
  rateLimit: internalRateLimits.none({
    reason: 'Existing admin-only enterprise access-control management',
  }),
  errorPolicy: permissionGroupErrorPolicy('Failed to delete permission group'),
  mapInput: ({ params }) => ({ organizationId: params.id, groupId: params.groupId }),
  useCase: deletePermissionGroup,
  present: ({ success }) => ({ success }),
})
