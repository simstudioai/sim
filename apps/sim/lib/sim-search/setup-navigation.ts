import { organizationRoutes } from '@/lib/navigation/paths'
import { searchSetupReturnParam } from '@/lib/sim-search/search-params'

/** Where an organization admin sets up Sim Search sources. */
export function organizationSearchSetupPath(organizationId: string): string {
  return organizationRoutes(organizationId).settingsSection('integrations')
}

/** Opens Slack account configuration and preserves the organization setup form. */
export function slackSearchSetupHref(organizationId: string, source: 'slack' | 'search'): string {
  const params = new URLSearchParams({
    [searchSetupReturnParam.key]: source,
    connectedAccounts: 'slack',
  })
  return `${organizationSearchSetupPath(organizationId)}?${params}`
}
