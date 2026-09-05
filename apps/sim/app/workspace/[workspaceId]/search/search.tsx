'use client'

import { useMemo, useRef } from 'react'
import { Chip, ChipInput, ChipLink } from '@sim/emcn'
import { Search as SearchIcon } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
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
import { slackSearchSetupHref } from '@/lib/sim-search/setup-navigation'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/components'
import { SourceSetupModal } from '@/app/workspace/[workspaceId]/home/components/search-sources/source-setup-modal'
import { IntegrationSection } from '@/app/workspace/[workspaceId]/integrations/components/integration-section'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { useScrollRestoration } from '@/app/workspace/[workspaceId]/integrations/hooks/use-scroll-restoration'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { ManagedSearchSources } from '@/app/workspace/[workspaceId]/search/components/managed-search-sources'
import { MemberConnectorsSection } from '@/app/workspace/[workspaceId]/search/components/member-connectors-section/member-connectors-section'
import { SearchMcpSetup } from '@/app/workspace/[workspaceId]/search/components/search-mcp-setup'
import {
  connectorSearchParam,
  connectorSearchUrlKeys,
} from '@/app/workspace/[workspaceId]/search/search-params'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { useWorkspaceAccounts } from '@/hooks/queries/credential-groups'
import {
  memberConnectorKeys,
  useWorkspaceMemberConnectors,
  type WorkspaceMemberConnector,
} from '@/hooks/queries/kb/connectors'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
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
  if (count === 0) return 'Connected · No searchable documents yet'
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
  setupHref?: string
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
  setupHref,
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
      description={
        setupHref && !unavailable
          ? 'Set up Slack once for this workspace. Then each person connects their own account.'
          : description
      }
      disabled={unavailable || !personal}
      trailing={
        setupHref && !unavailable ? (
          <ChipLink href={setupHref} variant='primary'>
            Set up Slack
          </ChipLink>
        ) : connectable ? (
          <Chip variant='primary' onClick={onConnect} disabled={isPending}>
            {enrollmentActionLabel(membership ?? 'not_enrolled', waiting)}
          </Chip>
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
  const workspaceId = (params?.workspaceId as string) || ''
  const { integrationAvailability } = usePermissionConfig()
  const { features } = useWorkspaceHostContext()
  /**
   * Judged by the workspace, as the server judges it: with per-member access
   * off, every connect is refused, so the rows say so instead of offering
   * one and the memberships are not fetched.
   */
  const memberAccessAvailable = features?.knowledgeMemberAccess === true
  const { data: workspacePermissions } = useWorkspacePermissionsQuery(workspaceId)
  /** The first connect of a source turns it on for the workspace, which takes an admin. */
  const canCreate = workspacePermissions?.viewer?.isAdmin ?? false
  const workspaceAccounts = useWorkspaceAccounts(
    canCreate && memberAccessAvailable ? workspaceId : undefined
  )
  const slackReady =
    workspaceAccounts.data?.credentialGroup?.status === 'active' &&
    workspaceAccounts.data.credentialGroup.options.some(
      (option) =>
        option.provider === 'slack' &&
        option.status === 'active' &&
        option.configurationStatus === 'ready'
    )

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
          <div className='flex flex-col gap-2'>
            <h1 className='text-[var(--text-body)] text-base'>Connect sources to Search</h1>
            <p className='text-[var(--text-muted)] text-small leading-relaxed'>
              Connect an account, choose what to sync, and search your documents in Sim.
            </p>
          </div>
          <ChipInput
            icon={SearchIcon}
            placeholder='Find a source...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {!normalizedSearch && <SearchMcpSetup workspaceId={workspaceId} />}

          <div className='flex flex-col gap-7'>
            <ManagedSearchSources
              key={workspaceId}
              workspaceId={workspaceId}
              canAdmin={canCreate}
              available={features?.knowledgeSourceMirroredAccess === true}
              search={normalizedSearch}
            />
            {visibleConnectors.length > 0 && (
              <IntegrationSection
                label={CONNECTORS_LABEL}
                layout='list'
                description='Connect your own account to search documents you can access. Each teammate connects separately; connecting does not share your private documents with the workspace.'
              >
                {visibleConnectors.map((connector) => {
                  const connections = (connectionByType.get(connector.type) ?? [undefined]).filter(
                    (connection) => matchesCatalog(connector) || matchesSource(connection)
                  )
                  if (
                    connector.type === 'slack' &&
                    canCreate &&
                    memberAccessAvailable &&
                    workspaceAccounts.error
                  ) {
                    return (
                      <SettingsQueryErrorState
                        key='slack'
                        error={workspaceAccounts.error}
                        fallback='Could not load Slack setup'
                        isRetrying={workspaceAccounts.isFetching}
                        onRetry={() => void workspaceAccounts.refetch()}
                        variant='inline'
                      />
                    )
                  }
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
                      isPending={
                        isPending ||
                        (connector.type === 'slack' && canCreate && workspaceAccounts.isLoading)
                      }
                      setupHref={
                        connector.type === 'slack' &&
                        canCreate &&
                        !workspaceAccounts.isLoading &&
                        !slackReady
                          ? slackSearchSetupHref(workspaceId, 'search')
                          : undefined
                      }
                      onConnect={() => connectSearchSource(workspaceId, connector, connection)}
                    />
                  ))
                })}
              </IntegrationSection>
            )}

            {existingSources.length > 0 && (
              <IntegrationSection label='Existing sources' layout='list'>
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
