'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Chip,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useQueryState, useQueryStates } from 'nuqs'
import { useSession } from '@/lib/auth/auth-client'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import {
  type ResourceScope,
  resourceScopeFields,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getSearchConnectionLabels } from '@/lib/sim-search/connection-labels'
import { getConnectorAccessAvailability, SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import {
  managedSourceParam,
  searchSetupAccessParam,
  searchSetupParam,
} from '@/lib/sim-search/search-params'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { usePrepareSearchSource, useSearchIndex } from '@/hooks/queries/kb/connectors'
import { useUpdateSearchIntegration } from '@/hooks/queries/search-integrations'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const AddConnectorModal = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal').then(
      (module) => module.AddConnectorModal
    ),
  { ssr: false }
)
interface SearchSourceSetupProps {
  scope: Extract<ResourceScope, { kind: 'organization' }>
  canAdmin: boolean
  memberAccessAvailable: boolean
  mirroredAccessAvailable: boolean
}

/** Owns admin setup and existing source management, including bookmarked OAuth return URLs. */
export function SearchSourceSetup({
  scope,
  canAdmin,
  memberAccessAvailable,
  mirroredAccessAvailable,
}: SearchSourceSetupProps) {
  const { data: session } = useSession()
  const liveSearch = useDeploymentShape().features.liveEnterpriseSearch
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
  const attemptedPreparation = useRef<string | null>(null)
  const router = useRouter()
  const prepare = usePrepareSearchSource()
  const updateSearchIntegration = useUpdateSearchIntegration()
  const { mutate: prepareSource, isPending: preparing } = prepare
  const selectedMeta = selectedType ? CONNECTOR_META_REGISTRY[selectedType] : undefined
  const redirectPersonalSetup = Boolean(
    canAdmin &&
      selectedMeta &&
      setup['source-access'] !== 'members' &&
      !selectedMeta.mirrorsSourceAcls &&
      selectedType !== 'slack' &&
      selectedType !== 'github'
  )
  const redirectManagement = canAdmin && managedSource !== null && selectedType === null
  const { organizationId } = scope
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

  const close = () => {
    if (prepare.isPending) return
    if (selectedType !== null) void setSelectedType(null)
    if (managedSource !== null) void setManagedSource(null)
  }
  const failedQuery = index.isError ? index : null
  const initialMode = (type: string) =>
    type === 'github' || (!liveSearch && (setup['source-access'] === 'members' || type === 'slack'))
      ? ('members' as const)
      : ('admin' as const)

  const selectedAccessMode = selectedType ? initialMode(selectedType) : undefined
  const selectedAvailability = selectedMeta
    ? getConnectorAccessAvailability(selectedMeta, integrationAvailability, {
        memberAccessAvailable,
        mirroredAccessAvailable,
        oauthServiceAvailability,
        isIntegrationAvailabilityReady,
      })
    : undefined
  const selectedAvailable = selectedAvailability
    ? selectedAccessMode === 'admin'
      ? selectedAvailability.admin
      : selectedAvailability.members
    : false
  const canPrepareSelected =
    canAdmin &&
    open &&
    !redirectManagement &&
    !redirectPersonalSetup &&
    !index.isPending &&
    !index.isError &&
    !integrationAvailabilityError &&
    selectedAvailable
  const userId = session?.user?.id

  /** A known provider only needs the canonical index prepared, not another selection step. */
  useEffect(() => {
    if (!selectedType || knowledgeBaseId) {
      attemptedPreparation.current = null
      return
    }
    if (!canPrepareSelected || !selectedAccessMode || !userId || preparing) return
    const requestKey = `${userId}:${resourceScopeKey(scope)}:${selectedType}:${selectedAccessMode}`
    if (attemptedPreparation.current === requestKey) return
    attemptedPreparation.current = requestKey
    prepareSource({
      ...resourceScopeFields(scope),
      connectorType: selectedType,
      accessMode: selectedAccessMode,
    })
  }, [
    selectedType,
    knowledgeBaseId,
    canPrepareSelected,
    selectedAccessMode,
    userId,
    preparing,
    scope,
    prepareSource,
  ])

  if (!canAdmin || !open || redirectManagement || redirectPersonalSetup) return null

  if (
    !failedQuery &&
    knowledgeBaseId &&
    (isIntegrationAvailabilityReady || integrationAvailability.size > 0)
  ) {
    if (selectedType && session?.user?.id) {
      const accessMode = initialMode(selectedType)
      const setupMode =
        liveSearch || !(selectedMeta?.mirrorsSourceAcls && selectedMeta.auth.mode === 'oauth')
          ? accessMode
          : 'choose'
      return (
        <AddConnectorModal
          key={`${session.user.id}:${knowledgeBaseId}:${selectedType}:${setupMode}:${accessMode}`}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) void setSelectedType(null)
          }}
          knowledgeBaseId={knowledgeBaseId}
          scope={scope}
          isSearchIndex
          initialConnectorType={selectedType}
          initialAccessMode={accessMode}
          lockConnectorType
          lockedAccessMode={setupMode === 'choose' ? undefined : setupMode}
          setupDraftKey={`${session.user.id}:${resourceScopeKey(scope)}:${knowledgeBaseId}:${selectedType}:${setupMode}`}
          onConnectorTypeChange={(type) =>
            void setSelectedType(type !== null ? searchSetupParam.parser.parse(type) : null)
          }
          onCreated={async (type, connector) => {
            await setSelectedType(null)
            const destination = organizationRoutes(scope.organizationId).searchSource(connector.id)
            if (liveSearch && accessMode === 'admin' && type !== 'gitlab') {
              updateSearchIntegration.mutate(
                {
                  organizationId: scope.organizationId,
                  connectorType: type,
                  approved: true,
                  policy: {
                    ...defaultLiveSearchPolicy(type),
                    accessMode: 'service_account',
                    sourceId: connector.id,
                  },
                },
                {
                  onSuccess: () => router.push(destination),
                  onError: (error) => {
                    toast.error(`Source added but search is not ready: ${error.message}`)
                    router.push(destination)
                  },
                }
              )
            } else {
              router.push(destination)
            }
          }}
        />
      )
    }
  }

  if (
    selectedType &&
    !failedQuery &&
    !integrationAvailabilityError &&
    !prepare.error &&
    (!isIntegrationAvailabilityReady || selectedAvailable)
  ) {
    return null
  }

  const normalizedSearch = search.trim().toLowerCase()
  const visibleTypes = SEARCH_SOURCE_TYPES.filter(
    ([type, meta]) =>
      (setup['source-access'] === 'members' ||
        meta.mirrorsSourceAcls ||
        type === 'slack' ||
        type === 'github') &&
      `${meta.name} ${meta.description}`.toLowerCase().includes(normalizedSearch)
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
        {selectedType
          ? getSearchConnectionLabels(selectedType, selectedAccessMode).title
          : 'Add source'}
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
        ) : selectedType ? (
          <ChipModalField type='custom' title='Source setup'>
            {!selectedAvailable ? (
              <SettingsEmptyState variant='inline'>
                Not available in this {scope.kind}
              </SettingsEmptyState>
            ) : prepare.error ? (
              <SettingsQueryErrorState
                error={prepare.error}
                fallback='Could not prepare source setup'
                isRetrying={preparing}
                onRetry={() => {
                  if (!canPrepareSelected || !selectedAccessMode || !userId || preparing) return
                  prepareSource({
                    ...resourceScopeFields(scope),
                    connectorType: selectedType,
                    accessMode: selectedAccessMode,
                  })
                }}
                variant='inline'
              />
            ) : (
              <SettingsEmptyState variant='inline'>Loading source setup…</SettingsEmptyState>
            )}
          </ChipModalField>
        ) : (
          <>
            <ChipModalField type='custom' title='Find a source' submitOnEnter={false}>
              <ChipInput
                icon={Search}
                placeholder='Find a source…'
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </ChipModalField>
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
                    type === 'github' ||
                    (!liveSearch && (setup['source-access'] === 'members' || type === 'slack'))
                      ? members
                      : central
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
                            Set up
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
