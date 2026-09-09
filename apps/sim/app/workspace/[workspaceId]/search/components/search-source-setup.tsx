'use client'

import { useEffect, useState } from 'react'
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
import { useRouter } from 'next/navigation'
import { useQueryState, useQueryStates } from 'nuqs'
import { useSession } from '@/lib/auth/auth-client'
import {
  type ResourceScope,
  resourceScopeFields,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getConnectorAccessAvailability, SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  managedSourceParam,
  searchSetupAccessParam,
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
import {
  useConnectorList,
  usePrepareSearchSource,
  useSearchIndex,
} from '@/hooks/queries/kb/connectors'
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

interface SearchSourceSetupProps {
  workspaceId?: string
  scope?: ResourceScope
  canAdmin: boolean
  memberAccessAvailable: boolean
  mirroredAccessAvailable: boolean
}

/** Owns admin setup and existing source management, including bookmarked OAuth return URLs. */
export function SearchSourceSetup({
  workspaceId,
  scope: explicitScope,
  canAdmin,
  memberAccessAvailable,
  mirroredAccessAvailable,
}: SearchSourceSetupProps) {
  const scope = explicitScope ?? resourceScopeFromOwner({ workspaceId })
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
  const [setup, setSetup] = useQueryStates(
    {
      [searchSetupParam.key]: searchSetupParam.parser,
      [searchSetupAccessParam.key]: searchSetupAccessParam.parser,
    },
    { history: 'replace' }
  )
  const selectedType = setup.addConnector
  const setSelectedType = (type: typeof selectedType) =>
    setSetup({ addConnector: type, ...(type === null ? { 'source-access': null } : {}) })
  const [managedSource, setManagedSource] = useQueryState(
    managedSourceParam.key,
    managedSourceParam.parser.withOptions({ history: 'replace' })
  )
  const [search, setSearch] = useState('')
  const router = useRouter()
  const prepare = usePrepareSearchSource()
  const selectedMeta = selectedType ? CONNECTOR_META_REGISTRY[selectedType] : undefined
  const redirectPersonalSetup = Boolean(
    scope.kind === 'organization' &&
      canAdmin &&
      selectedMeta &&
      setup['source-access'] !== 'members' &&
      !selectedMeta.mirrorsSourceAcls &&
      selectedType !== 'slack'
  )
  const redirectManagement =
    scope.kind === 'organization' && canAdmin && managedSource !== null && selectedType === null
  const organizationId = scope.kind === 'organization' ? scope.organizationId : undefined
  useEffect(() => {
    if (redirectPersonalSetup && organizationId) {
      router.replace(organizationRoutes(organizationId).integrations)
    }
  }, [redirectPersonalSetup, organizationId, router])
  useEffect(() => {
    if (!redirectManagement || !organizationId || managedSource === null) return
    const routes = organizationRoutes(organizationId)
    if (!managedSource || CONNECTOR_META_REGISTRY[managedSource]) {
      void setManagedSource(null, { history: 'replace', scroll: false })
    } else {
      router.replace(routes.searchSource(managedSource))
    }
  }, [redirectManagement, organizationId, managedSource, router, setManagedSource])
  const open = selectedType !== null || managedSource !== null
  const index = useSearchIndex(scope, {
    enabled: canAdmin && open && !redirectManagement && !redirectPersonalSetup,
  })
  const knowledgeBaseId = index.data?.knowledgeBaseId ?? undefined
  const connectors = useConnectorList(
    canAdmin && managedSource && !redirectManagement ? knowledgeBaseId : undefined
  )

  if (!canAdmin || !open || redirectManagement || redirectPersonalSetup) return null

  const close = () => {
    if (prepare.isPending) return
    if (selectedType !== null) void setSelectedType(null)
    if (managedSource !== null) void setManagedSource(null)
  }
  const failedQuery = index.isError
    ? index
    : managedSource && connectors.isError
      ? connectors
      : null
  const managedConnectors =
    connectors.data?.filter(
      (connector) => connector.id === managedSource || connector.connectorType === managedSource
    ) ?? []
  const managedType =
    managedConnectors[0]?.connectorType ??
    (managedSource && CONNECTOR_META_REGISTRY[managedSource] ? managedSource : undefined)
  const initialMode = (type: string) => {
    if (scope.kind === 'organization')
      return setup['source-access'] === 'members' || type === 'slack'
        ? ('members' as const)
        : ('admin' as const)
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
      const accessMode = initialMode(selectedType)
      const setupMode = scope.kind === 'organization' ? accessMode : 'choose'
      return (
        <AddConnectorModal
          key={`${session.user.id}:${knowledgeBaseId}:${selectedType}:${setupMode}`}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) void setSelectedType(null)
          }}
          knowledgeBaseId={knowledgeBaseId}
          scope={scope}
          isSearchIndex
          initialConnectorType={selectedType}
          initialAccessMode={accessMode}
          lockedAccessMode={scope.kind === 'organization' ? accessMode : undefined}
          setupDraftKey={`${session.user.id}:${resourceScopeKey(scope)}:${knowledgeBaseId}:${selectedType}:${setupMode}`}
          onConnectorTypeChange={(type) =>
            void setSelectedType(type !== null ? searchSetupParam.parser.parse(type) : null)
          }
          onCreated={async (_type, connector) => {
            if (scope.kind !== 'organization') return
            await setSelectedType(null)
            router.push(organizationRoutes(scope.organizationId).searchSource(connector.id))
          }}
        />
      )
    }
    if (managedSource && (connectors.isPending || managedType)) {
      return (
        <SearchSourceStatus
          scope={scope}
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
  const visibleTypes = SEARCH_SOURCE_TYPES.filter(
    ([type, meta]) =>
      (scope.kind !== 'organization' ||
        setup['source-access'] === 'members' ||
        meta.mirrorsSourceAcls ||
        type === 'slack') &&
      (selectedType
        ? type === selectedType
        : `${meta.name} ${meta.description}`.toLowerCase().includes(normalizedSearch))
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
              {index.isPending ? 'Loading source…' : 'This source is no longer available.'}
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
                  const available =
                    scope.kind === 'organization'
                      ? setup['source-access'] === 'members' || type === 'slack'
                        ? members
                        : central
                      : central || members
                  return (
                    <SettingsResourceRow
                      key={type}
                      iconVariant='custom'
                      icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                      title={meta.name}
                      description={
                        !available
                          ? `Not available in this ${scope.kind}`
                          : central
                            ? meta.adminSetupHint
                            : undefined
                      }
                      disabled={!available}
                      trailing={
                        available ? (
                          <Chip
                            variant='primary'
                            disabled={prepare.isPending || index.isPending}
                            onClick={() => {
                              if (knowledgeBaseId)
                                void setSelectedType(searchSetupParam.parser.parse(type))
                              else
                                prepare.mutate(
                                  {
                                    ...resourceScopeFields(scope),
                                    connectorType: type,
                                    accessMode: initialMode(type),
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
