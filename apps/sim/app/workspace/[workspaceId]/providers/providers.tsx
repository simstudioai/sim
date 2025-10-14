'use client'

import React from 'react'
import { TooltipProvider } from '@/components/emcn'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SettingsLoader } from './settings-loader'

interface ProvidersProps {
  children: React.ReactNode
}

const Providers = React.memo<ProvidersProps>(({ children }) => {
  return (
    <>
      <SettingsLoader />
      <TooltipProvider delayDuration={1000} skipDelayDuration={0}>
        <WorkspacePermissionsProvider>{children}</WorkspacePermissionsProvider>
      </TooltipProvider>
    </>
  )
})

Providers.displayName = 'Providers'

export default Providers
