'use client'

import { EmptyState } from '@sim/emcn/empty-state'
import { useRouter, useSearchParams } from 'next/navigation'
import { IntegrationCenter } from '@/app/(product)/o/[organizationId]/integrations/_components/integration-center/integration-center'
import {
  IntegrationsHeading,
  IntegrationsPage,
} from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-page'
import {
  RestrictedIntegration,
  WorkspaceIntegrationDetails,
} from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integration-details/workspace-integration-details'
import {
  type IntegrationsWorkspaceScope,
  useWorkspaceDirectory,
} from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integrations/workspace-directory'
import { defaultIntegrationPaths } from '@/platform/lib/data/integrations'
import { integrationCenterHref } from '@/platform/lib/integrations/center-navigation'
import type { WorkspaceAppDetail } from '@/platform/lib/integrations/workspace-catalog'

interface WorkspaceIntegrationsProps extends IntegrationsWorkspaceScope {
  organizationId: string
  /** The `/integrations/[app]` page's app; absent on the index. */
  detail?: WorkspaceAppDetail
}

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
  const router = useRouter()
  const directory = useWorkspaceDirectory(organizationId, { workspaces, workspaceId, apps })
  const { workspace, view, connections } = directory
  const indexHref = directory.keep(
    integrationCenterHref(defaultIntegrationPaths(organizationId).index, params)
  )

  if (detail) {
    const integrationHref = directory.appHref(detail.id)
    return (
      <IntegrationsPage
        back={
          view.account
            ? { href: integrationHref, label: `Back to ${detail.name}` }
            : { href: indexHref, label: 'Integrations' }
        }
      >
        {directory.failure}
        {workspace && detail.access === 'restricted' ? (
          <RestrictedIntegration app={detail} workspaceId={workspace.id} />
        ) : workspace ? (
          <WorkspaceIntegrationDetails
            key={`${workspace.id}:${detail.id}`}
            app={detail}
            workspace={workspace}
            credentials={directory.credentials}
            accountId={view.account}
            integrationHref={integrationHref}
            onOpen={(account) =>
              router.push(view.serialize(integrationHref, { account }), { scroll: false })
            }
            pending={connections.pending}
            onDisconnect={async (credentialId) => {
              await connections.disconnect(credentialId)
              if (view.account === credentialId) view.clearAccount()
            }}
            onLeave={view.clearAccount}
          />
        ) : (
          <EmptyState title='Create a workspace to connect apps.' />
        )}
      </IntegrationsPage>
    )
  }

  if (directory.skills.detail) return <IntegrationsPage>{directory.skills.detail}</IntegrationsPage>

  return (
    <IntegrationsPage>
      <IntegrationsHeading />
      {directory.failure}
      <IntegrationCenter
        apps={directory.summaries}
        credentials={directory.credentialLinks}
        skills={directory.skills.tab}
        settled={directory.settled}
        appsEmptyDescription='Apps available in this workspace appear here.'
        scopeFilter={directory.scopeFilter}
      />
      {directory.requestDialog}
    </IntegrationsPage>
  )
}
