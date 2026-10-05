'use client'

import { useState } from 'react'
import { ArrowLeft, Plus } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryState, useQueryStates } from 'nuqs'
import type { SettingsAction } from '@/components/settings/settings-header'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getSearchConnectionLabels } from '@/lib/sim-search/connection-labels'
import { getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
import { searchSetupAccessParam, searchSetupParam } from '@/lib/sim-search/search-params'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { connectedAccountsParam } from '@/app/o/[organizationId]/settings/components/integrations/search-params'
import { SearchSourcePagination } from '@/app/o/[organizationId]/settings/components/integrations/search-source-pagination'
import { SearchSourceSetup } from '@/app/o/[organizationId]/settings/components/integrations/search-source-setup'
import { OrganizationSlackAccountRemoval } from '@/app/o/[organizationId]/settings/components/integrations/slack-account-removal'
import { OrganizationSlackAccountSetup } from '@/app/o/[organizationId]/settings/components/integrations/slack-account-setup'
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
import { useSearchSources } from '@/hooks/queries/kb/connectors'
import { useOrganizationAccounts } from '@/hooks/queries/organization-accounts'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { useDebounce } from '@/hooks/use-debounce'
import { usePermissionConfig } from '@/hooks/use-permission-config'

interface OrganizationProviderDetailProps {
  connectorType: string
}

export function OrganizationProviderDetail({ connectorType }: OrganizationProviderDetailProps) {
  const { organization, viewer, searchAccess } = useOrganizationContext()
  const router = useRouter()
  const meta = CONNECTOR_META_REGISTRY[connectorType]
  const [search, setSearch] = useSettingsSearch()
  const sourceSearch = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const [removingSlackAccounts, setRemovingSlackAccounts] = useState(false)
  const scope = { kind: 'organization', organizationId: organization.id } as const
  const overview = useSearchIntegrations(organization.id)
  const sources = useSearchSources(scope, {
    connectorType,
    search: sourceSearch,
    enabled: viewer.isAdmin,
  })
  const availability = usePermissionConfig()
  const accounts = useOrganizationAccounts(
    viewer.isAdmin && connectorType === 'slack' ? organization.id : undefined
  )
  const [, setSetup] = useQueryStates(
    {
      [searchSetupParam.key]: searchSetupParam.parser,
      [searchSetupAccessParam.key]: searchSetupAccessParam.parser,
    },
    { history: 'replace' }
  )
  const [, setConnectedAccounts] = useQueryState(
    connectedAccountsParam.key,
    connectedAccountsParam.parser
  )
  const provider = overview.data?.find((item) => item.connectorType === connectorType)
  const approved = provider?.approved === true
  const back = {
    text: 'Sources',
    icon: ArrowLeft,
    onSelect: () =>
      router.push(organizationRoutes(organization.id).settingsSection('integrations')),
  }
  if (!viewer.isAdmin || !meta) return null
  const labels = getSearchConnectionLabels(connectorType)
  const searchField = {
    value: search,
    onChange: setSearch,
    placeholder: labels.searchPlaceholder,
  }
  const access = getConnectorAccessAvailability(meta, availability.integrationAvailability, {
    memberAccessAvailable: searchAccess.memberScoped,
    mirroredAccessAvailable: searchAccess.sourceMirrored,
    oauthServiceAvailability: availability.oauthServiceAvailability,
    isIntegrationAvailabilityReady: availability.isIntegrationAvailabilityReady,
  })
  const unavailable =
    availability.isIntegrationAvailabilityReady && !access.admin && !access.members
  const panel = {
    back,
    title: meta.name,
    description:
      approved && unavailable
        ? 'Unavailable in this deployment'
        : provider
          ? connectorType === 'gitlab'
            ? 'Projects and permissions'
            : connectorType === 'github'
              ? 'GitHub App repositories'
              : 'Service account connections'
          : undefined,
    docsLink: meta.searchDocsUrl,
    search: searchField,
  }
  const option = accounts.data?.credentialGroup?.options.find(
    (item) => item.provider === 'slack' && item.status === 'active'
  )
  const group = accounts.data?.credentialGroup
  const removalActions: SettingsAction[] =
    connectorType === 'slack' &&
    !accounts.isError &&
    group?.options.some((item) => item.provider === 'slack')
      ? [
          {
            id: 'delete',
            text: 'Remove app setup',
            disabled: accounts.isFetching,
            onSelect: () => setRemovingSlackAccounts(true),
          },
        ]
      : []
  const needsSlackSetup =
    connectorType === 'slack' &&
    (option?.provider !== 'slack' || option.configurationStatus !== 'ready')
  const pending =
    overview.isPending || overview.isError || !availability.isIntegrationAvailabilityReady
  const startSource = () =>
    void setSetup({
      addConnector: searchSetupParam.parser.parse(connectorType),
      'source-access': access.admin ? null : 'members',
    })
  const actions: SettingsAction[] = approved
    ? [
        ...(needsSlackSetup || access.admin || (connectorType === 'github' && access.members)
          ? [
              {
                text: needsSlackSetup
                  ? 'Set up Slack app'
                  : connectorType === 'github'
                    ? 'Add repository'
                    : connectorType !== 'gitlab'
                      ? 'Add service account'
                      : getSearchConnectionLabels(connectorType, access.admin ? 'admin' : 'members')
                          .add,
                icon: Plus,
                variant: 'primary' as const,
                disabled:
                  pending ||
                  (connectorType === 'slack' && (accounts.isPending || accounts.isError)),
                onSelect: needsSlackSetup ? () => void setConnectedAccounts('slack') : startSource,
              },
            ]
          : []),
      ]
    : [
        {
          text: 'View sources',
          variant: 'primary',
          disabled: pending || (!access.admin && !access.members),
          tooltip: unavailable ? 'This integration is unavailable in this deployment.' : undefined,
          onSelect: () =>
            router.push(organizationRoutes(organization.id).settingsSection('integrations')),
        },
      ]
  actions.push(...removalActions)
  if (overview.isError)
    return (
      <SettingsPanel {...panel}>
        <SettingsQueryErrorState
          error={overview.error}
          fallback='Could not load integration'
          isRetrying={overview.isFetching}
          onRetry={() => void overview.refetch()}
          variant='inline'
        />
      </SettingsPanel>
    )
  if (overview.isPending)
    return (
      <SettingsPanel {...panel}>
        <SettingsEmptyState variant='inline'>Loading integration</SettingsEmptyState>
      </SettingsPanel>
    )

  const renderSources = () => (
    <SettingsPanel {...panel} actions={actions}>
      {availability.integrationAvailabilityError && (
        <SettingsQueryErrorState
          error={availability.integrationAvailabilityError}
          fallback='Could not load connection availability'
          isRetrying={availability.isIntegrationAvailabilityFetching}
          onRetry={() => void availability.refetchIntegrationAvailability()}
          variant='inline'
        />
      )}
      {connectorType === 'slack' && accounts.isError && (
        <SettingsQueryErrorState
          error={accounts.error}
          fallback='Could not load account connections'
          isRetrying={accounts.isFetching}
          onRetry={() => void accounts.refetch()}
          variant='inline'
        />
      )}
      {sources.isError && !sources.isFetchNextPageError ? (
        <SettingsQueryErrorState
          error={sources.error}
          fallback='Could not load connections'
          isRetrying={sources.isFetching}
          onRetry={() => void sources.refetch()}
          variant='inline'
        />
      ) : sources.isPending ? (
        <SettingsEmptyState variant='inline'>Loading connections</SettingsEmptyState>
      ) : (
        <div className={RESOURCE_LIST_STACK}>
          {sources.data
            ?.filter(
              (source) =>
                source.accessMode === 'admin' ||
                (connectorType === 'github' && source.isGitHubInstallation)
            )
            .map((source) => (
              <SettingsResourceRow
                key={source.connectorId}
                title={source.sourceDescription || meta.name}
                description={!approved ? 'Unavailable' : !source.enabled ? 'Paused' : undefined}
                href={organizationRoutes(organization.id).searchSource(source.connectorId)}
                clickLabel={`Open ${source.sourceDescription || meta.name}`}
                navigable
              />
            ))}
          {!sources.data?.some(
            (source) =>
              source.accessMode === 'admin' ||
              (connectorType === 'github' && source.isGitHubInstallation)
          ) &&
            !sources.hasNextPage && (
              <SettingsEmptyState variant='inline'>
                {sourceSearch
                  ? 'No matching connections'
                  : unavailable
                    ? `${meta.name} must be configured for this deployment before you can add a connection.`
                    : !approved
                      ? 'Activate this integration to add a connection.'
                      : labels.empty}
              </SettingsEmptyState>
            )}
          <SearchSourcePagination {...sources} />
        </div>
      )}
    </SettingsPanel>
  )
  return (
    <>
      {renderSources()}
      <SearchSourceSetup
        scope={scope}
        canAdmin={viewer.isAdmin}
        memberAccessAvailable={searchAccess.memberScoped}
        mirroredAccessAvailable={searchAccess.sourceMirrored}
      />
      <OrganizationSlackAccountSetup />
      {removingSlackAccounts && group && (
        <OrganizationSlackAccountRemoval
          organizationId={organization.id}
          group={group}
          onClose={() => setRemovingSlackAccounts(false)}
          onRemoved={() => setRemovingSlackAccounts(false)}
        />
      )}
    </>
  )
}
