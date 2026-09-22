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
  authorizationOptions: {},
  execute: async ({ principal, context }) => {
    const organizationId = context.workspaceOrganizationId
    const [isOrgAdmin, entitled] = organizationId
      ? await Promise.all([
          isOrganizationAdminOrOwner(principal.userId, organizationId),
          isOrganizationPermissionRegimeActive(organizationId),
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
