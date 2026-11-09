import { cn } from '@sim/emcn-legacy'
import hostBridge from '@sim/emcn-platform/styles/host-bridge.module.css'
import { createLogger } from '@sim/logger'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ImpersonationBanner } from '@/components/impersonation-banner'
import { SessionExpired } from '@/components/session-expired'
import { SettingsNavigationProvider } from '@/components/settings/settings-navigation-provider'
import { WorkspaceChrome, WorkspaceViewport } from '@/components/workspace-chrome'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { canUseBenchmarks } from '@/lib/benchmarks/config'
import { isChangelogEnabled } from '@/lib/changelog/feature-flag'
import { isComputerUseAvailable } from '@/lib/computer-use/availability.server'
import { FeatureFlagsProvider } from '@/lib/core/config/feature-flags-context'
import { isDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import { GlobalCommandsProvider } from '@/lib/global-commands/provider'
import { isMothershipModelSelectorEnabled } from '@/lib/mothership/feature-flags'
import { organizationRoutes } from '@/lib/navigation/paths'
import { OrganizationProvider } from '@/lib/organizations/provider'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { canBrowsePeople } from '@/lib/people/feature-flag'
import { isProjectsEnabled } from '@/lib/projects/rollout.server'
import { resolveSimLinkOrganization } from '@/lib/sim-links/application/organization'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'
import { isWorkflowTestsEnabled } from '@/lib/workflow-tests/feature-flag'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { OrganizationAccessDenied } from '@/app/o/[organizationId]/components/organization-access-denied'
import { OrganizationSimLinkProvider } from '@/app/o/[organizationId]/links/organization-sim-link-provider'
import { prefetchOrganizationSidebar } from '@/app/o/[organizationId]/prefetch'
import { getQueryClient } from '@/hooks/queries/utils/get-query-client'
import { Sidebar } from '@/platform/embedded/app/(shell)/_components/sidebar/sidebar'

const logger = createLogger('OrganizationLayout')

/**
 * The organization surface: the viewer's own view of one organization, outside
 * any workspace. Every member reaches it, personal organizations included;
 * features that need a plan gate themselves. Non-members get an explicit denial.
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
  const peopleEnabledLookup = canBrowsePeople(organizationId, context.viewer.role)
  const simLinksEnabledLookup = isSimLinksEnabled(organizationId)

  const [
    ,
    modelSelectorEnabled,
    dashboardsEnabled,
    benchmarkEnabled,
    computerUseEnabled,
    workflowTestsEnabled,
    changelogEnabled,
    projectsEnabled,
    simLinksEnabled,
    peopleEnabled,
    simLinkOrganizationId,
  ] = await Promise.all([
    prefetchOrganizationSidebar(
      queryClient,
      organizationId,
      { kind: 'session', userId: session.user.id, sessionId: session.session.id },
      getActiveOrganizationId(session)
    ),
    isMothershipModelSelectorEnabled(),
    isDashboardsEnabled(organizationId),
    canUseBenchmarks(session.user.id).catch(() => {
      logger.warn('Could not resolve benchmark navigation access')
      return false
    }),
    isComputerUseAvailable(organizationId),
    isWorkflowTestsEnabled(organizationId),
    isChangelogEnabled(organizationId),
    isProjectsEnabled(),
    simLinksEnabledLookup,
    peopleEnabledLookup,
    resolveSimLinkOrganization({
      kind: 'session',
      userId: session.user.id,
      sessionId: session.session.id,
    }),
  ])
  const initialSidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === '1'

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <FeatureFlagsProvider
        flags={{
          dashboards: dashboardsEnabled,
          'workflow-tests': workflowTestsEnabled,
          changelog: changelogEnabled,
          'mothership-model-selector': modelSelectorEnabled,
          'mothership-computer-use': computerUseEnabled,
          'mothership-plan-mode': benchmarkEnabled,
          'mothership-memory-spaces': benchmarkEnabled,
          projects: projectsEnabled,
        }}
      >
        <OrganizationProvider context={context}>
          <OrganizationSimLinkProvider organizationId={simLinkOrganizationId}>
            <GlobalCommandsProvider>
              <WorkspaceViewport
                className={cn('workspace-root', hostBridge.tokens, hostBridge.canvas)}
              >
                <ImpersonationBanner />
                <SessionExpired />
                <SettingsNavigationProvider>
                  <WorkspaceChrome
                    sidebarSurface='organization'
                    sidebar={
                      <Sidebar
                        benchmarkEnabled={benchmarkEnabled}
                        simLinksEnabled={simLinksEnabled}
                        peopleEnabled={peopleEnabled}
                      />
                    }
                    initialSidebarCollapsed={initialSidebarCollapsed}
                  >
                    {children}
                  </WorkspaceChrome>
                </SettingsNavigationProvider>
              </WorkspaceViewport>
            </GlobalCommandsProvider>
          </OrganizationSimLinkProvider>
        </OrganizationProvider>
      </FeatureFlagsProvider>
    </HydrationBoundary>
  )
}
