import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { toError } from '@sim/utils/errors'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { getActivePermissionGroupRestrictions } from '@/lib/permission-groups/features'
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

/**
 * Resolves the authenticated user's effective Enterprise access in the current
 * workspace. This is an explanatory snapshot; every later mutation must still
 * perform its normal server-side authorization at execution time.
 */
export async function executeGetEnterpriseContext(
  context: ExecutionContext
): Promise<ToolCallResult> {
  if (!context.workspaceId) {
    return {
      success: false,
      error: 'A current workspace is required to resolve enterprise access.',
    }
  }

  try {
    const hostContext = await getWorkspaceHostContextForViewer(context.workspaceId, context.userId)
    if (!hostContext) {
      return {
        success: false,
        error: 'Workspace not found or you do not have access.',
      }
    }

    const accessControl = await resolveVerifiedUserAccessControlContext(
      context.userId,
      context.workspaceId,
      hostContext.hostOrganizationId
    )

    const canWrite = permissionSatisfies(hostContext.viewer.permission, 'write')
    const canAdmin = permissionSatisfies(hostContext.viewer.permission, 'admin')

    return {
      success: true,
      output: {
        workspace: {
          id: hostContext.workspace.id,
          name: hostContext.workspace.name,
          mode: hostContext.workspace.workspaceMode,
          permission: hostContext.viewer.permission,
          capabilities: {
            canRead: true,
            canEdit: canWrite,
            canRun: canWrite,
            canDeploy: canAdmin,
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
      },
    }
  } catch (error) {
    return { success: false, error: toError(error).message }
  }
}
