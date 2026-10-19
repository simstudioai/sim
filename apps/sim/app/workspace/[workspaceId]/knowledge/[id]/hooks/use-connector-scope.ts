'use client'

import { useParams } from 'next/navigation'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { useOptionalOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { hasWorkspaceMaxConnectorAccess } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-entitlements'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useOptionalWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

/**
 * A hosted workspace owns the connector even under an organization route, as in the org project
 * pane; only a surface with no workspace host falls back to the route's owner.
 */
export function connectorOwnerScope(
  hostWorkspaceId: string | undefined,
  params: { workspaceId?: string; organizationId?: string }
): ResourceScope {
  return hostWorkspaceId
    ? { kind: 'workspace', workspaceId: hostWorkspaceId }
    : resourceScopeFromOwner(params)
}

/** Shared connector UI reads the permissions of its actual resource owner. */
export function useConnectorScope(explicitScope?: ResourceScope) {
  const params = useParams<{ workspaceId?: string; organizationId?: string }>()
  const organization = useOptionalOrganizationContext()
  const workspace = useOptionalWorkspaceHostContext()
  const scope = explicitScope ?? connectorOwnerScope(workspace?.workspace.id, params)
  const permissions = useOptionalWorkspacePermissionsContext()

  if (scope.kind === 'organization') {
    const context = organization?.organization.id === scope.organizationId ? organization : null
    return {
      scope,
      canAdmin: context?.viewer.isAdmin === true,
      memberAccessAvailable: context?.searchAccess.memberScoped === true,
      mirroredAccessAvailable: context?.searchAccess.sourceMirrored === true,
      hasMaxAccess: false,
    }
  }

  const context = workspace?.workspace.id === scope.workspaceId ? workspace : null
  return {
    scope,
    canAdmin: context !== null && permissions?.userPermissions.canAdmin === true,
    memberAccessAvailable: context?.features?.knowledgeMemberAccess === true,
    mirroredAccessAvailable: context?.features?.knowledgeSourceMirroredAccess === true,
    hasMaxAccess: context ? hasWorkspaceMaxConnectorAccess(context.ownerBilling) : false,
  }
}
