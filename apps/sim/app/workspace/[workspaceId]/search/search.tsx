'use client'

import { useMemo, useRef } from 'react'
import { Button, ChipInput, ChipLink } from '@sim/emcn'
import { Search as SearchIcon } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { groupSearchConnections } from '@/lib/sim-search/connections'
import {
  canConnectPersonally,
  connectorDisplayName,
  isSearchConnectorAvailable,
  MANAGED_SEARCH_CONNECTORS,
  SEARCH_CONNECTORS,
  type SearchConnector,
  searchConnectorUnavailableReason,
} from '@/lib/sim-search/connectors'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/components'
import { SourceSetupModal } from '@/app/workspace/[workspaceId]/home/components/search-sources/source-setup-modal'
import { IntegrationSection } from '@/app/workspace/[workspaceId]/integrations/components/integration-section'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { useScrollRestoration } from '@/app/workspace/[workspaceId]/integrations/hooks/use-scroll-restoration'
import { SlackMemberSetup } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field'
import { ManagedSearchSources } from '@/app/workspace/[workspaceId]/search/components/managed-search-sources'
import { MemberConnectorsSection } from '@/app/workspace/[workspaceId]/search/components/member-connectors-section/member-connectors-section'
import { SearchMcpSetup } from '@/app/workspace/[workspaceId]/search/components/search-mcp-setup'
import {
  connectorSearchParam,
  connectorSearchUrlKeys,
} from '@/app/workspace/[workspaceId]/search/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import {
  memberConnectorKeys,
  useWorkspaceMemberConnectors,
  type WorkspaceMemberConnector,
} from '@/hooks/queries/kb/connectors'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useMemberAccessAvailable } from '@/hooks/use-member-access'
import {
  CONNECTABLE_MEMBERSHIPS,
  describeMembership,
  enrollmentActionLabel,
  useMemberEnrollment,
} from '@/hooks/use-member-enrollment'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const EMPTY_MEMBER_CONNECTORS: WorkspaceMemberConnector[] = []
const CONNECTORS_LABEL = 'Your accounts'
const NEEDS_KNOWLEDGE_BASE_SETUP = 'Set up by a workspace admin from a knowledge base.'

/** What a source row says once the viewer's own indexing has settled. */
function connectedDescription(connector: WorkspaceMemberConnector): string {
  const count = connector.viewerDocumentCount
  return count === 1 ? 'Connected · 1 document' : `Connected · ${count} documents`
}

interface SourceRowProps {
  connector: SearchConnector
  /** The Sim Search per-member connector for this source, once anyone has connected it. */
  connection: WorkspaceMemberConnector | undefined
  /** Why the source cannot be connected here, shown in place of its state; null when it can. */
  unavailableReason: string | null
  waiting: boolean
  isPending: boolean
  onConnect: () => void
}

/**
 * One Sim Search source: what the viewer's connection is doing (indexing,
 * how many documents they can read, what to do next) and the one action open
 * to them. A source nobody has connected yet offers Connect, which creates its
 * connector and enrolls the viewer in one step.
 */
function SourceRow({
  connector,
  connection,
  unavailableReason,
  waiting,
  isPending,
  onConnect,
}: SourceRowProps) {
  const unavailable = unavailableReason !== null
  const personal = canConnectPersonally(connector.meta)
  const membership = connection?.viewerMembership
  const state = connection
    ? (describeMembership({
        membership: connection.viewerMembership,
        memberSyncStatus: connection.memberSyncStatus,
        waiting,
        name: connector.meta.name,
      }) ?? connectedDescription(connection))
    : waiting
      ? `Finish connecting your ${connector.meta.name} account in the other tab.`
      : connector.meta.description
  const description = [
    connection?.sourceDescription,
    unavailableReason ?? (personal ? state : NEEDS_KNOWLEDGE_BASE_SETUP),
  ]
    .filter(Boolean)
    .join(' · ')
  const connectable =
    !unavailable && !waiting && personal && (!membership || CONNECTABLE_MEMBERSHIPS.has(membership))
  return (
    <SettingsResourceRow
      iconVariant='custom'
      icon={<IntegrationTile blockType={connector.blockType} icon={connector.meta.icon} />}
      title={connector.meta.name}
      description={description}
      disabled={unavailable || !personal}
      trailing={
        connectable ? (
          <Button variant='primary' size='sm' onClick={onConnect} disabled={isPending}>
            {enrollmentActionLabel(membership ?? 'not_enrolled', waiting)}
          </Button>
        ) : undefined
      }
    />
  )
}

/**
 * The Sim Search catalog: every source a person can connect with one click,
 * each row showing where the viewer's own connection stands. Connecting opens
 * the enrollment for the workspace's Sim Search knowledge base, and indexing
 * starts on its own once the account is linked; documents count up here as
 * they land. Per-member connectors in other knowledge bases are listed below
 * under Shared with you, with the same actions.
 */
export function Search() {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const params = useParams()
  const router = useRouter()
  const workspaceId = (params?.workspaceId as string) || ''
  const { integrationAvailability } = usePermissionConfig()
  /**
   * With per-member access off, every connect is refused, so the rows say so
   * and the memberships are not fetched.
   */
  const memberAccessAvailable = useMemberAccessAvailable()
  const { data: workspacePermissions } = useWorkspacePermissionsQuery(workspaceId)
  /** The first connect of a source turns it on for the workspace, which takes an admin. */
  const canCreate = workspacePermissions?.viewer?.isAdmin ?? false

  const [searchTerm, setSearchTermParam] = useQueryState(connectorSearchParam.key, {
    ...connectorSearchParam.parser,
    ...connectorSearchUrlKeys,
  })
  /**
   * The input binds to the instant nuqs value; only the URL write is debounced.
   * Filtering reads the same instant value: it is a cheap in-memory pass over a
   * small static list, which is exactly the case the url-state rule permits.
   */
  const setSearchTerm = useDebouncedSearchSetter(setSearchTermParam)

  const { data: memberConnectorRows, isPending: connectionsPending } = useWorkspaceMemberConnectors(
    workspaceId,
    { enabled: memberAccessAvailable }
  )
  /** Rows cached before the feature went off are not this surface's to show. */
  const memberConnectors = memberAccessAvailable
    ? (memberConnectorRows ?? EMPTY_MEMBER_CONNECTORS)
    : EMPTY_MEMBER_CONNECTORS
  useScrollRestoration(scrollContainerRef, {
    ready: !memberAccessAvailable || !connectionsPending,
  })

  /** The Sim Search connection per source; other knowledge bases' connectors keep their own section. */
  const { connectionByType, sharedConnectors } = useMemo(
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
  } = useMemberEnrollment({
    membershipQueryKeys,
    connectedConnectorIds,
  })

  const normalizedSearch = searchTerm.trim().toLowerCase()
  const matchesCatalog = (connector: SearchConnector) =>
    !normalizedSearch ||
    `${connector.meta.name} ${connector.meta.description}`.toLowerCase().includes(normalizedSearch)
  const matchesSource = (connection: WorkspaceMemberConnector | undefined) =>
    connection?.sourceDescription?.toLowerCase().includes(normalizedSearch) ?? false
  const visibleConnectors = SEARCH_CONNECTORS.filter(
    (connector) =>
      (connectionByType.has(connector.type) ||
        isSearchConnectorAvailable(connector, integrationAvailability)) &&
      (matchesCatalog(connector) || connectionByType.get(connector.type)?.some(matchesSource))
  )
  const visibleSharedConnectors = normalizedSearch
    ? sharedConnectors.filter((connector) =>
        [
          connectorDisplayName(connector.connectorType),
          connector.knowledgeBaseName,
          connector.sourceDescription ?? '',
        ].some((text) => text.toLowerCase().includes(normalizedSearch))
      )
    : sharedConnectors
  const existingSources = [...connectionByType.entries()].flatMap(([type, connections]) =>
    SEARCH_CONNECTORS.some((connector) => connector.type === type)
      ? []
      : connections.filter(
          (connection) =>
            !normalizedSearch ||
            matchesSource(connection) ||
            connectorDisplayName(type).toLowerCase().includes(normalizedSearch)
        )
  )

  const showNoResults =
    Boolean(normalizedSearch) &&
    visibleConnectors.length === 0 &&
    visibleSharedConnectors.length === 0 &&
    existingSources.length === 0 &&
    !MANAGED_SEARCH_CONNECTORS.some(({ meta }) =>
      `${meta.name} ${meta.description}`.toLowerCase().includes(normalizedSearch)
    )

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <IntegrationTabsHeader active='search' workspaceId={workspaceId} />
      <div
        ref={scrollContainerRef}
        className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'
      >
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          <ChipInput
            icon={SearchIcon}
            placeholder='Search connectors...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          <div className='flex flex-col gap-7'>
            {!normalizedSearch && <SearchMcpSetup workspaceId={workspaceId} />}
            <ManagedSearchSources
              key={workspaceId}
              workspaceId={workspaceId}
              canAdmin={canCreate}
              available={features?.knowledgeSourceMirroredAccess === true}
              search={normalizedSearch}
            />
            {visibleConnectors.length > 0 && (
              <IntegrationSection label={CONNECTORS_LABEL}>
                {visibleConnectors.map((connector) => {
                  const connections = (connectionByType.get(connector.type) ?? [undefined]).filter(
                    (connection) => matchesCatalog(connector) || matchesSource(connection)
                  )
                  return connections.map((connection) => (
                    <SourceRow
                      key={connection?.connectorId ?? connector.type}
                      connector={connector}
                      connection={connection}
                      unavailableReason={searchConnectorUnavailableReason(
                        connector,
                        integrationAvailability,
                        {
                          memberAccessAvailable,
                          hasConnection: connection !== undefined,
                          canCreate,
                        }
                      )}
                      waiting={
                        connection
                          ? isAwaiting(connection.connectorId)
                          : isAwaitingSource(connector.type)
                      }
                      isPending={isPending}
                      onConnect={() => connectSearchSource(workspaceId, connector, connection)}
                    />
                  ))
                })}
              </IntegrationSection>
            )}

            {canCreate &&
              memberAccessAvailable &&
              !connectionByType.has('slack') &&
              visibleConnectors.some((connector) => connector.type === 'slack') && (
                <SlackMemberSetup workspaceId={workspaceId} />
              )}

            {existingSources.length > 0 && (
              <IntegrationSection label='Existing sources'>
                {existingSources.map((connection) => (
                  <SettingsResourceRow
                    key={connection.connectorId}
                    title={
                      CONNECTOR_META_REGISTRY[connection.connectorType]?.name ??
                      connectorDisplayName(connection.connectorType)
                    }
                    description={[
                      connection.sourceDescription,
                      'Available in its knowledge base. New Search connections are not supported.',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    trailing={
                      <ChipLink
                        href={`/workspace/${workspaceId}/knowledge/${connection.knowledgeBaseId}`}
                      >
                        {canCreate ? 'Manage' : 'View'}
                      </ChipLink>
                    }
                  />
                ))}
              </IntegrationSection>
            )}

            {memberAccessAvailable && (
              <MemberConnectorsSection
                workspaceId={workspaceId}
                connectors={visibleSharedConnectors}
              />
            )}

            {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
            {setupConnector && (
              <SourceSetupModal
                connector={setupConnector}
                onClose={closeSetup}
                onConnect={(sourceConfig) =>
                  connectSource(workspaceId, setupConnector.type, sourceConfig)
                }
              />
            )}

            {showNoResults && (
              <SettingsEmptyState variant='inline'>
                No connectors found matching “{searchTerm}”
              </SettingsEmptyState>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
