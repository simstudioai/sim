import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { resolveWorkspaceGroup } from '@/lib/permission-groups/resolve.server'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { isOrganizationAdminOrOwner } from '@/lib/workspaces/permissions/utils'

/**
 * permission-group-exempt: Members must be able to read their own restrictions.
 */
export const readUserPermissionConfigOperation = defineWorkspaceOperation({
  id: 'permission_groups.read_user_config',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  principalKinds: ['session'],
  capability: 'none',
})

export const readUserPermissionConfig = defineAuthorizedWorkspaceUseCase({
  operation: readUserPermissionConfigOperation,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, context }) => {
    const organizationId = context.workspaceOrganizationId
    const [isOrgAdmin, entitled] = organizationId
      ? await Promise.all([
          isOrganizationAdminOrOwner(principal.userId, organizationId),
          isOrganizationOnEnterprisePlan(organizationId, 'throw'),
        ])
      : [false, false]
    const resolved =
      organizationId && entitled
        ? await resolveWorkspaceGroup(principal.userId, organizationId, context.workspaceId)
        : null

    return {
      permissionGroupId: resolved?.permissionGroupId ?? null,
      groupName: resolved?.groupName ?? null,
      config: resolved?.config ?? null,
      entitled,
      organizationId,
      isOrgAdmin,
    }
  },
})
