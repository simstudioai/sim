import { organizationRoutes } from '@/lib/navigation/paths'

/** Where an organization admin sets up Sim Search sources. */
export function organizationSearchSetupPath(organizationId: string): string {
  return organizationRoutes(organizationId).settingsSection('integrations')
}
