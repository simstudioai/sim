'use client'

import { useMemo } from 'react'
import { Chip, chipContentGap, cn } from '@sim/emcn'
import { Loader, Plus } from '@sim/emcn/icons'
import {
  canConnectPersonally,
  SEARCH_CONNECTORS,
  type SearchConnector,
  SIM_SEARCH_KNOWLEDGE_BASE_NAME,
  searchConnectorUnavailableReason,
} from '@/lib/sim-search/connectors'
import { SourceSetupModal } from '@/app/workspace/[workspaceId]/home/components/search-sources/source-setup-modal'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { BrandIcon } from '@/blocks/brand-icon'
import {
  memberConnectorKeys,
  useWorkspaceMemberConnectors,
  type WorkspaceMemberConnector,
} from '@/hooks/queries/kb/connectors'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { CONNECTABLE_MEMBERSHIPS, useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const EMPTY_MEMBER_CONNECTORS: WorkspaceMemberConnector[] = []

/** The sources a person can connect themselves, alphabetical. */
const PERSONAL_SEARCH_CONNECTORS = SEARCH_CONNECTORS.filter((connector) =>
  canConnectPersonally(connector.meta)
)

/** The Sim Search connection per source, keyed by connector type. */
function simSearchConnectionsByType(
  connectors: readonly WorkspaceMemberConnector[]
): Map<string, WorkspaceMemberConnector> {
  const byType = new Map<string, WorkspaceMemberConnector>()
  for (const connector of connectors) {
    if (connector.knowledgeBaseName !== SIM_SEARCH_KNOWLEDGE_BASE_NAME) continue
    if (!byType.has(connector.connectorType)) byType.set(connector.connectorType, connector)
  }
  return byType
}

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
  /** Why the source cannot be connected here, shown as the chip's title; null when it can. */
  unavailableReason: string | null
  waiting: boolean
  disabled: boolean
  onConnect: () => void
}

function SourceChip({
  connector,
  connection,
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
  const title =
    unavailableReason ??
    (connected ? `${connector.meta.name}: ${state}` : `Connect ${connector.meta.name}`)
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
        <span>{connector.meta.name}</span>
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
  const { integrationAvailability } = usePermissionConfig()
  const { features } = useWorkspaceHostContext()
  /**
   * Judged by the workspace, as the server judges it: with per-member access
   * off, a connect is refused, so the chips say so instead of offering one.
   */
  const memberAccessAvailable = features?.knowledgeMemberAccess === true
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
  const connectionByType = useMemo(
    () => simSearchConnectionsByType(memberConnectors),
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
    connectionByType.get(connector.type)?.viewerMembership === 'connected'
  const ordered = [
    ...PERSONAL_SEARCH_CONNECTORS.filter(isConnected),
    ...PERSONAL_SEARCH_CONNECTORS.filter((connector) => !isConnected(connector)),
  ]

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap gap-1.5'>
        {ordered.map((connector) => {
          const connection = connectionByType.get(connector.type)
          return (
            <SourceChip
              key={connector.type}
              connector={connector}
              connection={connection}
              unavailableReason={searchConnectorUnavailableReason(
                connector,
                integrationAvailability,
                { memberAccessAvailable, hasConnection: connection !== undefined, canCreate }
              )}
              waiting={
                connection ? isAwaiting(connection.connectorId) : isAwaitingSource(connector.type)
              }
              disabled={isPending}
              onConnect={() => connectSearchSource(workspaceId, connector, connection)}
            />
          )
        })}
      </div>
      {error && <p className='px-2 text-[var(--text-error)] text-caption'>{error}</p>}
      {setupConnector && (
        <SourceSetupModal
          connector={setupConnector}
          onClose={closeSetup}
          onConnect={(sourceConfig) =>
            connectSource(workspaceId, setupConnector.type, sourceConfig)
          }
        />
      )}
    </div>
  )
}
