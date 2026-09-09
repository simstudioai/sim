'use client'

import { useState } from 'react'
import { Plus } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { OrganizationIntegrationCatalog } from '@/app/o/[organizationId]/settings/components/integrations/organization-integration-catalog'
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
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { useOrganizationSearchOverview } from '@/hooks/queries/kb/connectors'

export function OrganizationIntegrationsSetup() {
  const { organization, viewer, searchAccess } = useOrganizationContext()
  const router = useRouter()
  const [search, setSearch] = useSettingsSearch()
  const [catalogOpen, setCatalogOpen] = useState(false)
  const overview = useOrganizationSearchOverview(organization.id, { enabled: viewer.isAdmin })
  const providers = overview.data?.providers ?? []
  const query = search.trim().toLowerCase()
  const visible = providers.filter((provider) =>
    CONNECTOR_META_REGISTRY[provider.connectorType]?.name.toLowerCase().includes(query)
  )
  if (!viewer.isAdmin) return null
  if (!searchAccess.memberScoped && !searchAccess.sourceMirrored)
    return (
      <SettingsEmptyState variant='inline'>
        Search sources are not enabled for this organization.
      </SettingsEmptyState>
    )

  return (
    <SettingsPanel
      search={{ value: search, onChange: setSearch, placeholder: 'Search sources...' }}
      actions={[
        {
          text: 'Add integration',
          icon: Plus,
          variant: 'primary',
          disabled: overview.isPending || overview.isError,
          onSelect: () => setCatalogOpen(true),
        },
      ]}
    >
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
          <SettingsEmptyState variant='inline'>
            {query ? 'No matching sources' : 'Add an integration to get started.'}
          </SettingsEmptyState>
        ) : (
          visible.map((provider) => {
            const meta = CONNECTOR_META_REGISTRY[provider.connectorType]
            return (
              <SettingsResourceRow
                key={provider.connectorType}
                iconVariant='custom'
                icon={<IntegrationTile blockType={provider.connectorType} icon={meta.icon} />}
                title={meta.name}
                description={organizationSearchStatusLabel(provider)}
                href={organizationRoutes(organization.id).searchProvider(provider.connectorType)}
                clickLabel={`Manage ${meta.name}`}
                navigable
              />
            )
          })
        )}
      </div>
      {catalogOpen && (
        <OrganizationIntegrationCatalog
          organizationId={organization.id}
          providers={providers}
          memberAccessAvailable={searchAccess.memberScoped}
          mirroredAccessAvailable={searchAccess.sourceMirrored}
          onClose={() => setCatalogOpen(false)}
          onAdded={(type) => router.push(organizationRoutes(organization.id).searchProvider(type))}
        />
      )}
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
