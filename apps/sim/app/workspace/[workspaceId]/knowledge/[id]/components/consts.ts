import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import { effectiveConnectorSyncIntervalMinutes } from '@/lib/knowledge/connectors/access-modes'

/** Explain when permission refresh requires a more frequent pass than content indexing. */
export function connectorSyncFrequencyHint(
  accessMode: ConnectorAccessMode,
  syncInterval: number,
  hasContentCredential: boolean
): string | undefined {
  if (accessMode === 'workspace') return undefined
  if (syncInterval === 0) {
    return 'Content and permissions update only when you sync. Documents become unavailable after 24 hours without a successful permission check.'
  }
  if (effectiveConnectorSyncIntervalMinutes(accessMode, syncInterval) === syncInterval) {
    return 'Permissions are checked on every sync.'
  }
  return accessMode === 'members' && hasContentCredential
    ? 'Content follows this schedule. Member permissions are checked every hour.'
    : 'Source permissions require a sync every hour, even when a longer interval is selected. Unchanged documents are not re-indexed.'
}

export const SYNC_INTERVALS = [
  { label: 'Live', value: 5, requiresMax: true },
  { label: 'Every hour', value: 60, requiresMax: false },
  { label: 'Every 6 hours', value: 360, requiresMax: false },
  { label: 'Daily', value: 1440, requiresMax: false },
  { label: 'Weekly', value: 10080, requiresMax: false },
  { label: 'Manual only', value: 0, requiresMax: false },
] as const
