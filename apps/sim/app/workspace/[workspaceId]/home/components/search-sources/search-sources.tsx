'use client'

import { useMemo } from 'react'
import { Chip, chipContentGap, cn, OverflowText } from '@sim/emcn'
import { Loader, Plus } from '@sim/emcn/icons'
import { groupSearchConnections } from '@/lib/sim-search/connections'
import {
  canConnectPersonally,
  SEARCH_CONNECTORS,
  type SearchConnector,
  searchConnectorUnavailableReason,
} from '@/lib/sim-search/connectors'
import { SourceSetupModal } from '@/app/workspace/[workspaceId]/home/components/search-sources/source-setup-modal'
import { BrandIcon } from '@/blocks/brand-icon'
import {
  memberConnectorKeys,
  useWorkspaceMemberConnectors,
  type WorkspaceMemberConnector,
} from '@/hooks/queries/kb/connectors'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useMemberAccessAvailable } from '@/hooks/use-member-access'
import { CONNECTABLE_MEMBERSHIPS, useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const EMPTY_MEMBER_CONNECTORS: WorkspaceMemberConnector[] = []

/** The sources a person can connect themselves, alphabetical. */
const PERSONAL_SEARCH_CONNECTORS = SEARCH_CONNECTORS.filter((connector) =>
  canConnectPersonally(connector.meta)
)

/** Whether a connected source is still indexing for the viewer. */
export function isIndexing(connection: WorkspaceMemberConnector | undefined): boolean {
  return (
    connection?.viewerMembership === 'connected' &&
    (connection.memberSyncStatus === 'pending' || connection.memberSyncStatus === 'running')
  )
}

/** The chip's trailing state text for one source. */
function sourceState(
  connection: WorkspaceMemberConnector | undefined,
  waiting: boolean
): string | null {
  if (waiting) return 'Connecting…'
  if (!connection) return null
  switch (connection.viewerMembership) {
    case 'connected':
      return isIndexing(connection)
        ? 'Indexing'
        : connection.viewerDocumentCount === 1
          ? '1 document'
          : `${connection.viewerDocumentCount} documents`
    case 'needs_reauth':
      return 'Reconnect'
    case 'unverified_email':
      return 'Verify email'
    case 'revoked':
      return 'Access removed'
    default:
      return null
  }
}

interface SourceChipProps {
  connector: SearchConnector
  connection: WorkspaceMemberConnector | undefined
  showSource: boolean
  /** Why the source cannot be connected here, shown as the chip's title; null when it can. */
  unavailableReason: string | null
  waiting: boolean
  disabled: boolean
  onConnect: () => void
}

function SourceChip({
  connector,
  connection,
  showSource,
  unavailableReason,
  waiting,
  disabled,
  onConnect,
}: SourceChipProps) {
  const state = sourceState(connection, waiting)
  const connected = connection?.viewerMembership === 'connected'
  const unavailable = unavailableReason !== null
  const actionable =
    !unavailable &&
    !waiting &&
    (!connection || CONNECTABLE_MEMBERSHIPS.has(connection.viewerMembership))
  const name =
    showSource && connection?.sourceDescription
      ? `${connector.meta.name} · ${connection.sourceDescription}`
      : connector.meta.name
  const title = unavailableReason ?? (connected ? `${name}: ${state}` : `Connect ${name}`)
  const busy = waiting || isIndexing(connection)
  return (
    <Chip
      shape='round'
      active={connected}
      disabled={disabled || unavailable}
      aria-disabled={!actionable || undefined}
      onClick={actionable ? onConnect : undefined}
      className={cn(!actionable && !unavailable && 'cursor-default')}
      title={title}
      leftAdornment={<BrandIcon icon={connector.meta.icon} className='size-[14px] shrink-0' />}
      rightIcon={!busy && actionable ? Plus : undefined}
      rightAdornment={
        busy ? <Loader className='size-[14px] text-[var(--text-icon)]' animate /> : undefined
      }
    >
      <span className={cn('flex items-baseline', chipContentGap)}>
        <OverflowText label={name} className='max-w-[280px]' focusTarget='nearest-interactive' />
        {state && <span className='text-[var(--text-muted)] text-caption'>{state}</span>}
      </span>
    </Chip>
  )
}

interface SearchSourcesProps {
  workspaceId: string
}

/**
 * Every source a person can connect themselves, as chips under the composer:
 * connected ones show how many documents they can read (or that indexing is
 * still running), the rest connect with one click. A source that needs a site
 * or space asks for it once, in place, on the connect that creates it;
 * everyone after that clicks straight through. Sources an admin must set up
 * as workspace connectors do not appear here.
 */
export function SearchSources({ workspaceId }: SearchSourcesProps) {
  const { integrationAvailability, oauthServiceAvailability, isIntegrationAvailabilityReady } =
    usePermissionConfig()
  /** With per-member access off, a connect is refused, so the chips say so instead. */
  const memberAccessAvailable = useMemberAccessAvailable()
  const { data: workspacePermissions } = useWorkspacePermissionsQuery(workspaceId)
  /** The first connect of a source turns it on for the workspace, which takes an admin. */
  const canCreate = workspacePermissions?.viewer?.isAdmin ?? false
  const { data: memberConnectorRows } = useWorkspaceMemberConnectors(workspaceId, {
    enabled: memberAccessAvailable,
  })
  /** Rows cached before the feature went off are not this surface's to show. */
  const memberConnectors = memberAccessAvailable
    ? (memberConnectorRows ?? EMPTY_MEMBER_CONNECTORS)
    : EMPTY_MEMBER_CONNECTORS
  const { connectionByType } = useMemo(
    () => groupSearchConnections(memberConnectors),
    [memberConnectors]
  )
  const connectedConnectorIds = useMemo(
    () =>
      new Set(
        memberConnectors
          .filter((connector) => connector.viewerMembership === 'connected')
          .map((connector) => connector.connectorId)
      ),
    [memberConnectors]
  )
  const membershipQueryKeys = useMemo(() => [memberConnectorKeys.list(workspaceId)], [workspaceId])
  const {
    connectSource,
    connectSearchSource,
    setupConnector,
    closeSetup,
    isAwaiting,
    isAwaitingSource,
    isPending,
    error,
  } = useMemberEnrollment({ membershipQueryKeys, connectedConnectorIds })

  /** Connected sources first; the catalog is already alphabetical, so the partition keeps the order. */
  const isConnected = (connector: SearchConnector) =>
    connectionByType.get(connector.type)?.some((source) => source.viewerMembership === 'connected')
  const ordered = [
    ...PERSONAL_SEARCH_CONNECTORS.filter(isConnected),
    ...PERSONAL_SEARCH_CONNECTORS.filter((connector) => !isConnected(connector)),
  ]

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap gap-1.5'>
        {ordered.flatMap((connector) => {
          const connections = connectionByType.get(connector.type) ?? []
          return (connections.length ? connections : [undefined]).map((connection) => (
            <SourceChip
              key={connection?.connectorId ?? connector.type}
              connector={connector}
              connection={connection}
              showSource={connections.length > 1}
              unavailableReason={searchConnectorUnavailableReason(
                connector,
                integrationAvailability,
                {
                  memberAccessAvailable,
                  hasConnection: connection !== undefined,
                  canCreate,
                  oauthServiceAvailability,
                  isIntegrationAvailabilityReady,
                }
              )}
              waiting={
                connection ? isAwaiting(connection.connectorId) : isAwaitingSource(connector.type)
              }
              disabled={isPending}
              onConnect={() => connectSearchSource(workspaceId, connector, connection)}
            />
          ))
        })}
      </div>
      {error && <p className='px-2 text-[var(--text-error)] text-caption'>{error}</p>}
      {setupConnector && (
        <SourceSetupModal
          connector={setupConnector}
          isPending={isPending}
          error={error}
          onClose={closeSetup}
          onConnect={(sourceConfig) =>
            connectSource(workspaceId, setupConnector.type, sourceConfig)
          }
        />
      )}
    </div>
  )
}
