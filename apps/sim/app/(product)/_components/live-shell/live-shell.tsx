import { type ReactNode, Suspense } from 'react'
import { cookies } from 'next/headers'
import { loginHref } from '@/lib/navigation/paths'
import { resolveLiveDestinations } from '@/app/(product)/_components/destinations'
import { LiveComposerHost } from '@/app/(product)/_components/live-shell/live-composer-host'
import { StaleSession } from '@/app/(product)/_components/live-shell/stale-session'
import { ProductSession } from '@/app/(product)/_components/product-session'
import { SessionState } from '@/app/(product)/_components/session-state/session-state'
import { AccessDenied, SurfaceUnavailable } from '@/app/(product)/_components/shell-gate/shell-gate'
import { LiveSourceLinks } from '@/app/(product)/_components/source-row/live-source-links'
import { OUTSIDE_ORGANIZATION_HREF } from '@/platform/lib/data/organization-model'
import { prefetchShell } from '@/platform/lib/data/prefetch-shell'
import { LiveProviders } from '@/platform/lib/data/providers'
import { followProductRoute, readDocumentLocation } from '@/platform/lib/data/route-resolution'
import { resolveSettingsNavigation } from '@/platform/lib/data/settings-navigation'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

/**
 * The shell for a live session, in the organization this request's shell belongs to: the legacy
 * organization layout's gates, in its order, against data read in process. Each gate decides
 * before anything product-shaped renders. The page below streams inside the Suspense boundary, so a
 * redirect it raised would paint this shell first; the document's own route resolution
 * (`followProductRoute`) runs here instead, and answers with one HTTP redirect.
 */
export async function LiveShell({
  telemetry,
  children,
}: {
  /** The host's browser telemetry, which reads the session and query client this shell provides. */
  telemetry: ReactNode
  children: ReactNode
}) {
  const [surface, location, cookieStore] = await Promise.all([
    readOrganizationSurface(),
    readDocumentLocation(),
    cookies(),
  ])
  if (surface.status !== 'ok') {
    // The proxy sends a request with no session cookie to login, so this one's cookie is stale.
    if (surface.status === 'unauthenticated')
      return (
        <StaleSession
          loginHref={
            location
              ? loginHref(`${location.pathname}${location.query.size ? `?${location.query}` : ''}`)
              : '/login'
          }
        />
      )
    if (surface.status === 'denied')
      return <AccessDenied workspacesHref={OUTSIDE_ORGANIZATION_HREF} />
    return <SurfaceUnavailable />
  }

  const { organization } = surface
  const [, dehydratedState] = await Promise.all([
    location && followProductRoute(organization, location),
    prefetchShell(organization),
  ])

  return (
    <LiveProviders
      organization={organization}
      navigation={{
        destinations: resolveLiveDestinations(organization),
        settingsNavigation: resolveSettingsNavigation(organization),
      }}
      dehydratedState={dehydratedState}
    >
      {telemetry}
      <Suspense fallback={null}>
        <LiveComposerHost>
          <ProductSession
            routePrefix={organization.routePrefix}
            banner={<SessionState />}
            sidebarCollapsed={cookieStore.get('sidebar_collapsed')?.value === '1'}
          >
            <LiveSourceLinks>{children}</LiveSourceLinks>
          </ProductSession>
        </LiveComposerHost>
      </Suspense>
    </LiveProviders>
  )
}
