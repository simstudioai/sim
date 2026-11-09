import type { ReactNode } from 'react'
import {
  IntegrationCenter,
  type LiveTab,
} from '@/app/(product)/o/[organizationId]/integrations/_components/integration-center/integration-center'
import type { AppSummary } from '@/platform/lib/integrations/center-model'
import type { GenericSecrets, OrganizationIntegration } from '@/platform/shared/integrations'

interface IntegrationListProps {
  integrations: readonly OrganizationIntegration[]
  /**
   * The chosen workspace's catalog, as its access policy judged it. An app the member also
   * connects for Search lists once, counting both kinds of credential.
   */
  workspaceApps: readonly AppSummary[]
  /** The workspace's secrets and pasted-secret credentials, for the Credentials tab. */
  workspaceCredentials: readonly AppSummary[]
  secrets: GenericSecrets | null
  integrationHref: (id: string) => string
  secretsHref: string
  /** False while a read could still add rows, so an empty list is not claimed too early. */
  settled: boolean
  /** The workspace's skills. */
  skills?: LiveTab
  /** The workspace's custom MCP servers. */
  mcps?: LiveTab
  /** Where the workspace's Credentials tab creates a credential. */
  createCredentialHref?: string
  /** The workspace every tab lists within. */
  scopeFilter?: ReactNode
}

export function IntegrationList({
  integrations,
  workspaceApps,
  workspaceCredentials,
  secrets,
  integrationHref,
  secretsHref,
  settled,
  skills,
  mcps,
  createCredentialHref,
  scopeFilter,
}: IntegrationListProps) {
  const workspaceById = new Map(workspaceApps.map((app) => [app.id, app]))
  const memberApps: AppSummary[] = integrations.map((item) => {
    const workspaceApp = workspaceById.get(item.id)
    const credentialCount = item.accounts.length + (workspaceApp?.credentialCount ?? 0)
    return {
      id: item.id,
      providerId: item.providerId,
      icon: item.icon,
      href: integrationHref(item.id),
      name: item.name,
      description: item.description,
      category: item.category,
      connected: credentialCount > 0,
      credentialCount,
      searchable: [
        item.providerId,
        ...item.accounts.map((account) => account.label),
        workspaceApp?.searchable ?? '',
      ].join(' '),
    }
  })
  const memberIds = new Set(integrations.map((item) => item.id))
  const apps = [...memberApps, ...workspaceApps.filter((app) => !memberIds.has(app.id))]
  const credentials: AppSummary[] = [
    ...(secrets
      ? [
          {
            id: 'generic-secrets',
            href: secretsHref,
            name: secrets.name,
            description: secrets.description,
            category: 'Credentials',
            scope: secrets.mode === 'organization' ? ('shared' as const) : ('personal' as const),
            connected: secrets.mode === 'organization',
          },
        ]
      : []),
    ...workspaceCredentials,
  ]
  return (
    <IntegrationCenter
      apps={apps}
      credentials={credentials}
      skills={skills}
      mcps={mcps}
      createCredentialHref={createCredentialHref}
      settled={settled}
      scopeFilter={scopeFilter}
    />
  )
}
