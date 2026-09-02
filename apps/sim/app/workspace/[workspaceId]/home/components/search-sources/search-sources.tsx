'use client'

import { useMemo, useState } from 'react'
import { Chip } from '@sim/emcn'
import { Loader, Plus } from '@sim/emcn/icons'
import {
  canConnectPersonally,
  isSearchConnectorAvailable,
  personalSetupFields,
  SEARCH_CONNECTORS,
  type SearchConnector,
  SIM_SEARCH_KNOWLEDGE_BASE_NAME,
} from '@/lib/sim-search/connectors'
import { SourceSetupModal } from '@/app/workspace/[workspaceId]/home/components/search-sources/source-setup-modal'
import { BrandIcon } from '@/blocks/brand-icon'
import {
  memberConnectorKeys,
  useWorkspaceMemberConnectors,
  type WorkspaceMemberConnector,
} from '@/hooks/queries/kb/connectors'
import { CONNECTABLE_MEMBERSHIPS, useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const EMPTY_MEMBER_CONNECTORS: WorkspaceMemberConnector[] = []

/** The sources a person can connect themselves, alphabetical. */
const PERSONAL_SEARCH_CONNECTORS = SEARCH_CONNECTORS.filter((connector) =>
  canConnectPersonally(connector.meta)
)

/** A chip's trailing icon is a component, so the spinning loader needs a wrapper to carry `animate`. */
function SpinningLoader({ className }: { className?: string }) {
  return <Loader className={className} animate />
}

/** The Sim Search connection per source, keyed by connector type. */
export function simSearchConnectionsByType(
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
  unavailable: boolean
  waiting: boolean
  disabled: boolean
  onConnect: () => void
}

function SourceChip({
  connector,
  connection,
  unavailable,
  waiting,
  disabled,
  onConnect,
}: SourceChipProps) {
  const state = sourceState(connection, waiting)
  const connected = connection?.viewerMembership === 'connected'
  const actionable =
    !unavailable &&
    !waiting &&
    (!connection || CONNECTABLE_MEMBERSHIPS.has(connection.viewerMembership))
  const title = unavailable
    ? `${connector.meta.name} is unavailable in this deployment`
    : connected
      ? `${connector.meta.name}: ${state}`
      : `Connect ${connector.meta.name}`
  return (
    <Chip
      shape='round'
      active={connected}
      disabled={disabled || unavailable || !actionable}
      onClick={actionable ? onConnect : undefined}
      title={title}
      leftAdornment={<BrandIcon icon={connector.meta.icon} className='size-[14px] flex-shrink-0' />}
      rightIcon={waiting || isIndexing(connection) ? SpinningLoader : actionable ? Plus : undefined}
    >
      <span className='flex items-center gap-1.5'>
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
  const { data: memberConnectors = EMPTY_MEMBER_CONNECTORS } =
    useWorkspaceMemberConnectors(workspaceId)
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
  const { connect, connectSource, isAwaiting, isPending, error } = useMemberEnrollment({
    membershipQueryKeys,
    connectedConnectorIds,
  })
  const [setupConnector, setSetupConnector] = useState<SearchConnector | null>(null)

  /** Connected sources first, then the rest alphabetically. */
  const ordered = useMemo(() => {
    const rank = (connector: SearchConnector) =>
      connectionByType.get(connector.type)?.viewerMembership === 'connected' ? 0 : 1
    return [...PERSONAL_SEARCH_CONNECTORS].sort(
      (a, b) => rank(a) - rank(b) || a.meta.name.localeCompare(b.meta.name)
    )
  }, [connectionByType])

  const startConnect = (connector: SearchConnector) => {
    const connection = connectionByType.get(connector.type)
    if (connection) {
      connect(connection.knowledgeBaseId, connection.connectorId)
      return
    }
    if (personalSetupFields(connector.meta).length > 0) {
      setSetupConnector(connector)
      return
    }
    connectSource(workspaceId, connector.type)
  }

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
              unavailable={!isSearchConnectorAvailable(connector, integrationAvailability)}
              waiting={connection ? isAwaiting(connection.connectorId) : false}
              disabled={isPending}
              onConnect={() => startConnect(connector)}
            />
          )
        })}
      </div>
      {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
      {setupConnector && (
        <SourceSetupModal
          connector={setupConnector}
          fields={personalSetupFields(setupConnector.meta)}
          onOpenChange={(open) => {
            if (!open) setSetupConnector(null)
          }}
          onConnect={(sourceConfig) =>
            connectSource(workspaceId, setupConnector.type, sourceConfig)
          }
        />
      )}
    </div>
  )
}
