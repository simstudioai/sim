'use client'

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
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { getSearchConnectionLabels } from '@/lib/sim-search/connection-labels'
import { searchSetupParam } from '@/lib/sim-search/params'
import {
  type SearchSourceSetupOptions,
  useSearchSourceSetup,
} from '@/app/o/[organizationId]/settings/components/integrations/use-search-source-setup'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'

const AddConnectorModal = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal').then(
      (module) => module.AddConnectorModal
    ),
  { ssr: false }
)

/** Owns admin setup and existing source management, including bookmarked OAuth return URLs. */
export function SearchSourceSetup(props: SearchSourceSetupOptions) {
  const { scope } = props
  const {
    availabilityOf,
    canShowForm,
    close,
    failedQuery,
    handleCreated,
    hidden,
    index,
    initialMode,
    integrationAvailabilityError,
    isIntegrationAvailabilityFetching,
    isIntegrationAvailabilityLoading,
    knowledgeBaseId,
    managedSource,
    prepare,
    preparing,
    refetchIntegrationAvailability,
    retryPrepare,
    search,
    selectedAccessMode,
    selectedAvailable,
    selectedType,
    setSearch,
    setSelectedType,
    startSetup,
    userId,
    visibleTypes,
    waitingForPreparation,
  } = useSearchSourceSetup(props)

  if (hidden) return null

  if (canShowForm && knowledgeBaseId && selectedType && userId) {
    const accessMode = initialMode(selectedType)
    const setupMode = accessMode
    return (
      <AddConnectorModal
        key={`${userId}:${knowledgeBaseId}:${selectedType}:${setupMode}:${accessMode}`}
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
        lockedAccessMode={setupMode}
        setupDraftKey={`${userId}:${resourceScopeKey(scope)}:${knowledgeBaseId}:${selectedType}:${setupMode}`}
        onConnectorTypeChange={(type) =>
          void setSelectedType(type !== null ? searchSetupParam.parser.parse(type) : null)
        }
        onCreated={(type, connector) => void handleCreated(type, connector, accessMode)}
      />
    )
  }

  if (waitingForPreparation) return null

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
            <SettingsEmptyState variant='inline'>Loading sources</SettingsEmptyState>
          </ChipModalField>
        ) : managedSource ? (
          <ChipModalField type='custom' title='Source'>
            <SettingsEmptyState variant='inline'>
              {index.isPending ? 'Loading source' : 'This source is no longer available.'}
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
                onRetry={retryPrepare}
                variant='inline'
              />
            ) : (
              <SettingsEmptyState variant='inline'>Loading source setup</SettingsEmptyState>
            )}
          </ChipModalField>
        ) : (
          <>
            <ChipModalField type='custom' title='Find a source' submitOnEnter={false}>
              <ChipInput
                icon={Search}
                placeholder='Find a source'
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </ChipModalField>
            <ChipModalField type='custom' title='Sources'>
              <div className={RESOURCE_LIST_STACK}>
                {visibleTypes.map(([type, meta]) => {
                  const { admin: central, members } = availabilityOf(meta)
                  const available = initialMode(type) === 'members' ? members : central
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
                            onClick={() => startSetup(type)}
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
