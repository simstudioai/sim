'use client'

import { Tooltip } from '@/components/emcn'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { ProviderModelsLoader } from '@/app/workspace/[workspaceId]/providers/provider-models-loader'
import { SettingsLoader } from '@/app/workspace/[workspaceId]/providers/settings-loader'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SidebarNew } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar-new'

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsLoader />
      <ProviderModelsLoader />
      <GlobalCommandsProvider>
        <Tooltip.Provider delayDuration={600} skipDelayDuration={0}>
          <WorkspacePermissionsProvider>
            <div className='flex min-h-screen w-full'>
              <SidebarNew />
              <div className='flex flex-1 flex-col'>{children}</div>
            </div>
          </WorkspacePermissionsProvider>
        </Tooltip.Provider>
      </GlobalCommandsProvider>
    </>
  )
}
