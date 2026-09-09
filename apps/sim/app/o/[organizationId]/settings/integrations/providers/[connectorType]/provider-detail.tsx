'use client'

import { useState } from 'react'
import { ChipConfirmModal, ChipModalError, ChipSwitch } from '@sim/emcn'
import { ArrowLeft, Plus } from '@sim/emcn/icons'
import { format } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useQueryState, useQueryStates } from 'nuqs'
import type { SettingsAction } from '@/components/settings/settings-header'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { findCredentialGroupProviderFromProviderId } from '@/lib/credential-groups/providers'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getServiceConfigByProviderId, getServiceConfigByServiceId } from '@/lib/oauth'
import { canConnectPersonally, getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { organizationSearchStatusLabel } from '@/app/o/[organizationId]/settings/components/integrations/organization-search-status'
import {
  connectedAccountsParam,
  organizationProviderTabParam,
} from '@/app/o/[organizationId]/settings/components/integrations/search-params'
import { OrganizationSlackAccountSetup } from '@/app/o/[organizationId]/settings/components/integrations/slack-account-setup'
import { SearchSourcePagination } from '@/app/workspace/[workspaceId]/search/components/search-source-pagination'
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
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { OrganizationAccountPeople } from '@/ee/credential-groups/components/organization-account-people'
import { useOrganizationSearchOverview, useSearchSources } from '@/hooks/queries/kb/connectors'
import { useOrganizationAccounts } from '@/hooks/queries/organization-accounts'
import { useUpdateSearchIntegration } from '@/hooks/queries/search-integrations'
import { useDebounce } from '@/hooks/use-debounce'
import { useOrganizationAccountPeopleSearch } from '@/hooks/use-organization-account-people-search'
import { usePermissionConfig } from '@/hooks/use-permission-config'

interface OrganizationProviderDetailProps {
  connectorType: string
}

export function OrganizationProviderDetail({ connectorType }: OrganizationProviderDetailProps) {
  const { organization, viewer, searchAccess } = useOrganizationContext()
  const router = useRouter()
  const [view, setView] = useQueryState(
    organizationProviderTabParam.key,
    organizationProviderTabParam.parser
  )
  const [search, setSearch] = useSettingsSearch()
  const [peopleSearch, setPeopleSearch] = useOrganizationAccountPeopleSearch()
  const sourceSearch = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const [deactivating, setDeactivating] = useState(false)
  const scope = { kind: 'organization', organizationId: organization.id } as const
  const meta = CONNECTOR_META_REGISTRY[connectorType]
  const personal = Boolean(meta && canConnectPersonally(meta) && searchAccess.memberScoped)
  const showAccounts = view === 'accounts' && personal
  const overview = useOrganizationSearchOverview(organization.id, { enabled: viewer.isAdmin })
  const sources = useSearchSources(scope, {
    connectorType,
    search: sourceSearch,
    enabled: viewer.isAdmin && !showAccounts,
  })
  const availability = usePermissionConfig()
  const approval = useUpdateSearchIntegration()
  const accounts = useOrganizationAccounts(
    viewer.isAdmin && personal && (showAccounts || connectorType === 'slack')
      ? organization.id
      : undefined
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
  const provider = overview.data?.providers.find((item) => item.connectorType === connectorType)
  const approved = provider?.approved === true
  const back = {
    text: 'Sources',
    icon: ArrowLeft,
    onSelect: () =>
      router.push(organizationRoutes(organization.id).settingsSection('integrations')),
  }
  if (!viewer.isAdmin || !meta) return null
  const searchField = showAccounts
    ? { value: peopleSearch, onChange: setPeopleSearch, placeholder: 'Search people...' }
    : { value: search, onChange: setSearch, placeholder: 'Search sources...' }
  const panel = {
    back,
    title: meta.name,
    description: provider ? organizationSearchStatusLabel(provider) : undefined,
    docsLink: meta.searchDocsUrl,
    search: searchField,
  }
  const access = getConnectorAccessAvailability(meta, availability.integrationAvailability, {
    memberAccessAvailable: searchAccess.memberScoped,
    mirroredAccessAvailable: searchAccess.sourceMirrored,
    oauthServiceAvailability: availability.oauthServiceAvailability,
    isIntegrationAvailabilityReady: availability.isIntegrationAvailabilityReady,
  })
  const service =
    meta.auth.mode === 'oauth'
      ? (getServiceConfigByServiceId(meta.auth.provider) ??
        getServiceConfigByProviderId(meta.auth.provider))
      : undefined
  const credentialProvider = service
    ? findCredentialGroupProviderFromProviderId(service.providerId)
    : undefined
  const option = accounts.data?.credentialGroup?.options.find(
    (item) => item.provider === credentialProvider && item.status === 'active'
  )
  const needsSlackSetup =
    connectorType === 'slack' &&
    (option?.provider !== 'slack' ||
      !option.slackBotCredentialId ||
      option.configurationStatus !== 'ready')
  const pending =
    overview.isPending ||
    overview.isError ||
    approval.isPending ||
    !availability.isIntegrationAvailabilityReady
  const startSource = () =>
    void setSetup({
      addConnector: searchSetupParam.parser.parse(connectorType),
      'source-access': access.admin ? null : 'members',
    })
  const activate = () =>
    approval.mutate({ organizationId: organization.id, connectorType, approved: true })
  const actions: SettingsAction[] = approved
    ? [
        ...(access.admin || access.members
          ? [
              {
                text: needsSlackSetup ? 'Set up Slack app' : 'Add source',
                icon: Plus,
                variant: 'primary' as const,
                disabled:
                  pending ||
                  (connectorType === 'slack' && (accounts.isPending || accounts.isError)),
                onSelect: needsSlackSetup ? () => void setConnectedAccounts('slack') : startSource,
              },
            ]
          : []),
        {
          text: 'Deactivate',
          disabled: approval.isPending,
          onSelect: () => {
            approval.reset()
            setDeactivating(true)
          },
        },
      ]
    : [
        {
          text: provider ? 'Activate' : 'Add integration',
          variant: 'primary',
          disabled: pending || (!access.admin && !access.members),
          onSelect: activate,
        },
      ]
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
        <SettingsEmptyState variant='inline'>Loading integration…</SettingsEmptyState>
      </SettingsPanel>
    )

  const renderSources = () => (
    <SettingsPanel {...panel} actions={actions}>
      {approval.error && (
        <SettingsEmptyState variant='inline' tone='error'>
          {approval.error.message}
        </SettingsEmptyState>
      )}
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
          fallback='Could not load sources'
          isRetrying={sources.isFetching}
          onRetry={() => void sources.refetch()}
          variant='inline'
        />
      ) : sources.isPending ? (
        <SettingsEmptyState variant='inline'>Loading sources…</SettingsEmptyState>
      ) : (
        <div className={RESOURCE_LIST_STACK}>
          {sources.data?.map((source) => (
            <SettingsResourceRow
              key={source.connectorId}
              title={source.sourceDescription || meta.name}
              description={
                !approved
                  ? 'Deactivated'
                  : !source.enabled
                    ? 'Paused'
                    : source.hasSyncError
                      ? 'Needs attention'
                      : source.isSyncing
                        ? 'Indexing'
                        : source.lastSyncAt
                          ? `Last synced ${format(new Date(source.lastSyncAt), 'MMM d, h:mm a')}`
                          : 'Waiting for the first sync'
              }
              href={organizationRoutes(organization.id).searchSource(source.connectorId)}
              clickLabel={`Open ${source.sourceDescription || meta.name}`}
              navigable
            />
          ))}
          {!sources.data?.length && !sources.hasNextPage && (
            <SettingsEmptyState variant='inline'>
              {sourceSearch
                ? 'No matching sources'
                : !approved
                  ? 'Activate this integration to set up sources.'
                  : 'No sources yet.'}
            </SettingsEmptyState>
          )}
          <SearchSourcePagination {...sources} />
        </div>
      )}
    </SettingsPanel>
  )
  return (
    <>
      <div className='flex flex-col gap-6'>
        {personal && (
          <div>
            <ChipSwitch
              aria-label={`${meta.name} settings`}
              value={view}
              onChange={(value) => void setView(value)}
              options={[
                { value: 'sources', label: 'Sources' },
                { value: 'accounts', label: 'Accounts' },
              ]}
            />
          </div>
        )}
        {showAccounts ? (
          accounts.isError ? (
            <SettingsPanel {...panel}>
              <SettingsQueryErrorState
                error={accounts.error}
                fallback='Could not load account connections'
                isRetrying={accounts.isFetching}
                onRetry={() => void accounts.refetch()}
                variant='inline'
              />
            </SettingsPanel>
          ) : accounts.isPending ? (
            <SettingsPanel {...panel}>
              <SettingsEmptyState variant='inline'>Loading accounts…</SettingsEmptyState>
            </SettingsPanel>
          ) : option && approved && !needsSlackSetup ? (
            <OrganizationAccountPeople
              organizationId={organization.id}
              searchConnection={{ optionId: option.id, providerName: meta.name }}
              panel={panel}
            />
          ) : (
            <SettingsPanel {...panel} actions={actions}>
              {approval.error && (
                <SettingsEmptyState variant='inline' tone='error'>
                  {approval.error.message}
                </SettingsEmptyState>
              )}
              {availability.integrationAvailabilityError && (
                <SettingsQueryErrorState
                  error={availability.integrationAvailabilityError}
                  fallback='Could not load connection availability'
                  isRetrying={availability.isIntegrationAvailabilityFetching}
                  onRetry={() => void availability.refetchIntegrationAvailability()}
                  variant='inline'
                />
              )}
              <SettingsEmptyState variant='inline'>
                {approved
                  ? needsSlackSetup
                    ? 'Set up the Slack app to connect accounts.'
                    : 'Add a source to set up account connections.'
                  : 'Activate this integration to set up account connections.'}
              </SettingsEmptyState>
            </SettingsPanel>
          )
        ) : (
          renderSources()
        )}
      </div>
      <SearchSourceSetup
        scope={scope}
        canAdmin={viewer.isAdmin}
        memberAccessAvailable={searchAccess.memberScoped}
        mirroredAccessAvailable={searchAccess.sourceMirrored}
      />
      <OrganizationSlackAccountSetup />
      <ChipConfirmModal
        open={deactivating}
        onOpenChange={(open) => {
          if (!approval.isPending) setDeactivating(open)
        }}
        title={`Deactivate ${meta.name}?`}
        text='Its content will be unavailable in Search, Assistant, and MCP. Sources and connected accounts are preserved.'
        confirm={{
          label: 'Deactivate',
          variant: 'destructive',
          pending: approval.isPending,
          onClick: () =>
            approval.mutate(
              { organizationId: organization.id, connectorType, approved: false },
              { onSuccess: () => setDeactivating(false) }
            ),
        }}
      >
        <ChipModalError>{approval.error?.message}</ChipModalError>
      </ChipConfirmModal>
    </>
  )
}
