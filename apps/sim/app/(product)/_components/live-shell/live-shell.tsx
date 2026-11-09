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
import { hasOrganizationSurface, legacyRoutes } from '@/platform/lib/data/organization-model'
import { prefetchShell } from '@/platform/lib/data/prefetch-shell'
import { LiveProviders } from '@/platform/lib/data/providers'
import { resolveSettingsNavigation } from '@/platform/lib/data/settings-navigation'
import { legacyUrl, loginUrl, readOrganizationSurface } from '@/platform/lib/data/surface'

/**
 * The shell for a live session: the legacy organization layout's gates, in its order, against data
 * read over the API. Each gate decides before anything product-shaped renders.
 */
export async function LiveShell({ children }: { children: ReactNode }) {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') {
    if (surface.status === 'unauthenticated') {
      if (getSessionCookie(await headers())) return <StaleSession loginHref={loginUrl()} />
      redirect(loginUrl())
    }
    if (surface.status === 'denied')
      return <AccessDenied workspacesHref={legacyUrl('/workspace')} />
    return <SurfaceUnavailable />
  }

  const { organization } = surface
  const cookieStore = await cookies()
  if (!hasOrganizationSurface(organization)) redirect(legacyRoutes(organization).workspaceSettings)

  return (
    <LiveProviders
      organization={organization}
      navigation={{
        destinations: resolveLiveDestinations(organization),
        settingsNavigation: resolveSettingsNavigation(organization),
      }}
      dehydratedState={await prefetchShell(organization)}
    >
      <Suspense fallback={null}>
        <LiveComposerHost>
          <ProductSession
            fixtures={null}
            banner={<SessionState />}
            sidebarCollapsed={cookieStore.get('sidebar_collapsed')?.value === '1'}
          >
            {children}
          </ProductSession>
        </LiveComposerHost>
      </Suspense>
    </LiveProviders>
  )
}
