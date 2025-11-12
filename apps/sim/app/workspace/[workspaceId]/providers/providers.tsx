'use client'

import React from 'react'
import { Tooltip } from '@/components/emcn'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SettingsLoader } from './settings-loader'

interface ProvidersProps {
  children: React.ReactNode
}

const Providers = React.memo<ProvidersProps>(({ children }) => {
  return (
    <>
      <SettingsLoader />
      <GlobalCommandsProvider>
        <Tooltip.Provider delayDuration={600} skipDelayDuration={0}>
          <WorkspacePermissionsProvider>{children}</WorkspacePermissionsProvider>
        </Tooltip.Provider>
      </GlobalCommandsProvider>
    </>
  )
})

Providers.displayName = 'Providers'

export default Providers
