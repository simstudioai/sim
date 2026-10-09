import { createLogger } from '@sim/logger'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SettingsNavigationProvider } from '@/components/settings/settings-navigation-provider'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { canUseBenchmarks } from '@/lib/benchmarks/config'
import { isComputerUseAvailable } from '@/lib/computer-use/availability.server'
import { isDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import { isMothershipModelSelectorEnabled } from '@/lib/mothership/feature-flags'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { isWorkflowTestsEnabled } from '@/lib/workflow-tests/feature-flag'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { OrganizationAccessDenied } from '@/app/o/[organizationId]/components/organization-access-denied'
import { OrganizationSidebar } from '@/app/o/[organizationId]/components/organization-sidebar'
import { prefetchOrganizationSidebar } from '@/app/o/[organizationId]/prefetch'
import { OrganizationProvider } from '@/app/o/[organizationId]/providers/organization-provider'
import { ImpersonationBanner } from '@/app/workspace/[workspaceId]/components/impersonation-banner'
import { SessionExpired } from '@/app/workspace/[workspaceId]/components/session-expired'
import { WorkspaceChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'

const logger = createLogger('OrganizationLayout')

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
  if (!context.mothershipAvailable && !context.searchAccess.memberScoped)
    redirect(WORKSPACE_SETTINGS_PATH)

  const [
    ,
    modelSelectorEnabled,
    dashboardsEnabled,
    benchmarkEnabled,
    computerUseEnabled,
    workflowTestsEnabled,
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
    isComputerUseAvailable(),
    isWorkflowTestsEnabled(organizationId),
  ])
  const initialSidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === '1'

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <FeatureFlagsProvider
        flags={{
          dashboards: dashboardsEnabled,
          'workflow-tests': workflowTestsEnabled,
          'mothership-model-selector': modelSelectorEnabled,
          'mothership-computer-use': computerUseEnabled,
          'mothership-plan-mode': benchmarkEnabled,
          'mothership-memory-spaces': benchmarkEnabled,
        }}
      >
        <OrganizationProvider context={context}>
          <GlobalCommandsProvider>
            <div className='workspace-root flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
              <ImpersonationBanner />
              <SessionExpired />
              <SettingsNavigationProvider>
                <WorkspaceChrome
                  sidebar={<OrganizationSidebar benchmarkEnabled={benchmarkEnabled} />}
                  initialSidebarCollapsed={initialSidebarCollapsed}
                >
                  {children}
                </WorkspaceChrome>
              </SettingsNavigationProvider>
            </div>
          </GlobalCommandsProvider>
        </OrganizationProvider>
      </FeatureFlagsProvider>
    </HydrationBoundary>
  )
}
