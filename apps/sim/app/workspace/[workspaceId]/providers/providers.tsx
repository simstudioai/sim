'use client'

import React from 'react'
import { Tooltip } from '@/components/emcn'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SettingsLoader } from './settings-loader'

interface ProvidersProps {
  children: React.ReactNode
}

const Providers = React.memo<ProvidersProps>(({ children }) => {
  return (
    <>
      <SettingsLoader />
      <Tooltip.Provider delayDuration={1000} skipDelayDuration={0}>
        <WorkspacePermissionsProvider>{children}</WorkspacePermissionsProvider>
      </Tooltip.Provider>
    </>
  )
})

Providers.displayName = 'Providers'

export default Providers
