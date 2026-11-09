import { HydrationBoundary } from '@tanstack/react-query'
import { notFound, redirect } from 'next/navigation'
import { IntegrationsRoute } from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-route'
import { SearchConnectionRequest } from '@/app/(product)/o/[organizationId]/integrations/_components/search-connection-request/search-connection-request'
import { SlackSearchActions } from '@/app/(product)/o/[organizationId]/integrations/_components/slack-search-actions/slack-search-actions'
import { readOrganizationSurface } from '@/platform/lib/data/surface'
import { resolveIntegrationsSection } from '@/platform/lib/data/workspace-integrations'

interface LiveIntegrationsRouteProps {
  /** The `/integrations/[provider]` segment; absent on the index. */
  section?: string
  /**
   * The page's query: the workspace every tab lists within and, on the index, a connection
   * request, a Slack onboarding or a link from before providers had pages.
   */
  searchParams: Record<string, string | string[] | undefined>
}

/** The member's own connections, where the organization keeps them, beside one workspace's. */
export async function LiveIntegrationsRoute({ section, searchParams }: LiveIntegrationsRouteProps) {
  const surface = await readOrganizationSurface()
  // The layout already rendered this outcome's login, denial or error state.
  if (surface.status !== 'ok') return null
  const { organization } = surface
  const resolved = await resolveIntegrationsSection(organization, section, searchParams)
  if (resolved.kind === 'notFound') notFound()
  if (resolved.kind === 'redirect') redirect(resolved.href)
  const organizationId = organization.organization.id
  const { links } = resolved
  return (
    <HydrationBoundary state={resolved.state}>
      <IntegrationsRoute
        organizationId={organizationId}
        member={resolved.member}
        section={section}
        workspace={{
          workspaces: resolved.workspaces,
          workspaceId: resolved.workspaceId,
          apps: resolved.apps,
        }}
        workspaceDetail={resolved.detail}
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
