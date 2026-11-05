import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SettingsNavigationProvider } from '@/components/settings/settings-navigation-provider'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { resolveOrganizationSurface } from '@/lib/organizations/application/surface'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { canBrowsePeople } from '@/lib/people/feature-flag'
import { isPlatformOrgUiEnabled } from '@/lib/platform/rollout'
import { LEGACY_URL_HEADER, mapLegacyOrganizationUrl } from '@/lib/platform/routes'
import { resolveSimLinkOrganization } from '@/lib/sim-links/application/organization'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { RedesignNotices } from '@/app/o/[organizationId]/_redesign/notices'
import { Sidebar } from '@/app/o/[organizationId]/_redesign/rail/sidebar'
import { OrganizationAccessDenied } from '@/app/o/[organizationId]/components/organization-access-denied'
import { PlatformRouteGuard } from '@/app/o/[organizationId]/components/platform-route-guard'
import { SimLinkOrganizationProvider } from '@/app/o/[organizationId]/links/sim-link-organization-provider'
import { prefetchOrganizationSidebar } from '@/app/o/[organizationId]/prefetch'
import { OrganizationProvider } from '@/app/o/[organizationId]/providers/organization-provider'
import { ImpersonationBanner } from '@/app/workspace/[workspaceId]/components/impersonation-banner'
import { SessionExpired } from '@/app/workspace/[workspaceId]/components/session-expired'
import {
  WorkspaceChrome,
  WorkspaceViewport,
} from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { OrganizationProvider as PlatformOrganizationProvider } from '@/platform/lib/data/organization'

/**
 * The organization surface: the viewer's own view of one organization, outside
 * any workspace. Requires membership and an available organization chat surface.
 * Non-members get an explicit denial; members outside the rollout retain
 * workspace settings, including when following a saved organization link.
 */
export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: organizationRoutes(organizationId).root,
        isInviteFlow: false,
      })
    )
  }

  const queryClient = getQueryClient()
  const [context, cookieStore] = await Promise.all([
    getOrganizationSurfaceContext(organizationId, session.user.id),
    cookies(),
  ])
  if (!context) {
    return <OrganizationAccessDenied />
  }
  const platformOrgUi = await isPlatformOrgUiEnabled(organizationId)
  if (platformOrgUi) {
    const legacyUrl = (await headers()).get(LEGACY_URL_HEADER)
    const platformUrl = legacyUrl && mapLegacyOrganizationUrl(legacyUrl, organizationId)
    if (platformUrl) redirect(platformUrl)
  }
  const peopleEnabledLookup = canBrowsePeople(organizationId, context.viewer.role)
  const simLinksEnabledLookup = isSimLinksEnabled(organizationId)
  if (
    !context.mothershipAvailable &&
    !context.searchAccess.memberScoped &&
    !(await peopleEnabledLookup) &&
    !(await simLinksEnabledLookup)
  )
    redirect(WORKSPACE_SETTINGS_PATH)

  const [, surface, simLinkOrganizationId] = await Promise.all([
    prefetchOrganizationSidebar(
      queryClient,
      organizationId,
      { kind: 'session', userId: session.user.id, sessionId: session.session.id },
      getActiveOrganizationId(session)
    ),
    resolveOrganizationSurface(context, session.user.id),
    resolveSimLinkOrganization({
      kind: 'session',
      userId: session.user.id,
      sessionId: session.session.id,
    }),
  ])
  const initialSidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === '1'

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <FeatureFlagsProvider flags={surface.featureFlags}>
        <OrganizationProvider context={context}>
          <PlatformOrganizationProvider
            organization={{
              ...surface,
              legacyOrigin: '',
              routePrefix: organizationRoutes(organizationId).root,
            }}
          >
            <RedesignNotices>
              {platformOrgUi && (
                <Suspense fallback={null}>
                  <PlatformRouteGuard organizationId={organizationId} />
                </Suspense>
              )}
              <SimLinkOrganizationProvider organizationId={simLinkOrganizationId}>
                <GlobalCommandsProvider>
                  <WorkspaceViewport className='workspace-root'>
                    <ImpersonationBanner />
                    <SessionExpired />
                    <SettingsNavigationProvider>
                      <WorkspaceChrome
                        sidebar={
                          <Sidebar
                            benchmarkEnabled={surface.navFlags.benchmark}
                            simLinksEnabled={surface.navFlags.simLinks}
                            peopleEnabled={surface.navFlags.people}
                          />
                        }
                        initialSidebarCollapsed={initialSidebarCollapsed}
                      >
                        {children}
                      </WorkspaceChrome>
                    </SettingsNavigationProvider>
                  </WorkspaceViewport>
                </GlobalCommandsProvider>
              </SimLinkOrganizationProvider>
            </RedesignNotices>
          </PlatformOrganizationProvider>
        </OrganizationProvider>
      </FeatureFlagsProvider>
    </HydrationBoundary>
  )
}
