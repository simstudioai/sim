'use client'

import { useQueryStates } from 'nuqs'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  integrationSearchParsers,
  integrationSearchUrlKeys,
  integrationViewParsers,
  serializeIntegrationView,
} from '@/app/o/[organizationId]/integrations/search-params'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useDesktopOAuthConnectListener, useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import { IntegrationDetails } from '@/platform/app/(shell)/integrations/_components/integration-details/integration-details'
import { IntegrationList } from '@/platform/app/(shell)/integrations/_components/integration-list/integration-list'
import {
  IntegrationsHeading,
  IntegrationsPage,
} from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page'
import { MemberSecrets } from '@/platform/app/(shell)/integrations/_components/member-secrets/member-secrets'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import { QueryFailure } from '@/platform/app/(shell)/integrations/_components/query-failure/query-failure'
import { SearchConnectionRequest } from '@/platform/app/(shell)/integrations/_components/search-connection-request/search-connection-request'
import { SlackSearchActions } from '@/platform/app/(shell)/integrations/_components/slack-search-actions/slack-search-actions'
import { ToolPermissionsPanel } from '@/platform/app/(shell)/integrations/_components/tool-permissions/tool-permissions-panel'
import { EmptyState, InlineNotice } from '@/platform/design-system/components'
import { useIntegrationActions, useMemberIntegrations } from '@/platform/lib/data/integrations'
import { GENERIC_SECRETS_SEGMENT, integrationPath } from '@/platform/lib/integrations/model'

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
        <InlineNotice message={LOADING_CONNECTION} />
      ) : (
        <>
          <IntegrationsHeading />
          <InlineNotice message={LOADING_CONNECTIONS} />
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

  const inventoryStatus = inventory.error ? (
    <QueryFailure message='Could not load your connections' query={inventory} />
  ) : !inventory.data ? (
    <InlineNotice message={LOADING_CONNECTIONS} />
  ) : null
  const readFailures = (
    <>
      {policies.error && (
        <QueryFailure message='Could not load Search connections' query={policies} />
      )}
      {secrets.error && (
        <QueryFailure message='Could not load secret connections' query={secrets} />
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
      <InlineNotice message={LOADING_CONNECTION} />
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
  )
}
