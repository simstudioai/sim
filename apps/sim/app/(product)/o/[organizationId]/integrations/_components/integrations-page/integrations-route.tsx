'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { SavedAccountModal } from '@/app/(product)/_components/service-account-modal/saved-account-modal'
import type { LiveTab } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-center/integration-center'
import { IntegrationDetails } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-details/integration-details'
import { IntegrationList } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-list/integration-list'
import {
  IntegrationsHeading,
  IntegrationsPage,
} from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-page'
import { MemberSecrets } from '@/app/(product)/o/[organizationId]/integrations/_components/member-secrets/member-secrets'
import { ProviderHeading } from '@/app/(product)/o/[organizationId]/integrations/_components/provider-heading/provider-heading'
import { QueryFailure } from '@/app/(product)/o/[organizationId]/integrations/_components/query-failure/query-failure'
import { LiveGroup } from '@/app/(product)/o/[organizationId]/integrations/_components/resource-list/resource-list'
import { ToolPermissionsPanel } from '@/app/(product)/o/[organizationId]/integrations/_components/tool-permissions/tool-permissions-panel'
import {
  IntegrationAccessRequest,
  RestrictedIntegration,
} from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integration-details/workspace-integration-details'
import {
  type IntegrationsWorkspaceScope,
  useWorkspaceDirectory,
} from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integrations/workspace-directory'
import {
  defaultIntegrationPaths,
  useIntegrationActions,
  useIntegrationsOAuthReturn,
  useMemberIntegrations,
} from '@/platform/lib/data/integrations'
import { centerParams, integrationCenterHref } from '@/platform/lib/integrations/center-navigation'
import type { WorkspaceAppDetail } from '@/platform/lib/integrations/workspace-catalog'
import { GENERIC_SECRETS_SEGMENT } from '@/platform/shared/integrations'

export interface IntegrationsRouteProps {
  organizationId: string
  /** Whether the organization keeps member-scoped accounts the viewer may connect. */
  member: boolean
  /** The `/integrations/[provider]` segment; absent on the index. */
  section?: string
  /** The host's confirmation of a connection a link asked for. */
  connectionRequest?: ReactNode
  /** The host's handoff from Slack onboarding, beside the heading. */
  handoff?: ReactNode
  /** The workspace whose apps, credentials, skills and MCPs the page lists. */
  workspace: IntegrationsWorkspaceScope
  /** The app the `[provider]` segment names in that workspace's catalog. */
  workspaceDetail?: WorkspaceAppDetail
}

/**
 * Integrations on live data: one directory and one app page over the member's own accounts, where
 * the organization keeps them, and the chosen workspace's apps, credentials, skills and MCPs. Each
 * source reads, fails and retries on its own.
 */
export function IntegrationsRoute({
  organizationId,
  member,
  section,
  connectionRequest,
  handoff,
  workspace: workspaceScope,
  workspaceDetail,
}: IntegrationsRouteProps) {
  const params = useSearchParams()
  const router = useRouter()
  const [{ q, order }] = useQueryStates(centerParams)
  const { integrations, genericSecrets, inventory, policies, secrets } = useMemberIntegrations(
    member ? organizationId : undefined
  )
  const actions = useIntegrationActions(organizationId, { enabled: member })
  const defaults = defaultIntegrationPaths(organizationId)
  const directory = useWorkspaceDirectory(defaults.index, workspaceScope)
  const { workspace, connections, view, mcps } = directory
  useIntegrationsOAuthReturn(workspace?.id)
  const { account, clearAccount, serialize } = view
  const indexHref = directory.keep(integrationCenterHref(defaults.index, params))
  const memberSecretsHref = directory.keep(integrationCenterHref(defaults.memberSecrets, params))
  const accountHref = (id: string) => (credentialId: string) =>
    serialize(directory.appHref(id), { account: credentialId })
  const memberSettled = !member || Boolean(inventory.data || inventory.error)
  const memberPending = member && (inventory.isPending || policies.isPending)

  const failures = (
    <>
      {inventory.error && (
        <QueryFailure message='Could not load your connections' query={inventory} />
      )}
      {policies.error && (
        <QueryFailure message='Could not load Search connections' query={policies} />
      )}
      {secrets.error && (
        <QueryFailure message='Could not load secret connections' query={secrets} />
      )}
      {connections.credentials.error && (
        <QueryFailure
          message='Could not load workspace credentials'
          query={connections.credentials}
        />
      )}
    </>
  )

  if (!section && directory.skills.detail)
    return <IntegrationsPage>{directory.skills.detail}</IntegrationsPage>

  if (!section) {
    const term = q.trim().toLowerCase()
    const servers = (mcps.servers ?? [])
      .filter((server) => `${server.name} ${server.description}`.toLowerCase().includes(term))
      .sort((a, b) => (order === 'asc' ? 1 : -1) * a.name.localeCompare(b.name))
    const mcpTab: LiveTab | undefined = workspace && {
      actions: mcps.connectHref && (
        <Button
          variant='secondary'
          size='compact'
          icon='I074'
          render={<Link href={mcps.connectHref} />}
        >
          Connect MCP
        </Button>
      ),
      content: mcps.query.error ? (
        <QueryFailure message='Could not load MCP servers' query={mcps.query} />
      ) : (
        <LiveGroup
          title='Shared'
          glyph='I126'
          rows={servers}
          onOpen={(server) => router.push(server.href)}
        />
      ),
      empty: !servers.length && !mcps.query.error,
      settled: Boolean(mcps.servers),
      emptyDescription: 'MCP servers in this workspace appear here.',
    }
    return (
      <IntegrationsPage>
        <IntegrationsHeading handoff={handoff} />
        {connectionRequest}
        {failures}
        {memberSettled && (
          <IntegrationList
            integrations={integrations}
            workspaceApps={directory.summaries}
            workspaceCredentials={directory.credentialLinks}
            secrets={genericSecrets}
            integrationHref={directory.appHref}
            secretsHref={
              genericSecrets?.mode === 'member'
                ? memberSecretsHref
                : directory.appHref(GENERIC_SECRETS_SEGMENT)
            }
            settled={(!member || (policies.isSuccess && secrets.isSuccess)) && directory.settled}
            skills={directory.skills.tab}
            mcps={mcpTab}
            createCredentialHref={directory.createCredentialHref}
            scopeFilter={
              workspace && (
                <ChoiceMenu
                  label='Workspace'
                  value={workspace.id}
                  options={directory.workspaces.map((item) => ({
                    label: item.name,
                    value: item.id,
                  }))}
                  onValueChange={view.chooseWorkspace}
                />
              )
            }
          />
        )}
        {directory.requested && workspace && (
          <IntegrationAccessRequest
            key={directory.requested.id}
            app={directory.requested}
            workspaceId={workspace.id}
            onClose={directory.closeRequest}
          />
        )}
      </IntegrationsPage>
    )
  }

  const integration = integrations.find((item) => item.id === section)
  const named = integration ?? workspaceDetail
  const back =
    account && named
      ? { href: directory.appHref(named.id), label: `Back to ${named.name}` }
      : { href: indexHref, label: 'Integrations' }
  const disconnect = async (credentialId: string) => {
    if (integration?.accounts.some((item) => item.id === credentialId))
      await actions.disconnect(credentialId)
    else await connections.disconnect(credentialId)
    if (account === credentialId) clearAccount()
  }
  const unavailable = <EmptyState title='This integration is no longer available.' />

  if (section === GENERIC_SECRETS_SEGMENT)
    return (
      <IntegrationsPage back={back}>
        {failures}
        {genericSecrets ? (
          <>
            <ProviderHeading name={genericSecrets.name} description={genericSecrets.description} />
            <MemberSecrets source={genericSecrets} editorHref={memberSecretsHref} />
          </>
        ) : (
          !secrets.error && !secrets.isPending && unavailable
        )}
      </IntegrationsPage>
    )

  const workspaceApp =
    workspace &&
    workspaceDetail &&
    workspaceDetail.access !== 'restricted' &&
    !connections.credentials.error
      ? { app: workspaceDetail, workspace, credentials: directory.credentials }
      : undefined
  const integrationHref = named ? directory.appHref(named.id) : indexHref
  const onConnect = () => {
    if (integration?.connectionTarget) actions.connect(integration.connectionTarget)
  }
  const renderToolPermissions = (credentialId: string) => (
    <ToolPermissionsPanel
      key={credentialId}
      organizationId={organizationId}
      credentialId={credentialId}
    />
  )

  return (
    <>
      <IntegrationsPage back={back}>
        {failures}
        {memberSettled &&
          (integration ? (
            <IntegrationDetails
              key={`${workspace?.id ?? ''}:${integration.id}`}
              integration={integration}
              workspaceApp={workspaceApp}
              accountId={account}
              integrationHref={integrationHref}
              accountHref={accountHref(named?.id ?? '')}
              pending={actions.pending || connections.pending}
              onConnect={onConnect}
              onReconnect={actions.reconnect}
              onDisconnect={disconnect}
              onLeave={clearAccount}
              renderToolPermissions={renderToolPermissions}
            />
          ) : workspace && workspaceDetail?.access === 'restricted' ? (
            <RestrictedIntegration app={workspaceDetail} workspaceId={workspace.id} />
          ) : workspaceApp ? (
            <IntegrationDetails
              key={`${workspaceApp.workspace.id}:${workspaceApp.app.id}`}
              workspaceApp={workspaceApp}
              accountId={account}
              integrationHref={integrationHref}
              accountHref={accountHref(named?.id ?? '')}
              pending={actions.pending || connections.pending}
              onConnect={onConnect}
              onReconnect={actions.reconnect}
              onDisconnect={disconnect}
              onLeave={clearAccount}
              renderToolPermissions={renderToolPermissions}
            />
          ) : (
            !memberPending && !policies.error && !connections.credentials.error && unavailable
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
