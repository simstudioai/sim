import {
  type SearchSetupReturnSource,
  searchSetupParam,
  searchSetupReturnParam,
} from '@/app/workspace/[workspaceId]/search/search-params'
import { credentialGroupProviderSearchParam } from '@/app/workspace/[workspaceId]/settings/[section]/search-params'

/** Carries Search setup through an existing integration or settings screen. */
export function searchSetupDestination(path: string, source: SearchSetupReturnSource): string {
  const params = new URLSearchParams({ [searchSetupReturnParam.key]: source })
  return `${path}?${params}`
}

export function searchSetupReturnHref(
  workspaceId: string,
  source: SearchSetupReturnSource
): string {
  const path = `/workspace/${workspaceId}/search`
  return source === 'search'
    ? path
    : `${path}?${new URLSearchParams({ [searchSetupParam.key]: source })}`
}

/** Opens the Slack account configuration within the existing settings surface. */
export function slackSearchSetupHref(workspaceId: string, source: 'slack' | 'search'): string {
  return `${searchSetupDestination(`/workspace/${workspaceId}/settings/credential-groups`, source)}&${new URLSearchParams({ [credentialGroupProviderSearchParam.key]: 'slack' })}`
}
