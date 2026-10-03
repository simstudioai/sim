import { v2GetWorkspacePermissionConfigContract } from '@/lib/api/contracts/v2/workspace-permissions'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { permissionGroupWorkspaceOperations } from '@/lib/permission-groups/application/operations'
import { readUserPermissionConfig } from '@/lib/permission-groups/application/read-user-config'
import { v2WorkspaceErrorPolicies } from '@/lib/workspaces/api/route-policies'

export const GET = defineV2JsonRoute({
  contract: v2GetWorkspacePermissionConfigContract,
  operation: permissionGroupWorkspaceOperations.readUserConfig,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkspaceErrorPolicies.concealWorkspaceAuthorization,
  mapInput: ({ params }) => params,
  useCase: readUserPermissionConfig,
  present: (result) => ({ data: result }),
})
