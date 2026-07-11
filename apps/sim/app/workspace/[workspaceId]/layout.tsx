import { ToastProvider } from '@sim/emcn'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { ImpersonationBanner } from '@/app/workspace/[workspaceId]/components/impersonation-banner'
import { WorkspaceAccessDenied } from '@/app/workspace/[workspaceId]/components/workspace-access-denied'
import { WorkspaceChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import {
  prefetchWorkspaceHostContext,
  prefetchWorkspaceSidebar,
} from '@/app/workspace/[workspaceId]/prefetch'
import { CustomBlocksLoader } from '@/app/workspace/[workspaceId]/providers/custom-blocks-loader'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspaceHostProvider } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { WorkspaceScopeSync } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync'
import { BrandingProvider } from '@/ee/whitelabeling/components/branding-provider'
import { getOrgWhitelabelSettings } from '@/ee/whitelabeling/org-branding'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}) {
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

  const [cookieStore, initialOrgSettings] = await Promise.all([
    cookies(),
    hostContext.hostOrganizationId
      ? getOrgWhitelabelSettings(hostContext.hostOrganizationId)
      : Promise.resolve(null),
    prefetchWorkspaceSidebar(queryClient, workspaceId, session.user.id, hostContext),
  ])
  const initialSidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === '1'

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WorkspaceHostProvider workspaceId={workspaceId} initialContext={hostContext}>
        <BrandingProvider
          hostOrganizationId={hostContext.hostOrganizationId}
          viewerIsHostOrganizationMember={hostContext.viewer.isHostOrganizationMember}
          initialOrgSettings={initialOrgSettings}
        >
          <ToastProvider>
            <SettingsLoader />
            <ProviderModelsLoader />
            <CustomBlocksLoader />
            <GlobalCommandsProvider>
              <div className='flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
                <ImpersonationBanner />
                <WorkspacePermissionsProvider>
                  <WorkspaceScopeSync />
                  <WorkspaceChrome initialSidebarCollapsed={initialSidebarCollapsed}>
                    {children}
                  </WorkspaceChrome>
                </WorkspacePermissionsProvider>
              </div>
            </GlobalCommandsProvider>
          </ToastProvider>
        </BrandingProvider>
      </WorkspaceHostProvider>
    </HydrationBoundary>
  )
}
