import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { permissionGroupWorkspaceOperations } from '@/lib/permission-groups/application/operations'
import {
  isOrganizationPermissionRegimeActive,
  resolveWorkspaceGroup,
} from '@/lib/permission-groups/resolve.server'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { isOrganizationAdminOrOwner } from '@/lib/workspaces/permissions/utils'

export const readUserPermissionConfig = defineAuthorizedWorkspaceUseCase({
  operation: permissionGroupWorkspaceOperations.readUserConfig,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: { delegation: { audience: 'sim:settings', isWithinScope: () => true } },
  execute: async ({ principal, context }) => {
    const userId = requirePrincipalSubjectUserId(principal)
    const organizationId = context.workspaceOrganizationId
    const [isOrgAdmin, entitled] = organizationId
      ? await Promise.all([
          isOrganizationAdminOrOwner(userId, organizationId),
          isOrganizationPermissionRegimeActive(organizationId),
        ])
      : [false, false]
    const resolved =
      organizationId && entitled
        ? await resolveWorkspaceGroup(userId, organizationId, context.workspaceId)
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
