'use client'

import { useQueryStates } from 'nuqs'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  integrationSearchParsers,
  integrationSearchUrlKeys,
  integrationViewParsers,
  serializeIntegrationView,
} from '@/lib/organizations/integrations-search-params'
import { SavedSearchCredentialModal } from '@/app/workspace/[workspaceId]/integrations/components/saved-search-credential-modal'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useDesktopOAuthConnectListener, useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import { FailureNotice, LoadingRows, QueryBoundary } from '@/platform/design-system/components'
import { EmptyState } from '@/platform/design-system/components/empty-state/empty-state'
import { IntegrationDetails } from '@/platform/embedded/app/(shell)/integrations/_components/integration-details/integration-details'
import { IntegrationList } from '@/platform/embedded/app/(shell)/integrations/_components/integration-list/integration-list'
import {
  IntegrationsHeading,
  IntegrationsPage,
} from '@/platform/embedded/app/(shell)/integrations/_components/integrations-page/integrations-page'
import { MemberSecrets } from '@/platform/embedded/app/(shell)/integrations/_components/member-secrets/member-secrets'
import { ProviderHeading } from '@/platform/embedded/app/(shell)/integrations/_components/provider-heading/provider-heading'
import { SearchConnectionRequest } from '@/platform/embedded/app/(shell)/integrations/_components/search-connection-request/search-connection-request'
import { SlackSearchActions } from '@/platform/embedded/app/(shell)/integrations/_components/slack-search-actions/slack-search-actions'
import { ToolPermissionsPanel } from '@/platform/embedded/app/(shell)/integrations/_components/tool-permissions/tool-permissions-panel'
import {
  useIntegrationActions,
  useMemberIntegrations,
} from '@/platform/embedded/lib/data/integrations'
import { integrationPath } from '@/platform/embedded/lib/integrations/model'
import { GENERIC_SECRETS_SEGMENT } from '@/platform/shared/integrations'

const LOADING_CONNECTIONS = 'Loading your connections'
const LOADING_CONNECTION = 'Loading connection'

interface IntegrationsRouteFallbackProps {
  /** A provider's page, which has no index heading to hold. */
  detail: boolean
}

/** Holds the page's place while its prefetch settles, in the words its reads use once mounted. */
export function IntegrationsRouteFallback({ detail }: IntegrationsRouteFallbackProps) {
  return (
    <IntegrationsPage>
      {detail ? (
        <LoadingRows label={LOADING_CONNECTION} />
      ) : (
        <>
          <IntegrationsHeading />
          <LoadingRows label={LOADING_CONNECTIONS} />
        </>
      )}
    </IntegrationsPage>
  )
}

export interface IntegrationsRouteProps {
  organizationId: string
  /** The `/integrations/[provider]` segment; absent on the index. */
  section?: string
  connectionRequest?: { target: SearchConnectionTarget; userId: string }
  slackOnboarding?: { token: string; userId: string }
}

export function IntegrationsRoute({
  organizationId,
  section,
  connectionRequest,
  slackOnboarding,
}: IntegrationsRouteProps) {
  useOAuthReturnRouter()
  useDesktopOAuthConnectListener()
  const { integrations, genericSecrets, inventory, policies, secrets } =
    useMemberIntegrations(organizationId)
  const actions = useIntegrationActions(organizationId)
  const [{ q: search }, setSearchParams] = useQueryStates(
    integrationSearchParsers,
    integrationSearchUrlKeys
  )
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setSearchParams({ q: value }, options)
  )
  const [{ account }, setParams] = useQueryStates(integrationViewParsers)
  const routes = organizationRoutes(organizationId)
  const integrationHref = (id: string) =>
    serializeIntegrationView(integrationPath(organizationId, id), { q: search })
  const indexHref = serializeIntegrationView(routes.integrations, { q: search })
  const memberSecretsHref = serializeIntegrationView(routes.memberSecrets, { q: search })

  const inventoryStatus = !inventory.data ? (
    <QueryBoundary
      query={inventory}
      failure='Could not load your connections'
      loadingLabel={LOADING_CONNECTIONS}
    >
      {() => null}
    </QueryBoundary>
  ) : null
  const readFailures = (
    <>
      {policies.error && (
        <FailureNotice
          message='Could not load Search connections'
          retrying={policies.isFetching}
          onRetry={() => void policies.refetch()}
        />
      )}
      {secrets.error && (
        <FailureNotice
          message='Could not load secret connections'
          retrying={secrets.isFetching}
          onRetry={() => void secrets.refetch()}
        />
      )}
    </>
  )

  if (!section)
    return (
      <IntegrationsPage>
        <IntegrationsHeading
          handoff={
            slackOnboarding && (
              <SlackSearchActions organizationId={organizationId} {...slackOnboarding} />
            )
          }
        />
        {connectionRequest && (
          <SearchConnectionRequest
            key={JSON.stringify([connectionRequest.userId, connectionRequest.target])}
            organizationId={organizationId}
            {...connectionRequest}
          />
        )}
        {inventoryStatus ?? (
          <>
            {readFailures}
            <IntegrationList
              integrations={integrations}
              secrets={genericSecrets}
              query={search}
              onQueryChange={setSearch}
              integrationHref={integrationHref}
              secretsHref={
                genericSecrets?.mode === 'member'
                  ? memberSecretsHref
                  : integrationHref(GENERIC_SECRETS_SEGMENT)
              }
              settled={policies.isSuccess && secrets.isSuccess}
            />
          </>
        )}
      </IntegrationsPage>
    )

  const integration = integrations.find((item) => item.id === section)
  const back =
    account && integration
      ? { href: integrationHref(integration.id), label: integration.name }
      : { href: indexHref, label: 'Integrations' }
  const unavailable = (loading: boolean) =>
    loading ? (
      <LoadingRows label={LOADING_CONNECTION} />
    ) : (
      <EmptyState title='This integration is no longer available.' />
    )

  if (section === GENERIC_SECRETS_SEGMENT)
    return (
      <IntegrationsPage back={back}>
        {inventoryStatus}
        {readFailures}
        {genericSecrets ? (
          <>
            <ProviderHeading name={genericSecrets.name} description={genericSecrets.description} />
            <MemberSecrets source={genericSecrets} editorHref={memberSecretsHref} />
          </>
        ) : (
          !secrets.error && unavailable(secrets.isPending)
        )}
      </IntegrationsPage>
    )

  return (
    <>
      <IntegrationsPage back={back}>
        {inventoryStatus ?? (
          <>
            {readFailures}
            {integration ? (
              <IntegrationDetails
                key={integration.id}
                integration={integration}
                accountId={account}
                integrationHref={integrationHref(integration.id)}
                accountHref={(credentialId) =>
                  serializeIntegrationView(integrationPath(organizationId, integration.id), {
                    q: search,
                    account: credentialId,
                  })
                }
                pending={actions.pending}
                onConnect={() => {
                  if (integration.connectionTarget) actions.connect(integration.connectionTarget)
                }}
                onReconnect={actions.reconnect}
                onDisconnect={async (credentialId) => {
                  await actions.disconnect(credentialId)
                  if (account === credentialId) void setParams({ account: null, tools: null })
                }}
                renderToolPermissions={(credentialId) => (
                  <ToolPermissionsPanel
                    key={credentialId}
                    organizationId={organizationId}
                    credentialId={credentialId}
                  />
                )}
              />
            ) : (
              !policies.error && unavailable(policies.isPending)
            )}
          </>
        )}
      </IntegrationsPage>
      {actions.savedConnection && (
        <SavedSearchCredentialModal
          organizationId={organizationId}
          connection={actions.savedConnection}
          onClose={actions.closeSavedConnection}
        />
      )}
    </>
  )
}
