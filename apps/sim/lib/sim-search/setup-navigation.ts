import type { ResourceScope } from '@/lib/core/resource-scope'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  type SearchSetupReturnSource,
  searchSetupParam,
  searchSetupReturnParam,
} from '@/app/workspace/[workspaceId]/search/search-params'
import { credentialGroupProviderSearchParam } from '@/app/workspace/[workspaceId]/settings/[section]/search-params'

/** Where an organization admin sets up Sim Search sources: the Integrations section of its settings. */
export function organizationSearchSetupPath(organizationId: string): string {
  return organizationRoutes(organizationId).settingsSection('integrations')
}

/** Carries Search setup through an existing integration or settings screen. */
export function searchSetupDestination(path: string, source: SearchSetupReturnSource): string {
  const params = new URLSearchParams({ [searchSetupReturnParam.key]: source })
  return `${path}?${params}`
}

export function searchSetupReturnHref(
  owner: string | ResourceScope,
  source: SearchSetupReturnSource
): string {
  const scope =
    typeof owner === 'string' ? { kind: 'workspace' as const, workspaceId: owner } : owner
  const path =
    scope.kind === 'organization'
      ? organizationSearchSetupPath(scope.organizationId)
      : `/workspace/${scope.workspaceId}/search`
  return source === 'search'
    ? path
    : `${path}?${new URLSearchParams({ [searchSetupParam.key]: source })}`
}

/** Opens the Slack account configuration within the existing settings surface. */
export function slackSearchSetupHref(
  owner: string | ResourceScope,
  source: 'slack' | 'search'
): string {
  const scope =
    typeof owner === 'string' ? { kind: 'workspace' as const, workspaceId: owner } : owner
  const path =
    scope.kind === 'organization'
      ? organizationSearchSetupPath(scope.organizationId)
      : `/workspace/${scope.workspaceId}/settings/credential-groups`
  const providerKey =
    scope.kind === 'organization' ? 'connectedAccounts' : credentialGroupProviderSearchParam.key
  return `${searchSetupDestination(path, source)}&${new URLSearchParams({ [providerKey]: 'slack' })}`
}
