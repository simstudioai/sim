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
import {
  hasDesktopBackgroundExecutor,
  isDesktopBackgroundExecutorAvailable,
} from '@/lib/desktop/executor/availability'
import { isMothershipModelSelectorEnabled, isPlanModeEnabled } from '@/lib/mothership/feature-flags'
import { resolveOrganizationEntryPath } from '@/lib/navigation/resolve-app-entry'
import { isWorkflowTestsEnabled } from '@/lib/workflow-tests/feature-flag'
import { ApplicationLoading } from '@/app/_shell/application-loading'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
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
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspaceHostProvider } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { WorkspaceScopeSync } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import {
  getBrandConfig,
  mergeOrgBrandConfig,
  type OrganizationWhitelabelSettings,
} from '@/ee/whitelabeling'
import { BrandingProvider } from '@/ee/whitelabeling/components/branding-provider'
import { getOrgWhitelabelSettings } from '@/ee/whitelabeling/org-branding'

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
  orgSettings: Promise<OrganizationWhitelabelSettings | null>
}

interface WorkspaceLoadingProps {
  orgSettings: Promise<OrganizationWhitelabelSettings | null>
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

  const orgSettings = hostContext.hostOrganizationId
    ? getOrgWhitelabelSettings(hostContext.hostOrganizationId)
    : Promise.resolve(null)

  return (
    <Suspense fallback={<WorkspaceLoading orgSettings={orgSettings} />}>
      <WorkspaceContent
        workspaceId={workspaceId}
        session={session}
        queryClient={queryClient}
        hostContext={hostContext}
        orgSettings={orgSettings}
      >
        {children}
      </WorkspaceContent>
    </Suspense>
  )
}

async function WorkspaceLoading({ orgSettings }: WorkspaceLoadingProps) {
  const brand = mergeOrgBrandConfig(await orgSettings, getBrandConfig())
  return <ApplicationLoading brand={brand} />
}

async function WorkspaceContent({
  children,
  workspaceId,
  session,
  queryClient,
  hostContext,
  orgSettings,
}: WorkspaceContentProps) {
  const activeOrganizationId = getActiveOrganizationId(session)
  const principal = {
    kind: 'session',
    userId: session.user.id,
    sessionId: session.session.id,
  } as const
  const [
    cookieStore,
    initialOrgSettings,
    ,
    modelSelectorEnabled,
    planModeEnabled,
    organizationHref,
    dashboardsEnabled,
    workflowTestsEnabled,
    changelogEnabled,
    desktopExecutorRegistered,
  ] = await Promise.all([
    cookies(),
    orgSettings,
    prefetchWorkspaceSidebar(
      queryClient,
      workspaceId,
      session.user.id,
      hostContext,
      activeOrganizationId
    ),
    isMothershipModelSelectorEnabled(),
    isPlanModeEnabled(),
    resolveOrganizationEntryPath(session),
    isDashboardsEnabled(hostContext.hostOrganizationId),
    isWorkflowTestsEnabled(hostContext.hostOrganizationId),
    isChangelogEnabled(hostContext.hostOrganizationId),
    hasDesktopBackgroundExecutor(session.user.id),
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
          changelog: changelogEnabled,
          'mothership-model-selector': modelSelectorEnabled,
          'mothership-plan-mode': planModeEnabled,
        }}
      >
        <WorkspaceHostProvider workspaceId={workspaceId} initialContext={hostContext}>
          <BrandingProvider
            hostOrganizationId={hostContext.hostOrganizationId}
            viewerIsHostOrganizationMember={hostContext.viewer.isHostOrganizationMember}
            initialOrgSettings={initialOrgSettings}
          >
            <DesktopOAuthConnectListener />
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
                          desktopExecutor={{
                            available: isDesktopBackgroundExecutorAvailable(),
                            registered: desktopExecutorRegistered,
                          }}
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
          </BrandingProvider>
        </WorkspaceHostProvider>
      </FeatureFlagsProvider>
    </HydrationBoundary>
  )
}
