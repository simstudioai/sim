'use client'

import { useState } from 'react'
import {
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import type { OrganizationSearchProviderSummary } from '@/lib/api/contracts/knowledge/connectors'
import { getConnectorAccessAvailability, SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useUpdateSearchIntegration } from '@/hooks/queries/search-integrations'
import { usePermissionConfig } from '@/hooks/use-permission-config'

interface OrganizationIntegrationCatalogProps {
  organizationId: string
  providers: OrganizationSearchProviderSummary[]
  memberAccessAvailable: boolean
  mirroredAccessAvailable: boolean
  onClose: () => void
  onAdded: (connectorType: string) => void
}

export function OrganizationIntegrationCatalog({
  organizationId,
  providers,
  memberAccessAvailable,
  mirroredAccessAvailable,
  onClose,
  onAdded,
}: OrganizationIntegrationCatalogProps) {
  const [search, setSearch] = useState('')
  const availability = usePermissionConfig()
  const add = useUpdateSearchIntegration()
  const existing = new Set(providers.map((provider) => provider.connectorType))
  const visible = SEARCH_SOURCE_TYPES.filter(
    ([type, meta]) =>
      !existing.has(type) && meta.name.toLowerCase().includes(search.trim().toLowerCase())
  )
  return (
    <ChipModal
      open
      srTitle='Add integration'
      dismissDisabled={add.isPending}
      onOpenChange={(open) => {
        if (!open && !add.isPending) onClose()
      }}
    >
      <ChipModalHeader onClose={onClose} closeDisabled={add.isPending}>
        Add integration
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title='Integration'>
          <ChipInput
            icon={Search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Search integrations...'
            autoComplete='off'
          />
        </ChipModalField>
        <ChipModalField type='custom' title='Available integrations'>
          {availability.integrationAvailabilityError ? (
            <SettingsQueryErrorState
              error={availability.integrationAvailabilityError}
              fallback='Could not load connection availability'
              isRetrying={availability.isIntegrationAvailabilityFetching}
              onRetry={() => void availability.refetchIntegrationAvailability()}
              variant='inline'
            />
          ) : !availability.isIntegrationAvailabilityReady ? (
            <SettingsEmptyState variant='inline'>Loading integrations…</SettingsEmptyState>
          ) : visible.length === 0 ? (
            <SettingsEmptyState variant='inline'>
              {search ? 'No matching integrations' : 'All integrations have been added.'}
            </SettingsEmptyState>
          ) : (
            <div className={RESOURCE_LIST_STACK}>
              {visible.map(([type, meta]) => {
                const access = getConnectorAccessAvailability(
                  meta,
                  availability.integrationAvailability,
                  {
                    memberAccessAvailable,
                    mirroredAccessAvailable,
                    oauthServiceAvailability: availability.oauthServiceAvailability,
                    isIntegrationAvailabilityReady: availability.isIntegrationAvailabilityReady,
                  }
                )
                const available = access.admin || access.members
                return (
                  <SettingsResourceRow
                    key={type}
                    iconVariant='custom'
                    icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                    title={meta.name}
                    description={!available ? 'Unavailable in this deployment' : undefined}
                    disabled={add.isPending || !available}
                    onClick={() =>
                      add.mutate(
                        { organizationId, connectorType: type, approved: true },
                        { onSuccess: () => onAdded(type) }
                      )
                    }
                    clickLabel={`Add ${meta.name}`}
                  />
                )
              })}
            </div>
          )}
        </ChipModalField>
        <ChipModalError>{add.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter onCancel={onClose} cancelDisabled={add.isPending} defaultAction='dismiss' />
    </ChipModal>
  )
}
