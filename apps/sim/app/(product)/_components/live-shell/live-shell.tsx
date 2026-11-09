import { type ReactNode, Suspense } from 'react'
import { getSessionCookie } from 'better-auth/cookies'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { resolveLiveDestinations } from '@/app/(product)/_components/destinations'
import { LiveComposerHost } from '@/app/(product)/_components/live-shell/live-composer-host'
import { StaleSession } from '@/app/(product)/_components/live-shell/stale-session'
import { ProductSession } from '@/app/(product)/_components/product-session'
import { SessionState } from '@/app/(product)/_components/session-state/session-state'
import { AccessDenied, SurfaceUnavailable } from '@/app/(product)/_components/shell-gate/shell-gate'
import { LiveSourceLinks } from '@/app/(product)/_components/source-row/live-source-links'
import { resolveEntryRedirect } from '@/platform/lib/data/landing'
import {
  OUTSIDE_ORGANIZATION_HREF,
  resolveSurfaceRedirect,
} from '@/platform/lib/data/organization-model'
import { prefetchShell } from '@/platform/lib/data/prefetch-shell'
import { LiveProviders } from '@/platform/lib/data/providers'
import { readEntrySearchPin } from '@/platform/lib/data/search-pin'
import { resolveSettingsNavigation } from '@/platform/lib/data/settings-navigation'
import { readShellLocation } from '@/platform/lib/data/shell-scope'
import { readOrganizationSurface } from '@/platform/lib/data/surface'

const LOGIN_PATH = '/login'

/**
 * The shell for a live session, in the organization this request's shell belongs to: the legacy
 * organization layout's gates, in its order, against data read in process. Each gate decides
 * before anything product-shaped renders.
 */
export async function LiveShell({
  telemetry,
  children,
}: {
  /** The host's browser telemetry, which reads the session and query client this shell provides. */
  telemetry: ReactNode
  children: ReactNode
}) {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') {
    if (surface.status === 'unauthenticated') {
      if (getSessionCookie(await headers())) return <StaleSession loginHref={LOGIN_PATH} />
      redirect(LOGIN_PATH)
    }
    if (surface.status === 'denied')
      return <AccessDenied workspacesHref={OUTSIDE_ORGANIZATION_HREF} />
    return <SurfaceUnavailable />
  }

  const { organization } = surface
  const cookieStore = await cookies()
  const location = await readShellLocation()
  const surfaceRedirect =
    resolveSurfaceRedirect(organization) ??
    resolveEntryRedirect(organization, location) ??
    (await readEntrySearchPin(organization, location))
  if (surfaceRedirect) redirect(surfaceRedirect)

  return (
    <LiveProviders
      organization={organization}
      navigation={{
        destinations: resolveLiveDestinations(organization),
        settingsNavigation: resolveSettingsNavigation(organization),
      }}
      dehydratedState={await prefetchShell(organization)}
    >
      {telemetry}
      <Suspense fallback={null}>
        <LiveComposerHost>
          <ProductSession
            fixtures={null}
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
