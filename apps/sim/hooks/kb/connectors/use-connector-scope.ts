'use client'

import { useParams } from 'next/navigation'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { hasWorkspaceMaxConnectorAccess } from '@/lib/knowledge/connectors/entitlements'
import { useOptionalOrganization } from '@/lib/organizations/provider'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-context'
import { useOptionalWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

/** Shared connector UI reads the permissions of its actual resource owner. */
export function useConnectorScope(explicitScope?: ResourceScope) {
  const params = useParams<{ workspaceId?: string; organizationId?: string }>()
  const scope = explicitScope ?? resourceScopeFromOwner(params)
  const organization = useOptionalOrganization()
  const workspace = useOptionalWorkspaceHostContext()
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
