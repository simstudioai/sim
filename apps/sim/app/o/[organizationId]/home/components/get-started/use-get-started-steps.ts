import { hasSearchIntegrationReady } from '@/lib/credential-groups/search-readiness'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useHasSearchAuthorization } from '@/hooks/queries/oauth-provider'
import { useOrganizationAccounts } from '@/hooks/queries/organization-accounts'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'

export type GetStartedStepId = 'connect-integration' | 'connect-sim-search'

/**
 * The onboarding steps this viewer has, in the order a new organization works through them, each
 * done or not from the organization's real state: a configured integration and an OAuth app
 * authorized to use Search. A surface that does not show them passes `enabled: false` to read nothing.
 */
export function useGetStartedSteps(enabled = true) {
  const { organization, viewer, connectedAccountsAvailable } = useOrganizationContext()
  const routes = organizationRoutes(organization.id)
  const canConnectIntegrations =
    enabled && viewer.canConnectSearchIntegrations && connectedAccountsAvailable
  const canUseSearchMcp = enabled && viewer.canUseSearchMcp
  const { data: accounts } = useOrganizationAccounts(
    canConnectIntegrations ? organization.id : undefined
  )
  const { data: integrations } = useSearchIntegrations(organization.id, {
    enabled: canConnectIntegrations,
  })
  const hasSearchAuthorization = useHasSearchAuthorization(canUseSearchMcp)
  return [
    ...(canConnectIntegrations
      ? [
          {
            id: 'connect-integration' as const,
            label: 'Connect an integration',
            href: viewer.isAdmin ? routes.settingsSection('integrations') : routes.integrations,
            complete: hasSearchIntegrationReady(accounts, integrations),
          },
        ]
      : []),
    ...(canUseSearchMcp
      ? [
          {
            id: 'connect-sim-search' as const,
            label: 'Connect Sim Search MCP',
            href: routes.settingsSection('search-mcp'),
            complete: hasSearchAuthorization,
          },
        ]
      : []),
  ]
}
