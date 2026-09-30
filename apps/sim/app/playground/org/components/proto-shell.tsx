'use client'

import type { ReactNode } from 'react'
import { ProtoSidebar } from '@/app/playground/org/components/proto-sidebar'
import { fixtureProjectSources } from '@/app/playground/org/fixtures'
import { ProjectSourcesProvider } from '@/app/playground/org/lib/project-sources'
import { WorkspaceChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'

/** The playground shell: the org sidebar, with the fixture packs as the project sources. */
export function ProtoShell({ children }: { children: ReactNode }) {
  return (
    <ProjectSourcesProvider sources={fixtureProjectSources}>
      <div className='workspace-root flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
        <WorkspaceChrome sidebar={<ProtoSidebar />}>{children}</WorkspaceChrome>
      </div>
    </ProjectSourcesProvider>
  )
}
