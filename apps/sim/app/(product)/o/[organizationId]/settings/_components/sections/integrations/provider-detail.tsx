'use client'

import { type ReactNode, useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsSection } from '@sim/emcn/settings-section'
import { RowList } from '@sim/emcn/settings-section/row-list'
import { FailureNotice } from '@sim/emcn/status'
import { Tooltip } from '@sim/emcn/tooltip'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import {
  DetailHeader,
  Muted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SourceSetup } from '@/app/(product)/o/[organizationId]/settings/_components/sections/integrations/source-setup-host'
import { CONNECTOR_META_REGISTRY } from '@/platform/lib/data/knowledge/connectors'
import { useOrganization } from '@/platform/lib/data/organization'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import {
  getConnectorAccessAvailability,
  getSearchConnectionLabels,
  SEARCH_DEBOUNCE_MS,
  searchSetupAccessParam,
  searchSetupParam,
  useProviderConnections,
  useSearchAvailability,
  useSearchFilterValue,
  useSettingsSearch,
} from '@/platform/lib/data/search-sources'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

interface ProviderDetailProps {
  connectorType: string
}

export function ProviderDetail({ connectorType }: ProviderDetailProps) {
  const { organization, viewer, searchAccess } = useOrganization()
  const router = useRouter()
  const meta = CONNECTOR_META_REGISTRY[connectorType]
  const [search, setSearch] = useSettingsSearch()
  const sourceSearch = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS).trim()
  const [removingSlackAccounts, setRemovingSlackAccounts] = useState(false)
  const scope = { kind: 'organization', organizationId: organization.id } as const
  const connections = useProviderConnections(organization.id, connectorType, {
    search: sourceSearch,
    isAdmin: viewer.isAdmin,
  })
  const { overview, sources, accounts, provider, listed, needsSlackSetup, canRemoveSlackSetup } =
    connections
  const availability = useSearchAvailability()
  const surface = useSurfaceScope()
  const [, setSetup] = useQueryStates(
    {
      [searchSetupParam.key]: searchSetupParam.parser,
      [searchSetupAccessParam.key]: searchSetupAccessParam.parser,
    },
    { history: 'replace' }
  )
  const approved = provider?.approved === true
  const sourcesHref = surfaceHref(surface, '/settings/integrations')
  const slackHref = surfaceHref(surface, '/settings/search-slack')
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
  const pending =
    overview.isPending || overview.isError || !availability.isIntegrationAvailabilityReady
  const startSource = () =>
    void setSetup({
      addConnector: searchSetupParam.parser.parse(connectorType),
      'source-access': access.admin ? null : 'members',
    })
  const header = (actions?: ReactNode) => (
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
  // The header stays on screen through every state, and the read gates more than this list.
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
  if (overview.isPending) return <SectionStack>{header()}</SectionStack>
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
                  render={needsSlackSetup ? <Link href={slackHref} /> : undefined}
                  onClick={needsSlackSetup ? undefined : startSource}
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
                variant='quiet'
                destructive
                size='compact'
                disabled={accounts.isFetching}
                onClick={() => {
                  connections.resetSlackRemoval()
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
          {sources.isError && !sources.data ? (
            <FailureNotice
              message={getErrorMessage(sources.error, 'Could not load connections')}
              retrying={sources.isFetching}
              onRetry={() => void sources.refetch()}
            />
          ) : sources.data ? (
            <>
              <RowList>
                {listed?.map((source) => (
                  <ActivityRow
                    density='comfortable'
                    key={source.connectorId}
                    title={source.sourceDescription || meta.name}
                    detail={!approved ? 'Unavailable' : !source.enabled ? 'Paused' : undefined}
                    href={surfaceHref(
                      surface,
                      `/settings/integrations/sources/${encodeURIComponent(source.connectorId)}`
                    )}
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
                  {sources.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              ) : null}
            </>
          ) : null}
        </SettingsSection>
        {removingSlackAccounts && connections.removeSlackSetup && (
          <ConfirmDialog
            target
            onClose={() => setRemovingSlackAccounts(false)}
            title='Remove Slack app setup'
            confirmLabel='Remove'
            pendingLabel='Removing…'
            onConfirm={connections.removeSlackSetup}
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
