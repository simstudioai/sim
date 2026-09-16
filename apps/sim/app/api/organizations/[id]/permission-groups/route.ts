import { NextResponse } from 'next/server'
import {
  createPermissionGroupContract,
  listPermissionGroupsContract,
  permissionGroupParamsSchema,
} from '@/lib/api/contracts/permission-groups'
import { getValidationErrorMessage } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { authorizePermissionGroupManagement } from '@/lib/permission-groups/application/authorized-management-use-case'
import {
  createPermissionGroup,
  listPermissionGroups,
} from '@/lib/permission-groups/application/management'
import { permissionGroupManagementOperations } from '@/lib/permission-groups/application/management-operations'
import { permissionGroupErrorPolicy } from '@/app/api/organizations/[id]/permission-groups/utils'

export const GET = defineInternalJsonRoute({
  contract: listPermissionGroupsContract,
  auth: internalSessionAuth,
  operation: permissionGroupManagementOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Existing admin-only enterprise access-control management',
  }),
  errorPolicy: permissionGroupErrorPolicy('Internal server error'),
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: listPermissionGroups,
})

export const POST = defineInternalJsonRoute({
  contract: createPermissionGroupContract,
  auth: internalSessionAuth,
  operation: permissionGroupManagementOperations.create,
  rateLimit: internalRateLimits.none({
    reason: 'Existing admin-only enterprise access-control management',
  }),
  errorPolicy: permissionGroupErrorPolicy('Failed to create permission group'),
  beforeParse: async ({ principal, params }) => {
    const scope = permissionGroupParamsSchema.parse(params)
    await authorizePermissionGroupManagement(
      principal,
      permissionGroupManagementOperations.create,
      { organizationId: scope.id }
    )
  },
  parseOptions: {
    validationErrorResponse: (error) =>
      NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
  },
  mapInput: ({ params, body }) => ({ organizationId: params.id, settings: body }),
  useCase: createPermissionGroup,
})
