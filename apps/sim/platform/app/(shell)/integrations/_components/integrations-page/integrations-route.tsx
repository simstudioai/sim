'use client'

import type { ReactNode } from 'react'
import { IntegrationDetails } from '@/platform/app/(shell)/integrations/_components/integration-details/integration-details'
import { IntegrationList } from '@/platform/app/(shell)/integrations/_components/integration-list/integration-list'
import {
  IntegrationsHeading,
  IntegrationsPage,
} from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page'
import { MemberSecrets } from '@/platform/app/(shell)/integrations/_components/member-secrets/member-secrets'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import { QueryFailure } from '@/platform/app/(shell)/integrations/_components/query-failure/query-failure'
import { ToolPermissionsPanel } from '@/platform/app/(shell)/integrations/_components/tool-permissions/tool-permissions-panel'
import { EmptyState, InlineNotice } from '@/platform/design-system/components'
import {
  defaultIntegrationPaths,
  useIntegrationActions,
  useIntegrationsView,
  useMemberIntegrations,
} from '@/platform/lib/data/integrations'
import { GENERIC_SECRETS_SEGMENT } from '@/platform/lib/data/integrations-types'

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
  /** Where this page is served. Defaults to the organization surface's route. */
  basePath?: string
  /** The personal secrets editor, which stays on the organization surface. */
  memberSecretsPath?: string
  /** The host's confirmation of a connection a link asked for. */
  connectionRequest?: ReactNode
  /** The host's handoff from Slack onboarding, beside the heading. */
  handoff?: ReactNode
}

export function IntegrationsRoute({
  organizationId,
  section,
  basePath,
  memberSecretsPath,
  connectionRequest,
  handoff,
}: IntegrationsRouteProps) {
  const { integrations, genericSecrets, inventory, policies, secrets } =
    useMemberIntegrations(organizationId)
  const actions = useIntegrationActions(organizationId)
  const { search, setSearch, account, clearAccount, serialize } = useIntegrationsView()
  const defaults = defaultIntegrationPaths(organizationId)
  const indexPath = basePath ?? defaults.index
  const pathOf = (id: string) => `${indexPath}/${encodeURIComponent(id)}`
  const integrationHref = (id: string) => serialize(pathOf(id), { q: search })
  const indexHref = serialize(indexPath, { q: search })
  const memberSecretsHref = serialize(memberSecretsPath ?? defaults.memberSecrets, { q: search })

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
        <IntegrationsHeading handoff={handoff} />
        {connectionRequest}
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
                serialize(pathOf(integration.id), {
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
                if (account === credentialId) clearAccount()
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
