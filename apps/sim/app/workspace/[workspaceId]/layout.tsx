import { cookies } from 'next/headers'
import { ToastProvider } from '@/components/emcn'
import { NavTour } from '@/app/workspace/[workspaceId]/components/product-tour'
import { ImpersonationBanner } from '@/app/workspace/[workspaceId]/impersonation-banner'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { WorkspaceScopeSync } from '@/app/workspace/[workspaceId]/providers/workspace-scope-sync'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import {
  BRAND_COOKIE_NAME,
  type BrandCache,
  BrandingProvider,
} from '@/ee/whitelabeling/components/branding-provider'

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  let initialCache: BrandCache | null = null
  try {
    const raw = cookieStore.get(BRAND_COOKIE_NAME)?.value
    if (raw) initialCache = JSON.parse(decodeURIComponent(raw))
  } catch {}

  return (
    <BrandingProvider initialCache={initialCache}>
      <ToastProvider>
        <SettingsLoader />
        <ProviderModelsLoader />
        <GlobalCommandsProvider>
          <div className='flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
            <ImpersonationBanner />
            <WorkspacePermissionsProvider>
              <WorkspaceScopeSync />
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
    </BrandingProvider>
  )
}
