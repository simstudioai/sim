'use client'

import React from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/app/workspace/[workspaceId]/providers/theme-provider'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

interface ProvidersProps {
  children: React.ReactNode
}

const Providers = React.memo<ProvidersProps>(({ children }) => {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={100} skipDelayDuration={0}>
        <WorkspacePermissionsProvider>{children}</WorkspacePermissionsProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
})

Providers.displayName = 'Providers'

export default Providers
