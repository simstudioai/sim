'use client'

import { useState } from 'react'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { useRouter, useSearchParams } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { RequestAccessModal } from '@/app/(product)/_components/request-access-modal/request-access-modal'
import { useLiveSkills } from '@/app/(product)/o/[organizationId]/integrations/_components/live-skills/live-skills'
import { QueryFailure } from '@/app/(product)/o/[organizationId]/integrations/_components/query-failure/query-failure'
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
import { appCredentials, type WorkspaceApp } from '@/platform/lib/integrations/workspace-catalog'

/** Credential kinds that hold a pasted secret, which the Credentials tab lists beside the secrets. */
const SECRET_CREDENTIAL_TYPES: ReadonlySet<string> = new Set(['service_account', 'personal_token'])

export interface IntegrationsWorkspaceScope {
  workspaces: readonly { id: string; name: string }[]
  /** The workspace the server judged the apps for; absent when the viewer has none. */
  workspaceId: string | null
  apps: readonly WorkspaceApp[]
}

/**
 * One workspace's part of the Integrations directory: its apps as the access policy judged them,
 * its credentials and skills, the workspace every tab lists within, and the access request a
 * restricted app opens. Both the workspace page and the member page list it.
 */
export function useWorkspaceDirectory(
  organizationId: string,
  { workspaces, workspaceId, apps }: IntegrationsWorkspaceScope
) {
  const params = useSearchParams()
  const router = useRouter()
  const view = useWorkspaceIntegrationsView()
  const [requested, setRequested] = useState<WorkspaceApp | null>(null)
  const workspace = workspaces.find((item) => item.id === workspaceId)
  const connections = useWorkspaceConnections(workspace?.id)
  const skills = useLiveSkills(workspace?.id)
  const credentials = connections.credentials.data
  const indexPath = defaultIntegrationPaths(organizationId).index
  const keep = (href: string) => withIntegrationsWorkspace(href, workspace?.id ?? null)
  const appHref = (id: string) =>
    keep(integrationCenterHref(`${indexPath}/${encodeURIComponent(id)}`, params))

  const summaries: AppSummary[] = apps.map((app) => {
    if (app.access === 'restricted')
      return {
        id: app.id,
        providerId: app.id,
        href: appHref(app.id),
        name: app.name,
        description: app.description,
        category: app.category,
        connected: false,
        requestAccess: () => setRequested(app),
      }
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
      (item) =>
        item.access !== 'restricted' &&
        credential.providerId &&
        item.credentialProviders.includes(credential.providerId)
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

  return {
    workspace,
    view,
    connections,
    credentials,
    skills,
    appHref,
    keep,
    summaries,
    credentialLinks: [...workspaceSecrets, ...secretCredentials],
    failure: connections.credentials.error ? (
      <QueryFailure message='Could not load your connections' query={connections.credentials} />
    ) : null,
    settled: !workspace || Boolean(credentials),
    scopeFilter: workspace && (
      <ChoiceMenu
        label='Workspace'
        value={workspace.id}
        options={workspaces.map((item) => ({ label: item.name, value: item.id }))}
        onValueChange={view.chooseWorkspace}
      />
    ),
    requestDialog: requested && workspace && (
      <RequestAccessModal
        key={requested.id}
        scope={{ kind: 'workspace', workspaceId: workspace.id }}
        target={{ kind: 'integration', id: requested.type }}
        label={requested.name}
        onViewRequest={(requestId) =>
          router.push(
            workspacePath(workspace.id, `settings/requests?${new URLSearchParams({ requestId })}`)
          )
        }
        onClose={() => setRequested(null)}
      />
    ),
  }
}
