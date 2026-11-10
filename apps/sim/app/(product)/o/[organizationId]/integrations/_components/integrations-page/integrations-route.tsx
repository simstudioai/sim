'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { FailureNotice } from '@sim/emcn/status'
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
import { LiveGroup } from '@/app/(product)/o/[organizationId]/integrations/_components/resource-list/resource-list'
import { SkillDetails } from '@/app/(product)/o/[organizationId]/integrations/_components/skill-details/skill-details'
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
import {
  findWorkspaceApp,
  type WorkspaceAppDetail,
} from '@/platform/lib/integrations/workspace-catalog'
import { GENERIC_SECRETS_SEGMENT } from '@/platform/shared/integrations'
import { compareText } from '@/platform/shared/time'

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
  const [{ q, order, tab, resource }] = useQueryStates(centerParams)
  const memberIntegrations = useMemberIntegrations(member ? organizationId : undefined)
  const { genericSecrets, inventory, policies, secrets } = memberIntegrations
  // A member integration the workspace catalog also lists takes the catalog app's id, so the app
  // lists once and its page, which the server canonicalizes to that id, finds both kinds of credential.
  const integrations = memberIntegrations.integrations.map((item) => {
    const app = findWorkspaceApp(workspaceScope.apps, item.id)
    return app && app.id !== item.id ? { ...item, id: app.id } : item
  })
  const actions = useIntegrationActions(organizationId, { enabled: member })
  const defaults = defaultIntegrationPaths(organizationId)
  const directory = useWorkspaceDirectory(defaults.index, workspaceScope, section ? null : tab)
  const { workspace, connections, view, mcps, skills, restrictions } = directory
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
      {[
        { query: inventory, message: 'Could not load your connections' },
        { query: policies, message: 'Could not load Search connections' },
        { query: secrets, message: 'Could not load secret connections' },
        { query: connections.credentials, message: 'Could not load workspace credentials' },
      ].map(
        ({ query, message }) =>
          query.error && (
            <FailureNotice
              key={message}
              message={message}
              retrying={query.isFetching}
              onRetry={() => void query.refetch()}
            />
          )
      )}
    </>
  )

  // A skill the URL opens waits for the permission group, so the index never shows first.
  if (!section && tab === 'skills' && resource && !restrictions.settled) return null

  if (!section && skills?.detail)
    return (
      <IntegrationsPage>
        <SkillDetails
          key={`${skills.detail.workspaceId}:${skills.detail.skillId ?? 'new'}`}
          workspaceId={skills.detail.workspaceId}
          skillId={skills.detail.skillId}
          backHref={skills.detailBackHref}
          onBack={skills.closeDetail}
          onCreated={skills.created}
        />
      </IntegrationsPage>
    )

  if (!section) {
    const term = q.trim().toLowerCase()
    const servers = (mcps?.servers ?? [])
      .filter((server) => `${server.name} ${server.description}`.toLowerCase().includes(term))
      .sort((a, b) => (order === 'asc' ? 1 : -1) * compareText(a.name, b.name))
    const skillsTab: LiveTab | undefined = skills && {
      actions: skills.canCreate && (
        <Button variant='secondary' size='compact' icon='I074' onClick={() => skills.open('new')}>
          Create skill
        </Button>
      ),
      content: skills.query.error ? (
        <FailureNotice
          message='Could not load skills'
          retrying={skills.query.isFetching}
          onRetry={() => void skills.query.refetch()}
        />
      ) : (
        <LiveGroup
          title='Shared'
          glyph='I044'
          rows={skills.rows}
          onOpen={(row) => skills.open(row.id)}
        />
      ),
      empty: !skills.rows.length && !skills.query.error,
      settled: skills.settled,
    }
    const mcpTab: LiveTab | undefined = mcps && {
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
        <FailureNotice
          message='Could not load MCP servers'
          retrying={mcps.query.isFetching}
          onRetry={() => void mcps.query.refetch()}
        />
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
    }
    return (
      <IntegrationsPage>
        <IntegrationsHeading handoff={handoff} />
        {connectionRequest}
        {failures}
        {memberSettled &&
          restrictions.settled &&
          (directory.settled || Boolean(connections.credentials.error)) && (
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
              skills={skillsTab}
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

  const restricted = !integration && workspace && workspaceDetail?.access === 'restricted'

  return (
    <>
      <IntegrationsPage back={back}>
        {failures}
        {memberSettled &&
          (restricted ? (
            <RestrictedIntegration app={workspaceDetail} workspaceId={workspace.id} />
          ) : integration || workspaceApp ? (
            <IntegrationDetails
              key={`${workspace?.id ?? ''}:${named?.id ?? ''}`}
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
          ) : (
            !memberPending &&
            !inventory.error &&
            !policies.error &&
            !connections.credentials.error &&
            unavailable
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
