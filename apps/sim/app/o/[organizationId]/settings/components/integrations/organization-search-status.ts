import type { OrganizationSearchProviderSummary } from '@/lib/api/contracts/knowledge/connectors'

const STATUS_LABELS: Record<OrganizationSearchProviderSummary['status'], string> = {
  needs_setup: 'Needs setup',
  waiting_for_connections: 'Waiting for account connections',
  indexing: 'Indexing',
  needs_attention: 'Needs attention',
  paused: 'Paused',
  active: 'Syncing enabled',
}

export function organizationSearchStatusLabel(provider: OrganizationSearchProviderSummary): string {
  if (!provider.approved) return 'Deactivated'
  return STATUS_LABELS[provider.status]
}
