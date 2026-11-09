import { HydrationBoundary } from '@tanstack/react-query'
import { notFound, redirect } from 'next/navigation'
import { IntegrationsRoute } from '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/integrations-route'
import { SearchConnectionRequest } from '@/app/(product)/o/[organizationId]/integrations/_components/search-connection-request/search-connection-request'
import { SlackSearchActions } from '@/app/(product)/o/[organizationId]/integrations/_components/slack-search-actions/slack-search-actions'
import { readIntegrationLinks } from '@/platform/lib/data/integration-links'
import { prefetchIntegrations } from '@/platform/lib/data/prefetch-integrations'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

interface LiveIntegrationsRouteProps {
  /** The `/integrations/[provider]` segment; absent on the index. */
  section?: string
  /** The index's query: a connection request, a Slack onboarding or a link from before providers had pages. */
  searchParams?: Record<string, string | string[] | undefined>
}

/** The member's own connections, the same page the organization surface embeds. */
export async function LiveIntegrationsRoute({ section, searchParams }: LiveIntegrationsRouteProps) {
  const surface = await readOrganizationSurface()
  // The layout already rendered this outcome's login, denial or error state.
  if (surface.status !== 'ok') return null
  const { organization } = surface
  if (!organization.searchAccess.memberScoped) notFound()
  const organizationId = organization.organization.id
  const links = searchParams && (await readIntegrationLinks(organization, searchParams))
  if (links?.kind === 'invalid') notFound()
  if (links?.kind === 'redirect') redirect(links.href)
  return (
    <HydrationBoundary state={await prefetchIntegrations(organization)}>
      <IntegrationsRoute
        organizationId={organizationId}
        section={section}
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
