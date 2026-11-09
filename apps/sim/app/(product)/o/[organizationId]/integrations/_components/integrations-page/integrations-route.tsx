'use client'

import type { ReactNode } from 'react'
import { EmptyState } from '@sim/emcn/empty-state'
import { useSearchParams } from 'next/navigation'
import { SavedAccountModal } from '@/app/(product)/_components/service-account-modal/saved-account-modal'
import { IntegrationDetails } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-details/integration-details'
import { IntegrationList } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-list/integration-list'
import {
  IntegrationsHeading,
  IntegrationsPage,
} from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-page'
import { MemberSecrets } from '@/app/(product)/o/[organizationId]/integrations/_components/member-secrets/member-secrets'
import { ProviderHeading } from '@/app/(product)/o/[organizationId]/integrations/_components/provider-heading/provider-heading'
import { QueryFailure } from '@/app/(product)/o/[organizationId]/integrations/_components/query-failure/query-failure'
import { ToolPermissionsPanel } from '@/app/(product)/o/[organizationId]/integrations/_components/tool-permissions/tool-permissions-panel'
import {
  RestrictedIntegration,
  WorkspaceIntegrationDetails,
} from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integration-details/workspace-integration-details'
import {
  type IntegrationsWorkspaceScope,
  useWorkspaceDirectory,
} from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integrations/workspace-directory'
import {
  defaultIntegrationPaths,
  useIntegrationActions,
  useIntegrationsView,
  useMemberIntegrations,
} from '@/platform/lib/data/integrations'
import { integrationCenterHref } from '@/platform/lib/integrations/center-navigation'
import type { WorkspaceAppDetail } from '@/platform/lib/integrations/workspace-catalog'
import { GENERIC_SECRETS_SEGMENT } from '@/platform/shared/integrations'

export interface IntegrationsRouteProps {
  organizationId: string
  /** The `/integrations/[provider]` segment; absent on the index. */
  section?: string
  /** The host's confirmation of a connection a link asked for. */
  connectionRequest?: ReactNode
  /** The host's handoff from Slack onboarding, beside the heading. */
  handoff?: ReactNode
  /** The workspace whose apps, credentials and skills the page lists beside the member's own. */
  workspace: IntegrationsWorkspaceScope
  /** The app the `[provider]` segment names in that workspace's catalog. */
  workspaceDetail?: WorkspaceAppDetail
}

export function IntegrationsRoute({
  organizationId,
  section,
  connectionRequest,
  handoff,
  workspace: workspaceScope,
  workspaceDetail,
}: IntegrationsRouteProps) {
  const params = useSearchParams()
  const { integrations, genericSecrets, inventory, policies, secrets } =
    useMemberIntegrations(organizationId)
  const actions = useIntegrationActions(organizationId)
  const { search, account, clearAccount, serialize } = useIntegrationsView()
  const directory = useWorkspaceDirectory(organizationId, workspaceScope)
  const { workspace, connections } = directory
  const skills = directory.skills
  const defaults = defaultIntegrationPaths(organizationId)
  const indexPath = defaults.index
  const pathOf = (id: string) => `${indexPath}/${encodeURIComponent(id)}`
  const integrationHref = (id: string) =>
    directory.keep(serialize(integrationCenterHref(pathOf(id), params), { q: search }))
  const indexHref = directory.keep(
    serialize(integrationCenterHref(indexPath, params), { q: search })
  )
  const memberSecretsHref = directory.keep(
    serialize(integrationCenterHref(defaults.memberSecrets, params), { q: search })
  )
  const accountHref = (id: string) => (credentialId: string) =>
    serialize(integrationHref(id), { account: credentialId })

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
      {directory.failure}
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
                workspaceApps={directory.summaries}
                workspaceCredentials={directory.credentialLinks}
                secrets={genericSecrets}
                integrationHref={integrationHref}
                secretsHref={
                  genericSecrets?.mode === 'member'
                    ? memberSecretsHref
                    : integrationHref(GENERIC_SECRETS_SEGMENT)
                }
                settled={policies.isSuccess && secrets.isSuccess && directory.settled}
                skills={skills.tab}
                scopeFilter={directory.scopeFilter}
              />
            </>
          ))}
        {directory.requestDialog}
      </IntegrationsPage>
    )

  const integration = integrations.find((item) => item.id === section)
  const named = integration ?? workspaceDetail
  const back =
    account && named
      ? { href: integrationHref(named.id), label: `Back to ${named.name}` }
      : { href: indexHref, label: 'Integrations' }
  const disconnect = async (credentialId: string) => {
    if (integration?.accounts.some((item) => item.id === credentialId))
      await actions.disconnect(credentialId)
    else await connections.disconnect(credentialId)
    if (account === credentialId) clearAccount()
  }
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
    <>
      <IntegrationsPage back={back}>
        {inventoryFailure ??
          (inventory.data && (
            <>
              {readFailures}
              {integration ? (
                <IntegrationDetails
                  key={`${workspace?.id ?? ''}:${integration.id}`}
                  integration={integration}
                  accountId={account}
                  integrationHref={integrationHref(integration.id)}
                  accountHref={accountHref(integration.id)}
                  pending={actions.pending || connections.pending}
                  onConnect={() => {
                    if (integration.connectionTarget) actions.connect(integration.connectionTarget)
                  }}
                  onReconnect={actions.reconnect}
                  onDisconnect={disconnect}
                  onLeave={clearAccount}
                  renderToolPermissions={(credentialId) => (
                    <ToolPermissionsPanel
                      key={credentialId}
                      organizationId={organizationId}
                      credentialId={credentialId}
                    />
                  )}
                  workspaceApp={
                    workspace && workspaceDetail && workspaceDetail.access !== 'restricted'
                      ? { app: workspaceDetail, workspace, credentials: directory.credentials }
                      : undefined
                  }
                />
              ) : workspace && workspaceDetail?.access === 'restricted' ? (
                <RestrictedIntegration app={workspaceDetail} workspaceId={workspace.id} />
              ) : workspace && workspaceDetail ? (
                <WorkspaceIntegrationDetails
                  key={`${workspace.id}:${workspaceDetail.id}`}
                  app={workspaceDetail}
                  workspace={workspace}
                  credentials={directory.credentials}
                  accountId={account}
                  integrationHref={integrationHref(workspaceDetail.id)}
                  accountHref={accountHref(workspaceDetail.id)}
                  pending={connections.pending}
                  onDisconnect={disconnect}
                  onLeave={clearAccount}
                />
              ) : (
                !policies.error && unavailable(policies.isPending)
              )}
            </>
          ))}
      </IntegrationsPage>
      {actions.savedConnection && (
        <SavedAccountModal
          organizationId={organizationId}
          connection={actions.savedConnection}
          onClose={actions.closeSavedConnection}
        />
      )}
    </>
  )
}
