'use client'

import { useState } from 'react'
import {
  Chip,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalHeader,
} from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import dynamic from 'next/dynamic'
import { useQueryState } from 'nuqs'
import { useSession } from '@/lib/auth/auth-client'
import { canConnectPersonally, getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  managedSourceParam,
  searchSetupParam,
} from '@/app/workspace/[workspaceId]/search/search-params'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { useConnectorList, usePrepareSearchSource } from '@/hooks/queries/kb/connectors'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const AddConnectorModal = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal').then(
      (module) => module.AddConnectorModal
    ),
  { ssr: false }
)
const SearchSourceStatus = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/search/components/search-source-status').then(
      (module) => module.SearchSourceStatus
    ),
  { ssr: false }
)

const SOURCE_TYPES = Object.entries(CONNECTOR_META_REGISTRY)
  .filter(([, meta]) => meta.search && (meta.mirrorsSourceAcls || canConnectPersonally(meta)))
  .sort(([, left], [, right]) => left.name.localeCompare(right.name))

interface SearchSourceSetupProps {
  workspaceId: string
  canAdmin: boolean
  memberAccessAvailable: boolean
  mirroredAccessAvailable: boolean
}

/** Owns admin setup and existing source management, including bookmarked OAuth return URLs. */
export function SearchSourceSetup({
  workspaceId,
  canAdmin,
  memberAccessAvailable,
  mirroredAccessAvailable,
}: SearchSourceSetupProps) {
  const { data: session } = useSession()
  const {
    integrationAvailability,
    oauthServiceAvailability,
    isIntegrationAvailabilityReady,
    isIntegrationAvailabilityFetching,
    isIntegrationAvailabilityLoading,
    integrationAvailabilityError,
    refetchIntegrationAvailability,
  } = usePermissionConfig()
  const [selectedType, setSelectedType] = useQueryState(
    searchSetupParam.key,
    searchSetupParam.parser.withOptions({ history: 'replace' })
  )
  const [managedSource, setManagedSource] = useQueryState(
    managedSourceParam.key,
    managedSourceParam.parser.withOptions({ history: 'replace' })
  )
  const [search, setSearch] = useState('')
  const prepare = usePrepareSearchSource()
  const open = selectedType !== null || managedSource !== null
  const bases = useKnowledgeBasesQuery(workspaceId, { enabled: canAdmin && open })
  const knowledgeBaseId = bases.data?.find((base) => base.isSearchIndex === true)?.id
  const connectors = useConnectorList(canAdmin && managedSource ? knowledgeBaseId : undefined)

  if (!canAdmin || !open) return null

  const close = () => {
    if (prepare.isPending) return
    if (selectedType !== null) void setSelectedType(null)
    if (managedSource !== null) void setManagedSource(null)
  }
  const failedQuery = bases.isError
    ? bases
    : managedSource && connectors.isError
      ? connectors
      : null
  const selectedMeta = selectedType ? CONNECTOR_META_REGISTRY[selectedType] : undefined
  const managedConnectors =
    connectors.data?.filter(
      (connector) => connector.id === managedSource || connector.connectorType === managedSource
    ) ?? []
  const managedType =
    managedConnectors[0]?.connectorType ??
    (managedSource && CONNECTOR_META_REGISTRY[managedSource] ? managedSource : undefined)
  const initialMode = (type: string) => {
    const meta = CONNECTOR_META_REGISTRY[type]
    if (
      meta &&
      getConnectorAccessAvailability(meta, integrationAvailability, {
        memberAccessAvailable,
        mirroredAccessAvailable,
        oauthServiceAvailability,
        isIntegrationAvailabilityReady:
          isIntegrationAvailabilityReady || integrationAvailability.size > 0,
      }).admin
    )
      return 'admin' as const
    return 'members' as const
  }

  if (
    !failedQuery &&
    knowledgeBaseId &&
    (isIntegrationAvailabilityReady || integrationAvailability.size > 0)
  ) {
    if (selectedType && session?.user?.id) {
      return (
        <AddConnectorModal
          key={`${session.user.id}:${knowledgeBaseId}:${selectedType}`}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) void setSelectedType(null)
          }}
          knowledgeBaseId={knowledgeBaseId}
          isSearchIndex
          initialConnectorType={selectedType}
          initialAccessMode={initialMode(selectedType)}
          setupDraftKey={`${session.user.id}:${workspaceId}:${knowledgeBaseId}:${selectedType}`}
          onConnectorTypeChange={(type) =>
            void setSelectedType(type !== null ? searchSetupParam.parser.parse(type) : null)
          }
        />
      )
    }
    if (managedSource && (connectors.isPending || managedType)) {
      return (
        <SearchSourceStatus
          workspaceId={workspaceId}
          knowledgeBaseId={knowledgeBaseId}
          connectorType={managedType ?? ''}
          connectors={managedConnectors}
          isLoading={connectors.isPending}
          onClose={() => void setManagedSource(null)}
        />
      )
    }
  }

  const normalizedSearch = search.trim().toLowerCase()
  const visibleTypes = SOURCE_TYPES.filter(([type, meta]) =>
    selectedType
      ? type === selectedType
      : `${meta.name} ${meta.description}`.toLowerCase().includes(normalizedSearch)
  )

  return (
    <ChipModal
      open
      dismissDisabled={prepare.isPending}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close()
      }}
      srTitle='Add source'
    >
      <ChipModalHeader onClose={close}>
        {selectedMeta ? `Configure ${selectedMeta.name}` : 'Add source'}
      </ChipModalHeader>
      <ChipModalBody>
        {failedQuery ? (
          <ChipModalField type='custom' title='Source setup'>
            <SettingsQueryErrorState
              error={failedQuery.error}
              fallback='Could not load source setup'
              isRetrying={failedQuery.isFetching}
              onRetry={() => void failedQuery.refetch()}
              variant='inline'
            />
          </ChipModalField>
        ) : integrationAvailabilityError ? (
          <ChipModalField type='custom' title='Connection availability'>
            <SettingsQueryErrorState
              error={integrationAvailabilityError}
              isRetrying={isIntegrationAvailabilityFetching}
              fallback='Could not load connection availability'
              onRetry={() => void refetchIntegrationAvailability()}
              variant='inline'
            />
          </ChipModalField>
        ) : isIntegrationAvailabilityLoading ? (
          <ChipModalField type='custom' title='Sources'>
            <SettingsEmptyState variant='inline'>Loading sources…</SettingsEmptyState>
          </ChipModalField>
        ) : managedSource ? (
          <ChipModalField type='custom' title='Source'>
            <SettingsEmptyState variant='inline'>
              {bases.isPending ? 'Loading source…' : 'This source is no longer available.'}
            </SettingsEmptyState>
          </ChipModalField>
        ) : (
          <>
            {!selectedType && (
              <ChipModalField type='custom' title='Find a source' submitOnEnter={false}>
                <ChipInput
                  icon={Search}
                  placeholder='Find a source…'
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </ChipModalField>
            )}
            <ChipModalField type='custom' title='Sources'>
              <div className={RESOURCE_LIST_STACK}>
                {visibleTypes.map(([type, meta]) => {
                  const { admin: central, members } = getConnectorAccessAvailability(
                    meta,
                    integrationAvailability,
                    {
                      memberAccessAvailable,
                      mirroredAccessAvailable,
                      oauthServiceAvailability,
                      isIntegrationAvailabilityReady,
                    }
                  )
                  const available = central || members
                  return (
                    <SettingsResourceRow
                      key={type}
                      iconVariant='custom'
                      icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                      title={meta.name}
                      description={
                        !available
                          ? 'Not available in this workspace'
                          : central
                            ? meta.adminSetupHint
                            : undefined
                      }
                      disabled={!available}
                      trailing={
                        available ? (
                          <Chip
                            variant='primary'
                            disabled={prepare.isPending || bases.isPending}
                            onClick={() => {
                              if (knowledgeBaseId)
                                void setSelectedType(searchSetupParam.parser.parse(type))
                              else
                                prepare.mutate(
                                  {
                                    workspaceId,
                                    connectorType: type,
                                    accessMode: central ? 'admin' : 'members',
                                  },
                                  {
                                    onSuccess: () =>
                                      void setSelectedType(searchSetupParam.parser.parse(type)),
                                  }
                                )
                            }}
                          >
                            {selectedType ? 'Continue setup' : 'Set up'}
                          </Chip>
                        ) : undefined
                      }
                    />
                  )
                })}
                {visibleTypes.length === 0 && (
                  <SettingsEmptyState variant='inline'>No matching sources.</SettingsEmptyState>
                )}
              </div>
            </ChipModalField>
            <ChipModalError>{prepare.error?.message}</ChipModalError>
          </>
        )}
      </ChipModalBody>
    </ChipModal>
  )
}
