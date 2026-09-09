'use client'

import { useMemo, useRef } from 'react'
import { Chip, ChipInput } from '@sim/emcn'
import { Plus, Search as SearchIcon } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/components'
import { IntegrationSection } from '@/app/workspace/[workspaceId]/integrations/components/integration-section'
import { useScrollRestoration } from '@/app/workspace/[workspaceId]/integrations/hooks/use-scroll-restoration'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { MemberConnectorsSection } from '@/app/workspace/[workspaceId]/search/components/member-connectors-section/member-connectors-section'
import { SearchSourceRow } from '@/app/workspace/[workspaceId]/search/components/search-source-row'
import { SearchSourceSetup } from '@/app/workspace/[workspaceId]/search/components/search-source-setup'
import {
  connectorSearchParam,
  connectorSearchUrlKeys,
  managedSourceParam,
  searchSetupParam,
} from '@/app/workspace/[workspaceId]/search/search-params'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  searchSourceKeys,
  useSearchSources,
  useWorkspaceMemberConnectors,
} from '@/hooks/queries/kb/connectors'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useMemberAccessAvailable } from '@/hooks/use-member-access'
import { useMemberEnrollment } from '@/hooks/use-member-enrollment'

/** One source list for everyone; setup and management remain admin actions. */
export function Search() {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { features } = useWorkspaceHostContext()
  const memberAccessAvailable = useMemberAccessAvailable()
  const mirroredAccessAvailable = features?.knowledgeSourceMirroredAccess === true
  const { data: permissions } = useWorkspacePermissionsQuery(workspaceId)
  const canAdmin = permissions?.viewer?.isAdmin ?? false
  const sources = useSearchSources(workspaceId)
  const shared = useWorkspaceMemberConnectors(workspaceId, { enabled: memberAccessAvailable })
  const [searchTerm, setSearchTermParam] = useQueryState(connectorSearchParam.key, {
    ...connectorSearchParam.parser,
    ...connectorSearchUrlKeys,
  })
  const [, setSelectedType] = useQueryState(
    searchSetupParam.key,
    searchSetupParam.parser.withOptions({ history: 'replace' })
  )
  const [, setManagedSource] = useQueryState(
    managedSourceParam.key,
    managedSourceParam.parser.withOptions({ history: 'replace' })
  )
  const setSearchTerm = useDebouncedSearchSetter(setSearchTermParam)
  const membershipQueryKeys = useMemo(() => [searchSourceKeys.list(workspaceId)], [workspaceId])
  const connectedConnectorIds = useMemo(
    () =>
      new Set(
        sources.data
          ?.filter((source) => source.viewerMembership === 'connected')
          .map((source) => source.connectorId)
      ),
    [sources.data]
  )
  const { connect, isAwaiting, isPending, error } = useMemberEnrollment({
    membershipQueryKeys,
    connectedConnectorIds,
  })

  useScrollRestoration(scrollContainerRef, { ready: !sources.isPending })

  const normalizedSearch = searchTerm.trim().toLowerCase()
  const matches = (type: string, description: string) =>
    `${connectorDisplayName(type)} ${description}`.toLowerCase().includes(normalizedSearch)
  const visibleSources =
    sources.data?.filter((source) => matches(source.connectorType, source.sourceDescription)) ?? []
  const sharedConnectors = memberAccessAvailable
    ? (shared.data?.filter(
        (source) =>
          !source.knowledgeBaseIsSearchIndex &&
          matches(
            source.connectorType,
            `${source.knowledgeBaseName} ${source.sourceDescription ?? ''}`
          )
      ) ?? [])
    : []

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <IntegrationTabsHeader active='search' workspaceId={workspaceId} />
      <div
        ref={scrollContainerRef}
        className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'
      >
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          <div className='flex items-center justify-between gap-2'>
            <h1 className='text-[var(--text-body)] text-base'>Search sources</h1>
            {canAdmin && (memberAccessAvailable || mirroredAccessAvailable) && (
              <Chip
                variant='primary'
                leftIcon={Plus}
                onClick={() => {
                  void setSearchTermParam('')
                  void setSelectedType('')
                }}
              >
                Add source
              </Chip>
            )}
          </div>
          <ChipInput
            icon={SearchIcon}
            placeholder='Find a source...'
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <IntegrationSection label='Sources' layout='list'>
            {sources.isError ? (
              <SettingsQueryErrorState
                error={sources.error}
                fallback='Could not load sources'
                isRetrying={sources.isFetching}
                onRetry={() => void sources.refetch()}
                variant='inline'
              />
            ) : sources.isPending ? (
              <SettingsEmptyState variant='inline'>Loading sources…</SettingsEmptyState>
            ) : visibleSources.length > 0 ? (
              visibleSources.map((source) => (
                <SearchSourceRow
                  key={source.connectorId}
                  source={source}
                  workspaceId={workspaceId}
                  canAdmin={canAdmin}
                  available={
                    source.accessMode === 'members'
                      ? memberAccessAvailable
                      : mirroredAccessAvailable &&
                        (!source.connectionRequired || memberAccessAvailable)
                  }
                  waiting={isAwaiting(source.connectorId)}
                  isPending={isPending}
                  onConnect={() => connect(source.knowledgeBaseId, source.connectorId)}
                  onManage={() => void setManagedSource(source.connectorId, { history: 'push' })}
                />
              ))
            ) : (
              <SettingsEmptyState variant='inline'>
                {normalizedSearch
                  ? 'No matching sources.'
                  : canAdmin
                    ? 'Add a source to start indexing documents for Search.'
                    : 'Your workspace hasn’t added any sources yet. Ask a workspace admin to get started.'}
              </SettingsEmptyState>
            )}
          </IntegrationSection>
          {memberAccessAvailable &&
            (shared.isError ? (
              <SettingsQueryErrorState
                error={shared.error}
                fallback='Could not load sources shared with you'
                isRetrying={shared.isFetching}
                onRetry={() => void shared.refetch()}
                variant='inline'
              />
            ) : (
              <MemberConnectorsSection workspaceId={workspaceId} connectors={sharedConnectors} />
            ))}
          {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
          <SearchSourceSetup
            key={workspaceId}
            workspaceId={workspaceId}
            canAdmin={canAdmin}
            memberAccessAvailable={memberAccessAvailable}
            mirroredAccessAvailable={mirroredAccessAvailable}
          />
        </div>
      </div>
    </div>
  )
}
