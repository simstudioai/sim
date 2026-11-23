import { Suspense } from 'react'
import { dehydrate, HydrationBoundary, type QueryClient } from '@tanstack/react-query'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SettingsNavigationProvider } from '@/components/settings/settings-navigation-provider'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { isChangelogEnabled } from '@/lib/changelog/feature-flag'
import { isDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import { hasDesktopBackgroundExecutor } from '@/lib/desktop/executor/availability'
import { isMothershipModelSelectorEnabled, isPlanModeEnabled } from '@/lib/mothership/feature-flags'
import { resolveOrganizationEntryPath } from '@/lib/navigation/resolve-app-entry'
import { isProjectsEnabled } from '@/lib/projects/rollout.server'
import { resolveSimLinkOrganization } from '@/lib/sim-links/application/organization'
import { isWorkflowTestsEnabled } from '@/lib/workflow-tests/feature-flag'
import { isWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { ApplicationLoading } from '@/app/_shell/application-loading'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { SimLinkOrganizationProvider } from '@/app/o/[organizationId]/links/sim-link-organization-provider'
import { ImpersonationBanner } from '@/app/workspace/[workspaceId]/components/impersonation-banner'
import { SessionExpired } from '@/app/workspace/[workspaceId]/components/session-expired'
import { WorkspaceAccessDenied } from '@/app/workspace/[workspaceId]/components/workspace-access-denied'
import {
  WorkspaceChrome,
  WorkspaceViewport,
} from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import {
  prefetchWorkspaceForkAvailability,
  prefetchWorkspaceHostContext,
  prefetchWorkspaceSidebar,
} from '@/app/workspace/[workspaceId]/prefetch'
import { prefetchWorkspaceAccess } from '@/app/workspace/[workspaceId]/prefetch-access'
import { BlockVisibilityLoader } from '@/app/workspace/[workspaceId]/providers/block-visibility-loader'
import { CustomBlocksLoader } from '@/app/workspace/[workspaceId]/providers/custom-blocks-loader'
import { DesktopOAuthConnectListener } from '@/app/workspace/[workspaceId]/providers/desktop-oauth-connect-listener'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { InFlightUploadGuard } from '@/app/workspace/[workspaceId]/providers/in-flight-upload-guard'
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspaceHostProvider } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { WorkspaceScopeSync } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'

interface WorkspaceLayoutProps {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}

interface WorkspaceContentProps {
  children: React.ReactNode
  workspaceId: string
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>
  queryClient: QueryClient
  hostContext: WorkspaceHostContext
}

export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const session = await getSession()
  if (!session?.user) {
    redirect('/login')
  }

  const { workspaceId } = await params
  const queryClient = getQueryClient()
  const hostContext = await prefetchWorkspaceHostContext(queryClient, workspaceId, session.user.id)
  if (!hostContext) {
    return <WorkspaceAccessDenied />
  }

  return (
    <Suspense fallback={<ApplicationLoading />}>
      <WorkspaceContent
        workspaceId={workspaceId}
        session={session}
        queryClient={queryClient}
        hostContext={hostContext}
      >
        {children}
      </WorkspaceContent>
    </Suspense>
  )
}

async function WorkspaceContent({
  children,
  workspaceId,
  session,
  queryClient,
  hostContext,
}: WorkspaceContentProps) {
  const activeOrganizationId = getActiveOrganizationId(session)
  const principal = {
    kind: 'session',
    userId: session.user.id,
    sessionId: session.session.id,
  } as const
  const [
    cookieStore,
    ,
    modelSelectorEnabled,
    planModeEnabled,
    organizationHref,
    dashboardsEnabled,
    workflowTestsEnabled,
    workflowCodeEnabled,
    changelogEnabled,
    desktopExecutorRegistered,
    projectsEnabled,
    simLinkOrganizationId,
  ] = await Promise.all([
    cookies(),
    prefetchWorkspaceSidebar(
      queryClient,
      workspaceId,
      session.user.id,
      hostContext,
      activeOrganizationId
    ),
    isMothershipModelSelectorEnabled(),
    isPlanModeEnabled(session.user.id).catch(() => false),
    resolveOrganizationEntryPath(session),
    isDashboardsEnabled(hostContext.hostOrganizationId),
    isWorkflowTestsEnabled(hostContext.hostOrganizationId),
    isWorkflowCodeEnabled({
      orgId: hostContext.hostOrganizationId,
      workspaceId,
      userId: session.user.id,
    }),
    isChangelogEnabled(hostContext.hostOrganizationId),
    hasDesktopBackgroundExecutor(session.user.id),
    isProjectsEnabled(),
    resolveSimLinkOrganization(principal),
    prefetchWorkspaceAccess(queryClient, workspaceId, principal),
    prefetchWorkspaceForkAvailability(queryClient, workspaceId, principal, hostContext),
  ])
  const initialSidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === '1'

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <FeatureFlagsProvider
        flags={{
          dashboards: dashboardsEnabled,
          'workflow-tests': workflowTestsEnabled,
          'workflow-code': workflowCodeEnabled,
          changelog: changelogEnabled,
          'mothership-model-selector': modelSelectorEnabled,
          'mothership-plan-mode': planModeEnabled,
          projects: projectsEnabled,
        }}
      >
        <WorkspaceHostProvider workspaceId={workspaceId} initialContext={hostContext}>
          <SimLinkOrganizationProvider organizationId={simLinkOrganizationId}>
            <DesktopOAuthConnectListener />
            <InFlightUploadGuard />
            <SettingsLoader />
            <ProviderModelsLoader />
            <CustomBlocksLoader />
            <BlockVisibilityLoader />
            <GlobalCommandsProvider>
              <WorkspaceViewport>
                <ImpersonationBanner />
                <SessionExpired />
                <WorkspacePermissionsProvider>
                  <WorkspaceScopeSync />
                  <SettingsNavigationProvider>
                    <WorkspaceChrome
                      sidebar={
                        <Sidebar
                          organizationHref={organizationHref}
                          desktopExecutorRegistered={desktopExecutorRegistered}
                        />
                      }
                      initialSidebarCollapsed={initialSidebarCollapsed}
                    >
                      {children}
                    </WorkspaceChrome>
                  </SettingsNavigationProvider>
                </WorkspacePermissionsProvider>
              </WorkspaceViewport>
            </GlobalCommandsProvider>
          </SimLinkOrganizationProvider>
        </WorkspaceHostProvider>
      </FeatureFlagsProvider>
    </HydrationBoundary>
  )
}
