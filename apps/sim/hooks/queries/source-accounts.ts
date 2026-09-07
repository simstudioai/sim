'use client'

import type { ResourceScope } from '@/lib/core/resource-scope'
import { useWorkspaceAccounts } from '@/hooks/queries/credential-groups'
import { useOrganizationAccounts } from '@/hooks/queries/organization-accounts'

/** Both account containers keep their canonical query keys and authorization boundary. */
export function useSourceAccounts(scope?: ResourceScope) {
  const workspace = useWorkspaceAccounts(
    scope?.kind === 'workspace' ? scope.workspaceId : undefined
  )
  const organization = useOrganizationAccounts(
    scope?.kind === 'organization' ? scope.organizationId : undefined
  )
  return scope?.kind === 'organization' ? organization : workspace
}
