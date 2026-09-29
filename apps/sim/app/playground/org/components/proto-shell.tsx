'use client'

import type { ReactNode } from 'react'
import { ProtoSidebar } from '@/app/playground/org/components/proto-sidebar'
import { WorkspaceChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'

export function ProtoShell({ children }: { children: ReactNode }) {
  return (
    <div className='workspace-root flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
      <WorkspaceChrome sidebar={<ProtoSidebar />}>{children}</WorkspaceChrome>
    </div>
  )
}
