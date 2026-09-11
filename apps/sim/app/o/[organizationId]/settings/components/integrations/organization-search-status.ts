import type { OrganizationSearchProviderSummary } from '@/lib/api/contracts/knowledge/connectors'

const STATUS_LABELS: Record<OrganizationSearchProviderSummary['status'], string> = {
  needs_setup: 'Setup required',
  waiting_for_connections: 'Waiting for connections',
  indexing: 'Indexing',
  needs_attention: 'Sync failed',
  paused: 'Paused',
  active: 'Ready to search',
}

export function organizationSearchStatusLabel(provider: OrganizationSearchProviderSummary): string {
  if (!provider.approved) return 'Deactivated'
  if (provider.status === 'needs_setup' && provider.sourceCount > 0) return 'Waiting for first sync'
  if (provider.status === 'needs_attention') {
    const error =
      provider.issue === 'account_sync_incomplete'
        ? 'Some accounts are not up to date'
        : provider.issue === 'document_indexing_failed'
          ? 'Some documents failed to index'
          : 'Sync failed'
    return provider.isSyncing ? `Indexing · ${error}` : error
  }
  return STATUS_LABELS[provider.status]
}
