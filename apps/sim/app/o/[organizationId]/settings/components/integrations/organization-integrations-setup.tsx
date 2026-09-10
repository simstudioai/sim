'use client'

import { toast } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getConnectorAccessAvailability, SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { AddOrganizationSourceModal } from '@/app/o/[organizationId]/settings/components/integrations/add-organization-source-modal'
import { organizationSearchStatusLabel } from '@/app/o/[organizationId]/settings/components/integrations/organization-search-status'
import { OrganizationSlackAccountSetup } from '@/app/o/[organizationId]/settings/components/integrations/slack-account-setup'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SearchSourceSetup } from '@/app/workspace/[workspaceId]/search/components/search-source-setup'
import {
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
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useOrganizationSearchOverview } from '@/hooks/queries/kb/connectors'
import { useUpdateSearchIntegration } from '@/hooks/queries/search-integrations'
import { usePermissionConfig } from '@/hooks/use-permission-config'

export function OrganizationIntegrationsSetup() {
  const { organization, viewer, searchAccess } = useOrganizationContext()
  const [search, setSearch] = useSettingsSearch()
  const [setup, setSetup] = useQueryStates(
    {
      [searchSetupParam.key]: searchSetupParam.parser,
      [searchSetupAccessParam.key]: searchSetupAccessParam.parser,
    },
    { history: 'replace' }
  )
  const overview = useOrganizationSearchOverview(organization.id, { enabled: viewer.isAdmin })
  const availability = usePermissionConfig()
  const approval = useUpdateSearchIntegration()
  const providers = new Map(
    overview.data?.providers.map((provider) => [provider.connectorType, provider])
  )
  const sources = SEARCH_SOURCE_TYPES.map(([type, meta]) => ({
    type,
    meta,
    access: getConnectorAccessAvailability(meta, availability.integrationAvailability, {
      memberAccessAvailable: searchAccess.memberScoped,
      mirroredAccessAvailable: searchAccess.sourceMirrored,
      oauthServiceAvailability: availability.oauthServiceAvailability,
      isIntegrationAvailabilityReady: availability.isIntegrationAvailabilityReady,
    }),
  }))
  const query = search.trim().toLowerCase()
  const visible = sources.flatMap((source) => {
    const provider = providers.get(source.type)
    return provider &&
      (provider.approved || provider.sourceCount > 0) &&
      source.meta.name.toLowerCase().includes(query)
      ? [{ ...source, provider }]
      : []
  })
  const ready = Boolean(
    !overview.isPending &&
      !overview.isError &&
      availability.isIntegrationAvailabilityReady &&
      !availability.integrationAvailabilityError
  )
  const closePicker = () => {
    if (!approval.isPending) void setSetup({ addConnector: null, 'source-access': null })
  }
  const selectSource = (type: string, accessMode: 'admin' | 'members') => {
    const selectedType = searchSetupParam.parser.parse(type)
    if (!selectedType || !ready || approval.isPending) return
    const startSetup = () =>
      void setSetup({
        addConnector: selectedType,
        'source-access': accessMode === 'members' ? 'members' : null,
      })
    if (providers.get(type)?.approved) {
      startSetup()
      return
    }
    approval.mutate(
      { organizationId: organization.id, connectorType: type, approved: true },
      { onSuccess: startSetup, onError: (error) => toast.error(error.message) }
    )
  }
  if (!viewer.isAdmin) return null
  if (!searchAccess.memberScoped && !searchAccess.sourceMirrored)
    return (
      <SettingsEmptyState variant='inline'>
        Search sources are not enabled for this organization.
      </SettingsEmptyState>
    )

  const feedback = overview.isError ? (
    <SettingsQueryErrorState
      error={overview.error}
      fallback='Could not load sources'
      isRetrying={overview.isFetching}
      onRetry={() => void overview.refetch()}
      variant='inline'
    />
  ) : availability.integrationAvailabilityError ? (
    <SettingsQueryErrorState
      error={availability.integrationAvailabilityError}
      fallback='Could not load connection availability'
      isRetrying={availability.isIntegrationAvailabilityFetching}
      onRetry={() => void availability.refetchIntegrationAvailability()}
      variant='inline'
    />
  ) : null

  return (
    <>
      <SettingsPanel
        actions={[
          {
            text: 'Add source',
            icon: Plus,
            variant: 'primary',
            disabled: !ready || approval.isPending,
            onSelect: () => void setSetup({ addConnector: '', 'source-access': null }),
          },
        ]}
        search={{ value: search, onChange: setSearch, placeholder: 'Search sources...' }}
      >
        {setup.addConnector !== '' && feedback}
        <div className={RESOURCE_LIST_STACK}>
          {overview.isError ? null : overview.isPending ? (
            <SettingsEmptyState variant='inline'>Loading sources…</SettingsEmptyState>
          ) : visible.length === 0 ? (
            <SettingsEmptyState variant='inline'>
              {query ? 'No matching sources' : 'No sources yet. Add a source to get started.'}
            </SettingsEmptyState>
          ) : (
            visible.map(({ type, meta, access, provider }) => {
              const available = access.admin || access.members
              const status =
                provider.approved && ready && !available
                  ? 'Unavailable in this deployment'
                  : organizationSearchStatusLabel(provider)
              return (
                <SettingsResourceRow
                  key={type}
                  iconVariant='custom'
                  icon={<IntegrationTile blockType={type} icon={meta.icon} />}
                  title={meta.name}
                  description={[
                    status,
                    provider.sourceCount > 0
                      ? `${provider.sourceCount} ${provider.sourceCount === 1 ? 'connection' : 'connections'}`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  href={organizationRoutes(organization.id).searchProvider(type)}
                  clickLabel={`Manage ${meta.name}`}
                  navigable
                />
              )
            })
          )}
        </div>
      </SettingsPanel>
      {setup.addConnector === '' ? (
        <AddOrganizationSourceModal
          sources={sources}
          pending={approval.isPending}
          ready={ready}
          feedback={feedback}
          onClose={closePicker}
          onSelect={selectSource}
        />
      ) : (
        <SearchSourceSetup
          scope={{ kind: 'organization', organizationId: organization.id }}
          canAdmin={viewer.isAdmin}
          memberAccessAvailable={searchAccess.memberScoped}
          mirroredAccessAvailable={searchAccess.sourceMirrored}
        />
      )}
      <OrganizationSlackAccountSetup />
    </>
  )
}
