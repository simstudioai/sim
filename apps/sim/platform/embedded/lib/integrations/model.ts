import { organizationRoutes } from '@/lib/navigation/paths'
import type { IntegrationAccount, OrganizationIntegration } from '@/platform/shared/integrations'

export function integrationPath(organizationId: string, segment: string) {
  return `${organizationRoutes(organizationId).integrations}/${encodeURIComponent(segment)}`
}

export function accountStatus(integration: OrganizationIntegration, account: IntegrationAccount) {
  if (integration.availability === 'blocked') return integration.status
  return account.status === 'needs_reauth' ? 'Reconnect needed' : 'Connected'
}
