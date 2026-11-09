'use client'

import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { useSearchParams } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { IntegrationCenter } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-center/integration-center'
import {
  IntegrationsHeading,
  IntegrationsPage,
} from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-page'
import { useLiveSkills } from '@/app/(product)/o/[organizationId]/integrations/_components/live-skills/live-skills'
import { QueryFailure } from '@/app/(product)/o/[organizationId]/integrations/_components/query-failure/query-failure'
import { WorkspaceIntegrationDetails } from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integration-details/workspace-integration-details'
import { defaultIntegrationPaths } from '@/platform/lib/data/integrations'
import {
  useWorkspaceConnections,
  useWorkspaceIntegrationsView,
} from '@/platform/lib/data/workspace-connections'
import type { AppSummary } from '@/platform/lib/integrations/center-model'
import {
  integrationCenterHref,
  withIntegrationsWorkspace,
} from '@/platform/lib/integrations/center-navigation'
import {
  appCredentials,
  type WorkspaceApp,
  type WorkspaceAppDetail,
} from '@/platform/lib/integrations/workspace-catalog'

interface WorkspaceIntegrationsProps {
  organizationId: string
  workspaces: readonly { id: string; name: string }[]
  /** The workspace the server judged the apps for; absent when the viewer has none. */
  workspaceId: string | null
  apps: readonly WorkspaceApp[]
  /** The `/integrations/[app]` page's app; absent on the index. */
  detail?: WorkspaceAppDetail
}

/** Credential kinds that hold a pasted secret, which the Credentials tab lists beside the secrets. */
const SECRET_CREDENTIAL_TYPES: ReadonlySet<string> = new Set(['service_account', 'personal_token'])

/**
 * The Integrations page of an organization without member-scoped accounts: one workspace's apps,
 * credentials and skills at a time, as legacy's workspace Integrations and Skills pages served them,
 * over the same workspace credential and skill operations.
 */
export function WorkspaceIntegrations({
  organizationId,
  workspaces,
  workspaceId,
  apps,
  detail,
}: WorkspaceIntegrationsProps) {
  const params = useSearchParams()
  const view = useWorkspaceIntegrationsView()
  const workspace = workspaces.find((item) => item.id === workspaceId)
  const connections = useWorkspaceConnections(workspace?.id)
  const skills = useLiveSkills(workspace?.id)
  const credentials = connections.credentials.data
  const indexPath = defaultIntegrationPaths(organizationId).index
  const keep = (href: string) => withIntegrationsWorkspace(href, workspace?.id ?? null)
  const appHref = (id: string) =>
    keep(integrationCenterHref(`${indexPath}/${encodeURIComponent(id)}`, params))
  const indexHref = keep(integrationCenterHref(indexPath, params))
  const failure = connections.credentials.error ? (
    <QueryFailure message='Could not load your connections' query={connections.credentials} />
  ) : null

  if (detail) {
    const integrationHref = appHref(detail.id)
    return (
      <IntegrationsPage
        back={
          view.account
            ? { href: integrationHref, label: `Back to ${detail.name}` }
            : { href: indexHref, label: 'Integrations' }
        }
      >
        {failure}
        {workspace ? (
          <WorkspaceIntegrationDetails
            key={`${workspace.id}:${detail.id}`}
            app={detail}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            credentials={credentials}
            accountId={view.account}
            integrationHref={integrationHref}
            accountHref={(account) => view.serialize(integrationHref, { account })}
            pending={connections.pending}
            onDisconnect={async (credentialId) => {
              await connections.disconnect(credentialId)
              if (view.account === credentialId) view.clearAccount()
            }}
          />
        ) : (
          <EmptyState title='Create a workspace to connect apps.' />
        )}
      </IntegrationsPage>
    )
  }

  if (skills.detail) return <IntegrationsPage>{skills.detail}</IntegrationsPage>

  const summaries: AppSummary[] = apps.map((app) => {
    const connected = credentials ? appCredentials(app, credentials) : []
    return {
      id: app.id,
      providerId: app.id,
      href: appHref(app.id),
      name: app.name,
      description:
        app.access === 'unconfigured'
          ? 'Unavailable in this deployment. Contact your administrator.'
          : app.description,
      category: app.category,
      connected: connected.length > 0,
      credentialCount: connected.length,
      searchable: connected.map((credential) => credential.displayName).join(' '),
    }
  })
  const secretCredentials: AppSummary[] = (credentials ?? []).flatMap((credential) => {
    if (!SECRET_CREDENTIAL_TYPES.has(credential.type)) return []
    const app = apps.find(
      (item) => credential.providerId && item.credentialProviders.includes(credential.providerId)
    )
    if (!app) return []
    return [
      {
        id: credential.id,
        providerId: app.id,
        href: view.serialize(appHref(app.id), { account: credential.id }),
        name: credential.displayName,
        description: credential.description || app.name,
        category: app.category,
        connected: true,
        scope: credential.type === 'personal_token' ? 'personal' : 'shared',
      },
    ]
  })
  const workspaceSecrets: AppSummary[] = workspace
    ? [
        {
          id: 'workspace-secrets',
          href: workspacePath(workspace.id, 'settings/secrets'),
          name: 'Secrets',
          description: `Workspace and personal secrets in ${workspace.name}`,
          category: 'Credentials',
          connected: true,
          scope: 'shared',
        },
      ]
    : []

  return (
    <IntegrationsPage>
      <IntegrationsHeading />
      {failure}
      <IntegrationCenter
        apps={summaries}
        credentials={[...workspaceSecrets, ...secretCredentials]}
        skills={skills.tab}
        settled={!workspace || Boolean(credentials)}
        appsEmptyDescription='Apps available in this workspace appear here.'
        scopeFilter={
          workspace && (
            <ChoiceMenu
              label='Workspace'
              value={workspace.id}
              options={workspaces.map((item) => ({ label: item.name, value: item.id }))}
              onValueChange={view.chooseWorkspace}
            />
          )
        }
      />
    </IntegrationsPage>
  )
}
