import { listOrganizationWorkspacesContract } from '@/lib/api/contracts/permission-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listPermissionGroupWorkspaces } from '@/lib/permission-groups/application/management'
import { permissionGroupManagementOperations } from '@/lib/permission-groups/application/management-operations'
import { permissionGroupErrorPolicy } from '@/app/api/organizations/[id]/permission-groups/utils'

export const GET = defineInternalJsonRoute({
  contract: listOrganizationWorkspacesContract,
  auth: internalSessionAuth,
  operation: permissionGroupManagementOperations.listWorkspaces,
  rateLimit: internalRateLimits.none({
    reason: 'Existing admin-only enterprise access-control management',
  }),
  errorPolicy: permissionGroupErrorPolicy('Internal server error'),
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: listPermissionGroupWorkspaces,
})
