import { ToastProvider } from '@/components/emcn'
import { NavTour } from '@/app/workspace/[workspaceId]/components/product-tour'
import { ImpersonationBanner } from '@/app/workspace/[workspaceId]/impersonation-banner'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SettingsLoader />
      <ProviderModelsLoader />
      <GlobalCommandsProvider>
        <div className='flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
          <ImpersonationBanner />
          <WorkspacePermissionsProvider>
            <div className='flex min-h-0 flex-1'>
              <div className='shrink-0' suppressHydrationWarning>
                <Sidebar />
              </div>
              <div className='flex min-w-0 flex-1 flex-col p-[8px] pl-0'>
                <div className='flex-1 overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg)]'>
                  {children}
                </div>
              </div>
            </div>
            <NavTour />
          </WorkspacePermissionsProvider>
        </div>
      </GlobalCommandsProvider>
    </ToastProvider>
  )
}
