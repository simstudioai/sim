'use client'

import { useState } from 'react'
import { ChipConfirmModal, ChipLink, ChipModalError, Switch, toast } from '@sim/emcn'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  canConnectWithDefaults,
  getConnectorAccessAvailability,
  SEARCH_SOURCE_TYPES,
} from '@/lib/sim-search/connectors'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { organizationSearchStatusLabel } from '@/app/o/[organizationId]/settings/components/integrations/organization-search-status'
import { OrganizationSlackAccountSetup } from '@/app/o/[organizationId]/settings/components/integrations/slack-account-setup'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SearchSourceSetup } from '@/app/workspace/[workspaceId]/search/components/search-source-setup'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useOrganizationSearchOverview } from '@/hooks/queries/kb/connectors'
import { useUpdateSearchIntegration } from '@/hooks/queries/search-integrations'
import { usePermissionConfig } from '@/hooks/use-permission-config'

export function OrganizationIntegrationsSetup() {
  const { organization, viewer, searchAccess } = useOrganizationContext()
  const [search, setSearch] = useSettingsSearch()
  const overview = useOrganizationSearchOverview(organization.id, { enabled: viewer.isAdmin })
  const availability = usePermissionConfig()
  const approval = useUpdateSearchIntegration()
  const [deactivating, setDeactivating] = useState<string | null>(null)
  const providers = new Map(
    overview.data?.providers.map((provider) => [provider.connectorType, provider])
  )
  const query = search.trim().toLowerCase()
  const visible = SEARCH_SOURCE_TYPES.filter(([, meta]) => meta.name.toLowerCase().includes(query))
  const deactivatingName = SEARCH_SOURCE_TYPES.find(([type]) => type === deactivating)?.[1].name
  const changeApproval = (connectorType: string, approved: boolean) => {
    approval.reset()
    if (!approved && (providers.get(connectorType)?.sourceCount ?? 0) > 0) {
      setDeactivating(connectorType)
      return
    }
    approval.mutate(
      { organizationId: organization.id, connectorType, approved },
      { onError: (error) => toast.error(error.message) }
    )
  }
  if (!viewer.isAdmin) return null
  if (!searchAccess.memberScoped && !searchAccess.sourceMirrored)
    return (
      <SettingsEmptyState variant='inline'>
        Search sources are not enabled for this organization.
      </SettingsEmptyState>
    )

  return (
    <SettingsPanel
      search={{ value: search, onChange: setSearch, placeholder: 'Search integrations...' }}
    >
      {availability.integrationAvailabilityError && (
        <SettingsQueryErrorState
          error={availability.integrationAvailabilityError}
          fallback='Could not load connection availability'
          isRetrying={availability.isIntegrationAvailabilityFetching}
          onRetry={() => void availability.refetchIntegrationAvailability()}
          variant='inline'
        />
      )}
      <div className={RESOURCE_LIST_STACK}>
        {overview.isError ? (
          <SettingsQueryErrorState
            error={overview.error}
            fallback='Could not load sources'
            isRetrying={overview.isFetching}
            onRetry={() => void overview.refetch()}
            variant='inline'
          />
        ) : overview.isPending ? (
          <SettingsEmptyState variant='inline'>Loading sources…</SettingsEmptyState>
        ) : visible.length === 0 ? (
          <SettingsEmptyState variant='inline'>No matching integrations</SettingsEmptyState>
        ) : (
          visible.map(([type, meta]) => {
            const provider = providers.get(type)
            const approved = provider?.approved === true
            const sourceCount = provider?.sourceCount ?? 0
            const access = getConnectorAccessAvailability(
              meta,
              availability.integrationAvailability,
              {
                memberAccessAvailable: searchAccess.memberScoped,
                mirroredAccessAvailable: searchAccess.sourceMirrored,
                oauthServiceAvailability: availability.oauthServiceAvailability,
                isIntegrationAvailabilityReady: availability.isIntegrationAvailabilityReady,
              }
            )
            const available = access.admin || access.members
            const hasSources = sourceCount > 0
            const manage = hasSources || canConnectWithDefaults(meta)
            let description = provider ? organizationSearchStatusLabel(provider) : undefined
            if (!hasSources && availability.isIntegrationAvailabilityReady && !available)
              description = 'Unavailable in this deployment'
            return (
              <SettingsResourceRow
                key={type}
                iconVariant='custom'
                icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                title={meta.name}
                description={description}
                trailing={
                  <div className='flex items-center gap-5'>
                    {(hasSources || (approved && available)) && (
                      <ChipLink
                        href={organizationRoutes(organization.id).searchProvider(type)}
                        variant={manage ? undefined : 'primary'}
                        aria-label={`${manage ? 'Manage' : 'Set up'} ${meta.name}`}
                      >
                        {manage ? 'Manage' : 'Set up'}
                      </ChipLink>
                    )}
                    <Switch
                      aria-label={`Allow ${meta.name} in Sim Search`}
                      checked={approved}
                      disabled={approval.isPending || (!approved && !available)}
                      onCheckedChange={(checked) => changeApproval(type, checked)}
                    />
                  </div>
                }
              />
            )
          })
        )}
      </div>
      <ChipConfirmModal
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open && !approval.isPending) setDeactivating(null)
        }}
        title={`Deactivate ${deactivatingName ?? 'integration'}?`}
        text='Its content will be unavailable in Search, Assistant, and MCP. Sources and connected accounts are preserved.'
        confirm={{
          label: 'Deactivate',
          variant: 'destructive',
          pending: approval.isPending,
          onClick: () => {
            if (!deactivating) return
            approval.mutate(
              { organizationId: organization.id, connectorType: deactivating, approved: false },
              { onSuccess: () => setDeactivating(null) }
            )
          },
        }}
      >
        <ChipModalError>{approval.error?.message}</ChipModalError>
      </ChipConfirmModal>
      <SearchSourceSetup
        scope={{ kind: 'organization', organizationId: organization.id }}
        canAdmin={viewer.isAdmin}
        memberAccessAvailable={searchAccess.memberScoped}
        mirroredAccessAvailable={searchAccess.sourceMirrored}
      />
      <OrganizationSlackAccountSetup />
    </SettingsPanel>
  )
}
