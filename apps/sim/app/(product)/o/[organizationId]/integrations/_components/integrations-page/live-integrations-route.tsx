import { HydrationBoundary } from '@tanstack/react-query'
import { notFound, redirect } from 'next/navigation'
import { IntegrationsRoute } from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-route'
import { SearchConnectionRequest } from '@/app/(product)/o/[organizationId]/integrations/_components/search-connection-request/search-connection-request'
import { SlackSearchActions } from '@/app/(product)/o/[organizationId]/integrations/_components/slack-search-actions/slack-search-actions'
import { LiveWorkspaceIntegrationsRoute } from '@/app/(product)/o/[organizationId]/integrations/_components/workspace-integrations/live-workspace-integrations-route'
import { readIntegrationLinks } from '@/platform/lib/data/integration-links'
import { integrationsMode } from '@/platform/lib/data/integrations-mode'
import { prefetchIntegrations } from '@/platform/lib/data/prefetch-integrations'
import { readOrganizationSurface } from '@/platform/lib/data/surface'
import {
  appPagePath,
  findWorkspaceApp,
  readIntegrationsWorkspaceScope,
  toAppSummaries,
} from '@/platform/lib/data/workspace-integrations'

interface LiveIntegrationsRouteProps {
  /** The `/integrations/[provider]` segment; absent on the index. */
  section?: string
  /**
   * The page's query: on the index, a connection request, a Slack onboarding or a link from before
   * providers had pages; on any page, the workspace an organization without member accounts lists.
   */
  searchParams?: Record<string, string | string[] | undefined>
}

/**
 * The member's own connections beside one workspace's catalog, credentials and skills; an
 * organization without member-scoped accounts serves only the workspace's.
 */
export async function LiveIntegrationsRoute({ section, searchParams }: LiveIntegrationsRouteProps) {
  const surface = await readOrganizationSurface()
  // The layout already rendered this outcome's login, denial or error state.
  if (surface.status !== 'ok') return null
  const { organization } = surface
  if (integrationsMode(organization) === 'workspace')
    return (
      <LiveWorkspaceIntegrationsRoute
        organization={organization}
        section={section}
        searchParams={searchParams}
      />
    )
  const organizationId = organization.organization.id
  // Links name the index; a provider page reads only its own view state.
  const links =
    section || !searchParams ? undefined : await readIntegrationLinks(organization, searchParams)
  if (links?.kind === 'invalid') notFound()
  if (links?.kind === 'redirect') redirect(links.href)
  const [{ workspaces, workspace, apps }, state] = await Promise.all([
    readIntegrationsWorkspaceScope(organizationId, searchParams?.workspace),
    prefetchIntegrations(organization),
  ])
  const workspaceDetail = section ? findWorkspaceApp(apps, section) : undefined
  // A legacy link names an app by its kebab-case slug; member segments never take that form.
  if (workspaceDetail && section === workspaceDetail.slug && section !== workspaceDetail.id)
    redirect(appPagePath(organization, workspaceDetail.id, searchParams))
  return (
    <HydrationBoundary state={state}>
      <IntegrationsRoute
        organizationId={organizationId}
        section={section}
        workspace={{ workspaces, workspaceId: workspace?.id ?? null, apps: toAppSummaries(apps) }}
        workspaceDetail={workspaceDetail}
        connectionRequest={
          links?.connectionTarget && (
            <SearchConnectionRequest
              key={JSON.stringify([links.userId, links.connectionTarget])}
              organizationId={organizationId}
              userId={links.userId}
              target={links.connectionTarget}
            />
          )
        }
        handoff={
          links?.slackToken && (
            <SlackSearchActions
              organizationId={organizationId}
              token={links.slackToken}
              userId={links.userId}
            />
          )
        }
      />
    </HydrationBoundary>
  )
}
