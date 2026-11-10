'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { useLiveSkills } from '@/app/(product)/o/[organizationId]/integrations/_components/live-skills/live-skills'
import { useIntegrationsView } from '@/platform/lib/data/integrations'
import { useWorkspaceConnections } from '@/platform/lib/data/workspace-connections'
import { useWorkspaceMcpServers } from '@/platform/lib/data/workspace-mcps'
import { useWorkspaceRestrictions } from '@/platform/lib/data/workspace-settings/access'
import type { AppSummary, IntegrationTab } from '@/platform/lib/integrations/center-model'
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
 * its credentials, skills and MCP servers, the workspace every tab lists within, and the app whose
 * access request is open. What the viewer's permission group withholds (skills, MCP servers, the
 * workspace's secrets) is neither offered nor read, and each list is read only for the view that
 * shows it: `tab` is the index tab the URL asks for, `null` on an app's page. Data and actions; the
 * route renders them.
 */
export function useWorkspaceDirectory(
  indexPath: string,
  { workspaces, workspaceId, apps }: IntegrationsWorkspaceScope,
  tab: IntegrationTab | null
) {
  const params = useSearchParams()
  const view = useIntegrationsView()
  const [requested, setRequested] = useState<WorkspaceApp | null>(null)
  const workspace = workspaces.find((item) => item.id === workspaceId)
  const restrictions = useWorkspaceRestrictions(workspace?.id)
  const offersSkills = Boolean(workspace) && !restrictions.skills
  const offersMcps = Boolean(workspace) && !restrictions.mcp
  // The directory shows Apps in place of a tab it does not offer.
  const shown =
    (tab === 'skills' && !offersSkills) || (tab === 'mcps' && !offersMcps) ? 'apps' : tab
  const readsCredentials = shown !== 'skills' && shown !== 'mcps'
  const connections = useWorkspaceConnections(workspace?.id, readsCredentials)
  const skills = useLiveSkills(offersSkills ? workspace?.id : undefined)
  const mcps = useWorkspaceMcpServers(workspace?.id, offersMcps && shown === 'mcps')
  const credentials = connections.credentials.data
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
      description: app.description,
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
  const workspaceSecrets: AppSummary[] =
    workspace && !restrictions.secrets
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
    workspaces,
    view,
    connections,
    credentials,
    restrictions,
    /** The workspace's skills, absent where the Skills tab is not offered. */
    skills: offersSkills ? skills : undefined,
    /** The workspace's MCP servers, absent where the MCPs tab is not offered. */
    mcps: offersMcps ? mcps : undefined,
    appHref,
    keep,
    summaries,
    credentialLinks: [...workspaceSecrets, ...secretCredentials],
    /** Where a new workspace secret is created, which the Credentials tab's Create opens. */
    createCredentialHref:
      workspace && !restrictions.secrets
        ? workspacePath(workspace.id, 'settings/secrets')
        : undefined,
    /** Whether every list the view shows has been read, so an empty one is not claimed too early. */
    settled: !workspace || !readsCredentials || Boolean(credentials),
    requested,
    closeRequest: () => setRequested(null),
  }
}
