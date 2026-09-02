import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { getActivePermissionGroupRestrictions } from '@/lib/permission-groups/features'
import { platformContextDelegationPolicy } from '@/lib/platform-context/application/authorization'
import { resolvePlatformContextWorkspace } from '@/lib/platform-context/application/context'
import { platformContextOperations } from '@/lib/platform-context/application/operations'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { resolveVerifiedUserAccessControlContext } from '@/ee/access-control/utils/permission-check'

const ENTERPRISE_PERMISSION_DOCUMENTATION = [
  {
    title: 'Roles and permissions',
    path: 'docs/platform/permissions.mdx',
    url: 'https://docs.sim.ai/platform/permissions',
  },
  {
    title: 'Enterprise Access Control',
    path: 'docs/platform/enterprise/access-control.mdx',
    url: 'https://docs.sim.ai/platform/enterprise/access-control',
  },
] as const

export interface ReadEnterpriseContextInput {
  workspaceId: string
}

export const readEnterpriseContext = defineAuthorizedWorkspaceUseCase({
  operation: platformContextOperations.readEnterpriseContext,
  resolveContext: ({ input }: { input: ReadEnterpriseContextInput }) =>
    resolvePlatformContextWorkspace(input.workspaceId),
  authorizationOptions: { delegation: platformContextDelegationPolicy },
  async execute({ principal, context }) {
    const userId = requirePrincipalSubjectUserId(principal)
    const hostContext = await getWorkspaceHostContextForViewer(context.workspaceId, userId)
    if (!hostContext) {
      throw new OrchestrationError('not_found', 'Workspace not found or you do not have access.')
    }

    const accessControl = await resolveVerifiedUserAccessControlContext(
      userId,
      context.workspaceId,
      hostContext.hostOrganizationId
    )
    const canWrite = permissionSatisfies(hostContext.viewer.permission, 'write')
    const canAdmin = permissionSatisfies(hostContext.viewer.permission, 'admin')
    const allDeploymentSurfacesHidden =
      capabilityDeniedBy('deploy.api', accessControl.config) &&
      capabilityDeniedBy('deploy.mcp', accessControl.config) &&
      capabilityDeniedBy('deploy.chat', accessControl.config)

    return {
      workspace: {
        id: hostContext.workspace.id,
        name: hostContext.workspace.name,
        mode: hostContext.workspace.workspaceMode,
        permission: hostContext.viewer.permission,
        capabilities: {
          canRead: true,
          canEdit: canWrite,
          canRun: true,
          canDeploy: canAdmin && !allDeploymentSurfacesHidden,
          canManageWorkspace: canAdmin,
        },
      },
      organization: hostContext.hostOrganizationId
        ? {
            id: hostContext.hostOrganizationId,
            relationship: hostContext.viewer.isHostOrganizationMember ? 'internal' : 'external',
            role: hostContext.viewer.organizationRole ?? null,
            canManageOrganization: hostContext.viewer.isHostOrganizationAdmin,
            canManageBilling: hostContext.viewer.isHostOrganizationAdmin,
            plan: hostContext.ownerBilling.plan,
            isEnterprise: hostContext.ownerBilling.isEnterprise,
          }
        : null,
      accessControl: {
        entitled: accessControl.entitled,
        governingPermissionGroup: accessControl.permissionGroup,
        effectiveConfig: accessControl.config,
        activeRestrictions: getActivePermissionGroupRestrictions(accessControl.config),
      },
      documentation: ENTERPRISE_PERMISSION_DOCUMENTATION,
      resolvedAt: new Date().toISOString(),
    }
  },
})
