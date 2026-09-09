import type { ConnectorData } from '@/lib/api/contracts/knowledge/connectors'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { isConnectorSyncingOrPending } from '@/hooks/queries/kb/connectors'

const MEMBER_STATUS = {
  idle: 'active',
  pending: 'pending',
  running: 'syncing',
  error: 'error',
  disabled: 'disabled',
} as const

/** Member sync runs independently; an explicit pause or disable still takes precedence. */
export function getConnectorSyncState(connector: ConnectorData) {
  const syncsPerMember = connector.accessMode === 'members'
  const syncInFlight = isConnectorSyncingOrPending(connector)
  const canResume = connector.status === 'paused' || connector.status === 'disabled'
  const memberSyncDisabled = syncsPerMember && connector.memberSyncStatus === 'disabled'
  const canFullResync =
    Boolean(CONNECTOR_META_REGISTRY[connector.connectorType]?.rehydrateOnFullSync) &&
    !syncsPerMember

  return {
    syncsPerMember,
    syncInFlight,
    canResume,
    canFullResync,
    syncDisabled: syncInFlight || canResume || memberSyncDisabled,
    effectiveStatus:
      syncsPerMember && connector.status === 'active'
        ? MEMBER_STATUS[connector.memberSyncStatus]
        : connector.status,
    syncLabel:
      canResume || memberSyncDisabled
        ? 'Sync now'
        : connector.status === 'pending' ||
            (syncsPerMember && connector.memberSyncStatus === 'pending')
          ? 'Sync queued'
          : syncInFlight
            ? 'Syncing…'
            : 'Sync now',
    syncTooltip: canResume
      ? 'Resume to sync'
      : memberSyncDisabled
        ? 'Member sync is disabled'
        : undefined,
    lastSyncAt: syncsPerMember ? connector.lastMemberSyncAt : connector.lastSyncAt,
    nextSyncAt: syncsPerMember ? connector.nextMemberSyncAt : connector.nextSyncAt,
    lastSyncError: syncsPerMember
      ? (connector.lastMemberSyncError ?? connector.lastSyncError)
      : connector.lastSyncError,
  }
}
