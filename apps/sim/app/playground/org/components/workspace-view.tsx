'use client'

import { cn } from '@sim/emcn'
import Link from 'next/link'
import { Changelog } from '@/app/playground/org/components/changelog'
import { IssuesList } from '@/app/playground/org/components/issues-list'
import { ProjectSettings } from '@/app/playground/org/components/project-settings'
import { ProtoDashboard } from '@/app/playground/org/components/proto-dashboard'
import { ResourceSection } from '@/app/playground/org/components/resource-section'
import type { Workspace } from '@/app/playground/org/lib/mock-data'
import {
  protoRoutes,
  WORKSPACE_SECTIONS,
  type WorkspaceSection,
} from '@/app/playground/org/lib/routes'
import { DEFAULT_SETTINGS_SECTION } from '@/app/playground/org/lib/settings-nav'

interface WorkspaceViewProps {
  workspace: Workspace
  section: WorkspaceSection
  settingsSection?: string
}

/** The project page: name, then every section as a tab, dashboard first. */
export function WorkspaceView({ workspace, section, settingsSection }: WorkspaceViewProps) {
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <header className='flex shrink-0 flex-col gap-3 px-6 pt-5'>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <h1 className='text-[20px] text-[var(--text-primary)] leading-tight'>{workspace.name}</h1>
          <p className='text-[var(--text-muted)] text-small'>{workspace.description}</p>
        </div>
        <nav
          aria-label='Project sections'
          className='flex items-center gap-6 border-[var(--border)] border-b'
        >
          {WORKSPACE_SECTIONS.map((item) => {
            const active = section === item.id
            return (
              <Link
                key={item.id}
                href={protoRoutes.workspace(workspace.id, item.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px shrink-0 border-b-2 pb-2.5 text-small transition-colors',
                  active
                    ? 'border-[var(--text-primary)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-muted)] hover-hover:text-[var(--text-body)]'
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </header>
      <div className='min-h-0 flex-1'>
        <SectionBody workspace={workspace} section={section} settingsSection={settingsSection} />
      </div>
    </div>
  )
}

interface SectionBodyProps {
  workspace: Workspace
  section: WorkspaceSection
  settingsSection?: string
}

function SectionBody({ workspace, section, settingsSection }: SectionBodyProps) {
  switch (section) {
    case 'dashboard':
      return (
        <div className='flex h-full min-h-0 flex-col'>
          <ProtoDashboard workspace={workspace} />
        </div>
      )
    case 'changelog':
      return <Changelog workspace={workspace} />
    case 'issues':
      return <IssuesList workspace={workspace} />
    case 'settings':
      return (
        <ProjectSettings
          workspace={workspace}
          sectionId={settingsSection ?? DEFAULT_SETTINGS_SECTION}
        />
      )
    default:
      return <ResourceSection section={section} />
  }
}
