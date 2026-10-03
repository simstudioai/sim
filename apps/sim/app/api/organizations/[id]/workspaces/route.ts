import { listOrganizationWorkspacesContract } from '@/lib/api/contracts/permission-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalPermissionGroupErrorPolicy } from '@/lib/api/server/routes/permission-groups'
import { permissionGroupOperations } from '@/lib/permission-groups/application/operations'
import { listPermissionGroupWorkspaces } from '@/lib/permission-groups/application/use-cases'

export const GET = defineInternalJsonRoute({
  contract: listOrganizationWorkspacesContract,
  auth: internalSessionAuth,
  operation: permissionGroupOperations.listWorkspaces,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing permission group settings behavior',
  }),
  errorPolicy: internalPermissionGroupErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: listPermissionGroupWorkspaces,
  present: ({ data }) => ({ workspaces: data }),
})
