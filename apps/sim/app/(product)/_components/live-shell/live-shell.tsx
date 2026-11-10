import { type ReactNode, Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { loginHref, WORKSPACES_PATH } from '@/lib/navigation/paths'
import { resolveLiveDestinations } from '@/app/(product)/_components/destinations'
import { LiveComposerHost } from '@/app/(product)/_components/live-shell/live-composer-host'
import { StaleSession } from '@/app/(product)/_components/live-shell/stale-session'
import { ProductSession } from '@/app/(product)/_components/product-session'
import { LiveSourceLinks } from '@/app/(product)/_components/search/live-source-links'
import { SessionState } from '@/app/(product)/_components/session-state/session-state'
import { AccessDenied, SurfaceUnavailable } from '@/app/(product)/_components/shell-gate/shell-gate'
import { prefetchShell } from '@/platform/lib/data/prefetch-shell'
import { LiveProviders } from '@/platform/lib/data/providers'
import {
  followProductRoute,
  type ProductLocation,
  readDocumentLocation,
} from '@/platform/lib/data/route-resolution'
import { resolveSettingsNavigation } from '@/platform/lib/data/settings-navigation'
import {
  readLandingOrganizationSurface,
  readOrganizationSurface,
} from '@/platform/lib/data/surface'

/**
 * The same page in the viewer's landing organization, for an `/o/<id>` link whose organization no
 * longer exists: a personal organization retires when its owner joins a team, and its chats and
 * settings move with them. `null` when the location is not under an organization or the viewer
 * lands nowhere.
 */
async function retiredOrganizationHref({
  pathname,
  query,
}: ProductLocation): Promise<string | null> {
  const [, root, , ...rest] = pathname.split('/')
  if (root !== 'o') return null
  const landing = await readLandingOrganizationSurface()
  if (landing.status !== 'ok') return null
  const path = [landing.organization.routePrefix, ...rest].join('/')
  return query.size ? `${path}?${query}` : path
}

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
    if (surface.status === 'denied') {
      const moved = surface.retired && location ? await retiredOrganizationHref(location) : null
      if (moved) redirect(moved)
      return <AccessDenied workspacesHref={WORKSPACES_PATH} />
    }
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
