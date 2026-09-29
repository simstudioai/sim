'use client'

import { ChipLink } from '@sim/emcn'
import { Changelog } from '@/app/playground/org/components/changelog'
import { ProjectSettings } from '@/app/playground/org/components/project-settings'
import { ProtoDashboard } from '@/app/playground/org/components/proto-dashboard'
import { ResourceSection } from '@/app/playground/org/components/resource-section'
import type { Workspace } from '@/app/playground/org/lib/mock-data'
import {
  protoRoutes,
  WORKSPACE_SECTIONS,
  type WorkspaceSection,
} from '@/app/playground/org/lib/routes'

interface WorkspaceViewProps {
  workspace: Workspace
  section: WorkspaceSection
}

/** Project page: title, section chips, and the section body. Chats live in the left sidebar. */
export function WorkspaceView({ workspace, section }: WorkspaceViewProps) {
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <header className='flex shrink-0 flex-col gap-3 px-6 pt-5'>
        <div className='flex items-start gap-3'>
          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <h1 className='text-[20px] text-[var(--text-primary)] leading-tight'>
              {workspace.name}
            </h1>
            <p className='text-[var(--text-muted)] text-small'>{workspace.description}</p>
          </div>
        </div>
        <nav
          aria-label='Workspace sections'
          className='-mx-1 flex items-center gap-1 overflow-x-auto border-[var(--border)] border-b px-1 pb-3'
        >
          {WORKSPACE_SECTIONS.map((item) => (
            <ChipLink
              key={item.id}
              href={protoRoutes.workspace(workspace.id, item.id)}
              active={section === item.id}
              leftIcon={item.icon}
              className='shrink-0'
            >
              {item.label}
            </ChipLink>
          ))}
        </nav>
      </header>
      <div className='min-h-0 flex-1'>
        <SectionBody workspace={workspace} section={section} />
      </div>
    </div>
  )
}

function SectionBody({ workspace, section }: WorkspaceViewProps) {
  switch (section) {
    case 'dashboard':
      return (
        <div className='flex h-full min-h-0 flex-col'>
          <ProtoDashboard workspace={workspace} />
        </div>
      )
    case 'changelog':
      return <Changelog workspace={workspace} />
    case 'settings':
      return <ProjectSettings workspace={workspace} />
    default:
      return <ResourceSection section={section} />
  }
}
