'use client'

import type { ReactNode } from 'react'
import { EmptyState } from '@sim/emcn/empty-state'
import { useSearchParams } from 'next/navigation'
import { IntegrationDetails } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-details/integration-details'
import { IntegrationList } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-list/integration-list'
import {
  IntegrationsHeading,
  IntegrationsPage,
} from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-page'
import { useLiveSkills } from '@/app/(product)/o/[organizationId]/integrations/_components/live-skills/live-skills'
import { MemberSecrets } from '@/app/(product)/o/[organizationId]/integrations/_components/member-secrets/member-secrets'
import { ProviderHeading } from '@/app/(product)/o/[organizationId]/integrations/_components/provider-heading/provider-heading'
import { QueryFailure } from '@/app/(product)/o/[organizationId]/integrations/_components/query-failure/query-failure'
import { ToolPermissionsPanel } from '@/app/(product)/o/[organizationId]/integrations/_components/tool-permissions/tool-permissions-panel'
import {
  defaultIntegrationPaths,
  useIntegrationActions,
  useIntegrationsView,
  useMemberIntegrations,
} from '@/platform/lib/data/integrations'
import { integrationCenterHref } from '@/platform/lib/integrations/center-navigation'
import { GENERIC_SECRETS_SEGMENT } from '@/platform/shared/integrations'

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
  const params = useSearchParams()
  const { integrations, genericSecrets, inventory, policies, secrets } =
    useMemberIntegrations(organizationId)
  const actions = useIntegrationActions(organizationId)
  const { search, account, clearAccount, serialize } = useIntegrationsView()
  const skills = useLiveSkills()
  const defaults = defaultIntegrationPaths(organizationId)
  const indexPath = basePath ?? defaults.index
  const pathOf = (id: string) => `${indexPath}/${encodeURIComponent(id)}`
  const integrationHref = (id: string) =>
    serialize(integrationCenterHref(pathOf(id), params), { q: search })
  const indexHref = serialize(integrationCenterHref(indexPath, params), { q: search })
  const memberSecretsHref = serialize(
    integrationCenterHref(memberSecretsPath ?? defaults.memberSecrets, params),
    { q: search }
  )

  const inventoryFailure = inventory.error ? (
    <QueryFailure message='Could not load your connections' query={inventory} />
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

  if (!section && skills.detail) return <IntegrationsPage>{skills.detail}</IntegrationsPage>

  if (!section)
    return (
      <IntegrationsPage>
        <IntegrationsHeading handoff={handoff} />
        {connectionRequest}
        {inventoryFailure ??
          (inventory.data && (
            <>
              {readFailures}
              <IntegrationList
                integrations={integrations}
                secrets={genericSecrets}
                integrationHref={integrationHref}
                secretsHref={
                  genericSecrets?.mode === 'member'
                    ? memberSecretsHref
                    : integrationHref(GENERIC_SECRETS_SEGMENT)
                }
                settled={policies.isSuccess && secrets.isSuccess}
                skills={skills.tab}
              />
            </>
          ))}
      </IntegrationsPage>
    )

  const integration = integrations.find((item) => item.id === section)
  const back =
    account && integration
      ? { href: integrationHref(integration.id), label: `Back to ${integration.name}` }
      : { href: indexHref, label: 'Integrations' }
  const unavailable = (loading: boolean) =>
    loading ? null : <EmptyState title='This integration is no longer available.' />

  if (section === GENERIC_SECRETS_SEGMENT)
    return (
      <IntegrationsPage back={back}>
        {inventoryFailure}
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
      {inventoryFailure ??
        (inventory.data && (
          <>
            {readFailures}
            {integration ? (
              <IntegrationDetails
                key={integration.id}
                integration={integration}
                accountId={account}
                integrationHref={integrationHref(integration.id)}
                accountHref={(credentialId) =>
                  serialize(integrationCenterHref(pathOf(integration.id), params), {
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
        ))}
    </IntegrationsPage>
  )
}
