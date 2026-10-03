import { cache } from 'react'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import { resolveDeploymentShape } from '@/lib/core/config/deployment-shape'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import {
  isKnowledgeMemberAccessAvailable,
  resolveKnowledgeAccessAvailability,
} from '@/lib/knowledge/access/availability'
import { getOrganizationSettingsAccess } from '@/lib/organizations/settings-access'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

/**
 * Resolves all workspace-bound identity and entitlement context from the routed
 * workspace after verifying the viewer's effective workspace permission.
 *
 * Session active-organization state is intentionally absent: it describes the
 * viewer's account, not the workspace host.
 */
async function resolveWorkspaceHostContextForViewer(
  workspaceId: string,
  userId: string
): Promise<WorkspaceHostContext | null> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess || !access.workspace || !access.permission) {
    return null
  }

  const hostOrganizationId = access.workspace.organizationId
  const [ownerBilling, hostOrganizationAccess] = await Promise.all([
    getWorkspaceOwnerSubscriptionAccess(workspaceId),
    hostOrganizationId
      ? getOrganizationSettingsAccess(hostOrganizationId, userId)
      : Promise.resolve({ role: null, isMember: false, isAdmin: false }),
  ])
  const [credentialGroupsAvailable, knowledgeAccess, organizationSearch] = await Promise.all([
    hostOrganizationId
      ? isScopedCredentialGroupsAvailable({
          kind: 'organization',
          organizationId: hostOrganizationId,
        })
      : Promise.resolve(false),
    resolveKnowledgeAccessAvailability({ workspaceId, ownerBilling }),
    hostOrganizationId && hostOrganizationAccess.isMember
      ? isKnowledgeMemberAccessAvailable({ organizationId: hostOrganizationId })
      : Promise.resolve(false),
  ])

  return {
    workspace: {
      id: access.workspace.id,
      name: access.workspace.name,
      workspaceMode: access.workspace.workspaceMode,
      billedAccountUserId: access.workspace.billedAccountUserId,
      allowPersonalApiKeys: access.workspace.allowPersonalApiKeys,
    },
    hostOrganizationId,
    ownerBilling,
    viewer: {
      permission: access.permission,
      isHostOrganizationMember: hostOrganizationAccess.isMember,
      isHostOrganizationAdmin: hostOrganizationAccess.isAdmin,
      organizationRole: hostOrganizationAccess.role,
    },
    features: {
      credentialGroups: credentialGroupsAvailable,
      organizationSearch,
      knowledgeMemberAccess: knowledgeAccess.memberScoped,
      knowledgeSourceMirroredAccess: knowledgeAccess.sourceMirrored,
    },
    deployment: resolveDeploymentShape(),
  }
}

/**
 * Request-memoized workspace host resolution shared by nested Server
 * Components. Outside a Server Component render, React evaluates the resolver
 * normally without retaining a cross-request cache.
 */
export const getWorkspaceHostContextForViewer = cache(resolveWorkspaceHostContextForViewer)
