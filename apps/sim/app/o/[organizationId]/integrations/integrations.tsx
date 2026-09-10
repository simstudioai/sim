'use client'

import { useMemo } from 'react'
import { toast } from '@sim/emcn'
import type { ResourceScope } from '@/lib/core/resource-scope'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { OrganizationPage } from '@/app/o/[organizationId]/components/organization-page'
import { useOrganizationPageFilters } from '@/app/o/[organizationId]/components/organization-page/use-organization-page-filters'
import { ConnectAccountOptions } from '@/app/o/[organizationId]/integrations/connect-account-options'
import { DisconnectAccountMenu } from '@/app/o/[organizationId]/integrations/disconnect-account-menu'
import { SlackSearchActions } from '@/app/o/[organizationId]/integrations/slack-search-actions'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SearchIntegrationConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/search-integration-connection'
import { SearchSourcePagination } from '@/app/workspace/[workspaceId]/search/components/search-source-pagination'
import { SearchSourceRow } from '@/app/workspace/[workspaceId]/search/components/search-source-row'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { RESOURCE_LIST_STACK } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSearchSources } from '@/hooks/queries/kb/connectors'
import { organizationAccountsKeys } from '@/hooks/queries/organization-accounts'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'
import { useDebounce } from '@/hooks/use-debounce'
import { useMemberEnrollment } from '@/hooks/use-member-enrollment'
import { useDesktopOAuthConnectListener, useOAuthReturnRouter } from '@/hooks/use-oauth-return'

interface OrganizationIntegrationsProps {
  connectionRequest?: { target: SearchConnectionTarget; userId: string }
  slackOnboarding?: { token: string; userId: string }
}

/** The viewer's Search connections and ready integrations they can connect personally. */
export function OrganizationIntegrations({
  slackOnboarding,
  connectionRequest,
}: OrganizationIntegrationsProps = {}) {
  useOAuthReturnRouter()
  useDesktopOAuthConnectListener()
  const { organization, searchAccess } = useOrganizationContext()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }
  const { search } = useOrganizationPageFilters()
  const sourceSearch = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const sources = useSearchSources(scope, { search: sourceSearch, mine: true })
  const membershipQueryKeys = useMemo(
    () => [
      searchSourceKeys.list({ kind: 'organization', organizationId: organization.id }),
      organizationAccountsKeys.detail(organization.id),
    ],
    [organization.id]
  )
  const connectedConnectorIds = useMemo(
    () =>
      new Set(
        sources.data
          ?.filter((source) => source.viewerMembership === 'connected')
          .map((source) => source.connectorId)
      ),
    [sources.data]
  )
  const enrollment = useMemberEnrollment({
    membershipQueryKeys,
    connectedConnectorIds,
    directOAuth: true,
    onConnectionError: toast.error,
  })

  return (
    <OrganizationPage
      title='Integrations'
      description='Connect your accounts for Sim Search'
      searchMode='expanded'
      searchPlaceholder='Search integrations'
      action={
        slackOnboarding && (
          <SlackSearchActions organizationId={organization.id} {...slackOnboarding} />
        )
      }
    >
      {connectionRequest && (
        <SearchIntegrationConnection
          organizationId={organization.id}
          {...connectionRequest}
          controlId='integrations-link'
        />
      )}
      <div className={RESOURCE_LIST_STACK}>
        {sources.isError && !sources.isFetchNextPageError ? (
          <SettingsQueryErrorState
            error={sources.error}
            fallback='Could not load your connections'
            isRetrying={sources.isFetching}
            onRetry={() => void sources.refetch()}
            variant='inline'
          />
        ) : !sources.isPending && (sources.data?.length || sources.hasNextPage) ? (
          <>
            {sources.data?.map((source) => (
              <SearchSourceRow
                key={source.connectorId}
                source={source}
                scope={scope}
                canAdmin={false}
                accountActions={
                  source.viewerAccounts?.length ? (
                    <DisconnectAccountMenu
                      organizationId={organization.id}
                      integrationName={connectorDisplayName(source.connectorType)}
                      accounts={source.viewerAccounts}
                    />
                  ) : undefined
                }
                available={
                  source.accessMode === 'members'
                    ? searchAccess.memberScoped
                    : searchAccess.sourceMirrored &&
                      (!source.connectionRequired || searchAccess.memberScoped)
                }
                waiting={enrollment.isAwaiting(source.connectorId)}
                isPending={enrollment.isPending}
                onConnect={() => enrollment.connect(source.knowledgeBaseId, source.connectorId)}
              />
            ))}
            <SearchSourcePagination {...sources} />
          </>
        ) : null}
      </div>
      <ConnectAccountOptions
        search={sourceSearch}
        showEmpty={
          !sources.isPending && !sources.isError && !sources.data?.length && !sources.hasNextPage
        }
      />
    </OrganizationPage>
  )
}
