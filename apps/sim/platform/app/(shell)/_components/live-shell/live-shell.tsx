import { type ReactNode, Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AccessDenied, SurfaceUnavailable } from '@/platform/app/_components/shell-gate/shell-gate'
import { resolveLiveDestinations } from '@/platform/app/(shell)/_components/destinations'
import { LiveComposerHost } from '@/platform/app/(shell)/_components/live-shell/live-composer-host'
import { ProductSession } from '@/platform/app/(shell)/_components/product-session'
import { SessionState } from '@/platform/app/(shell)/_components/session-state/session-state'
import { resolveSettingsNavigation } from '@/platform/app/(shell)/_components/settings-navigation/destinations'
import { hasOrganizationSurface, legacyRoutes } from '@/platform/lib/data/organization-model'
import { prefetchShell } from '@/platform/lib/data/prefetch-shell'
import { LiveProviders } from '@/platform/lib/data/providers'
import { legacyUrl, loginUrl, readOrganizationSurface } from '@/platform/lib/data/surface'

/**
 * The shell for a live session: the legacy organization layout's gates, in its order, against data
 * read over the API. Each gate decides before anything product-shaped renders.
 */
export async function LiveShell({ children }: { children: ReactNode }) {
  const surface = await readOrganizationSurface()
  if (surface.status !== 'ok') {
    if (surface.status === 'unauthenticated') redirect(loginUrl())
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
