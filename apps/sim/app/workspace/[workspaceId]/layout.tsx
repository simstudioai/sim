'use client'

import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsLoader />
      <ProviderModelsLoader />
      <GlobalCommandsProvider>
        <div className='flex h-screen w-full bg-[var(--bg)]'>
          <WorkspacePermissionsProvider>
            <div className='shrink-0' suppressHydrationWarning>
              <Sidebar />
            </div>
            {children}
          </WorkspacePermissionsProvider>
        </div>
      </GlobalCommandsProvider>
    </>
  )
}
