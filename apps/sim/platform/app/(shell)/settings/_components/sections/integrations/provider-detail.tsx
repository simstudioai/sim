'use client'

import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { useQueryState, useQueryStates } from 'nuqs'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getSearchConnectionLabels } from '@/lib/sim-search/connection-labels'
import { getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
import { searchSetupAccessParam, searchSetupParam } from '@/lib/sim-search/params'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { connectedAccountsParam } from '@/app/o/[organizationId]/settings/components/integrations/search-params'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { useSearchSources } from '@/hooks/queries/kb/connectors'
import {
  useOrganizationAccounts,
  useUpdateOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'
import { useSearchIntegrations } from '@/hooks/queries/search-integrations'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import {
  DetailHeader,
  Muted,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { SlackAccountSetup } from '@/platform/app/(shell)/settings/_components/sections/integrations/slack-account-setup'
import { SourceSetup } from '@/platform/app/(shell)/settings/_components/sections/integrations/source-setup-host'
import {
  ActivityRow,
  Button,
  ConfirmDialog,
  EmptyState,
  errorMessageOr,
  FailureNotice,
  LoadingRows,
  QueryBoundary,
  RowList,
  SearchField,
  Tooltip,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'

interface ProviderDetailProps {
  connectorType: string
}

export function ProviderDetail({ connectorType }: ProviderDetailProps) {
  const { organization, viewer, searchAccess } = useOrganizationContext()
  const router = useRouter()
  const meta = CONNECTOR_META_REGISTRY[connectorType]
  const [search, setSearch] = useSettingsSearch()
  const sourceSearch = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS).trim()
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
  const removeSlackAccounts = useUpdateOrganizationAccounts()
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
  const routes = organizationRoutes(organization.id)
  const sourcesHref = routes.settingsSection('integrations')
  if (!viewer.isAdmin || !meta) return null
  const labels = getSearchConnectionLabels(connectorType)
  const access = getConnectorAccessAvailability(meta, availability.integrationAvailability, {
    memberAccessAvailable: searchAccess.memberScoped,
    mirroredAccessAvailable: searchAccess.sourceMirrored,
    oauthServiceAvailability: availability.oauthServiceAvailability,
    isIntegrationAvailabilityReady: availability.isIntegrationAvailabilityReady,
  })
  const unavailable =
    availability.isIntegrationAvailabilityReady && !access.admin && !access.members
  const description =
    approved && unavailable
      ? 'Unavailable in this deployment'
      : provider
        ? connectorType === 'gitlab'
          ? 'Projects and permissions'
          : connectorType === 'github'
            ? 'GitHub App repositories'
            : 'Service account connections'
        : undefined
  const option = accounts.data?.credentialGroup?.options.find(
    (item) => item.provider === 'slack' && item.status === 'active'
  )
  const group = accounts.data?.credentialGroup
  const canRemoveSlackSetup =
    connectorType === 'slack' &&
    !accounts.isError &&
    group?.options.some((item) => item.provider === 'slack')
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
  const header = (actions?: React.ReactNode) => (
    <DetailHeader
      backLabel='Sources'
      onBack={() => router.push(sourcesHref)}
      title={meta.name}
      description={description}
    >
      {meta.searchDocsUrl && (
        <Button
          variant='quiet'
          size='compact'
          render={
            <a href={meta.searchDocsUrl} target='_blank' rel='noopener noreferrer'>
              Docs
            </a>
          }
        >
          Docs
        </Button>
      )}
      {actions}
    </DetailHeader>
  )
  if (overview.isError)
    return (
      <SectionStack>
        {header()}
        <FailureNotice
          message={getErrorMessage(overview.error, 'Could not load integration')}
          retrying={overview.isFetching}
          onRetry={() => void overview.refetch()}
        />
      </SectionStack>
    )
  if (overview.isPending)
    return (
      <SectionStack>
        {header()}
        <LoadingRows label='Loading integration' />
      </SectionStack>
    )

  const listed = sources.data?.filter(
    (source) =>
      source.accessMode === 'admin' || (connectorType === 'github' && source.isGitHubInstallation)
  )
  return (
    <SourceSetup
      scope={scope}
      backLabel={meta.name}
      canAdmin={viewer.isAdmin}
      memberAccessAvailable={searchAccess.memberScoped}
      mirroredAccessAvailable={searchAccess.sourceMirrored}
    >
      <SectionStack>
        {header(
          <>
            {approved ? (
              (needsSlackSetup ||
                access.admin ||
                (connectorType === 'github' && access.members)) && (
                <Button
                  variant='primary'
                  size='compact'
                  icon='I074'
                  disabled={
                    pending ||
                    (connectorType === 'slack' && (accounts.isPending || accounts.isError))
                  }
                  onClick={needsSlackSetup ? () => void setConnectedAccounts('slack') : startSource}
                >
                  {needsSlackSetup
                    ? 'Set up Slack app'
                    : connectorType === 'github'
                      ? 'Add repository'
                      : connectorType !== 'gitlab'
                        ? 'Add service account'
                        : getSearchConnectionLabels(
                            connectorType,
                            access.admin ? 'admin' : 'members'
                          ).add}
                </Button>
              )
            ) : (
              <Tooltip
                label='This integration is unavailable in this deployment.'
                enabled={unavailable}
              >
                <span>
                  <Button
                    variant='primary'
                    size='compact'
                    disabled={pending || (!access.admin && !access.members)}
                    onClick={() => router.push(sourcesHref)}
                  >
                    View sources
                  </Button>
                </span>
              </Tooltip>
            )}
            {canRemoveSlackSetup && (
              <Button
                variant='destructive'
                size='compact'
                disabled={accounts.isFetching}
                onClick={() => {
                  removeSlackAccounts.reset()
                  setRemovingSlackAccounts(true)
                }}
              >
                Remove app setup
              </Button>
            )}
          </>
        )}
        <SearchField
          label='Search connections'
          placeholder={labels.searchPlaceholder}
          value={search}
          onValueChange={setSearch}
        />
        {availability.integrationAvailabilityError && (
          <FailureNotice
            message={getErrorMessage(
              availability.integrationAvailabilityError,
              'Could not load connection availability'
            )}
            retrying={availability.isIntegrationAvailabilityFetching}
            onRetry={() => void availability.refetchIntegrationAvailability()}
          />
        )}
        {connectorType === 'slack' && accounts.isError && (
          <FailureNotice
            message={getErrorMessage(accounts.error, 'Could not load account connections')}
            retrying={accounts.isFetching}
            onRetry={() => void accounts.refetch()}
          />
        )}
        <SettingsSection title='Connections'>
          {sources.isRefetchError && (
            <FailureNotice
              message={getErrorMessage(sources.error, 'Could not load connections')}
              retrying={sources.isFetching}
              onRetry={() => void sources.refetch()}
            />
          )}
          <QueryBoundary
            query={sources}
            failure={errorMessageOr('Could not load connections')}
            loadingLabel='Loading connections'
          >
            {() => (
              <>
                <RowList>
                  {listed?.map((source) => (
                    <ActivityRow
                      density='comfortable'
                      key={source.connectorId}
                      title={source.sourceDescription || meta.name}
                      detail={!approved ? 'Unavailable' : !source.enabled ? 'Paused' : undefined}
                      href={routes.searchSource(source.connectorId)}
                    />
                  ))}
                </RowList>
                {!listed?.length && !sources.hasNextPage && (
                  <EmptyState
                    title={
                      sourceSearch
                        ? 'No matching connections'
                        : unavailable
                          ? `${meta.name} must be configured for this deployment before you can add a connection.`
                          : !approved
                            ? 'Activate this integration to add a connection.'
                            : labels.empty
                    }
                  />
                )}
                {sources.isFetchNextPageError ? (
                  <FailureNotice
                    message={getErrorMessage(sources.error, 'Could not load more connections')}
                    retrying={sources.isFetchingNextPage}
                    onRetry={() => void sources.fetchNextPage()}
                  />
                ) : sources.hasNextPage ? (
                  <Button
                    size='compact'
                    disabled={sources.isFetchingNextPage}
                    onClick={() => void sources.fetchNextPage()}
                  >
                    {sources.isFetchingNextPage ? 'Loading' : 'Load more'}
                  </Button>
                ) : null}
              </>
            )}
          </QueryBoundary>
        </SettingsSection>
        <SlackAccountSetup organizationId={organization.id} isAdmin={viewer.isAdmin} />
        {removingSlackAccounts && group && (
          <ConfirmDialog
            target
            onClose={() => setRemovingSlackAccounts(false)}
            title='Remove Slack app setup?'
            confirmLabel='Remove'
            pendingLabel='Removing…'
            onConfirm={async () => {
              await removeSlackAccounts.mutateAsync({
                organizationId: organization.id,
                groupId: group.id,
                update: {
                  options: group.options
                    .filter((item) => item.provider !== 'slack')
                    .map(({ id, provider: optionProvider, label, required }) => ({
                      id,
                      provider: optionProvider,
                      label,
                      required,
                    })),
                },
              })
            }}
          >
            <Muted>
              This disconnects your organization’s Slack accounts and clears their saved app
              configuration. Remove any connections using these accounts first.
            </Muted>
          </ConfirmDialog>
        )}
      </SectionStack>
    </SourceSetup>
  )
}
