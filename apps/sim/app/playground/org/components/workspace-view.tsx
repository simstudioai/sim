'use client'

import { ChipLink, cn } from '@sim/emcn'
import Link from 'next/link'
import { Changelog } from '@/app/playground/org/components/changelog'
import { IssuesList } from '@/app/playground/org/components/issues-list'
import { ProjectSettings } from '@/app/playground/org/components/project-settings'
import { ProtoDashboard } from '@/app/playground/org/components/proto-dashboard'
import { ResourceSection } from '@/app/playground/org/components/resource-section'
import type { Workspace } from '@/app/playground/org/lib/mock-data'
import {
  MAIN_SECTIONS,
  protoRoutes,
  WORKSPACE_SECTIONS,
  type WorkspaceSection,
} from '@/app/playground/org/lib/routes'
import { DEFAULT_SETTINGS_SECTION } from '@/app/playground/org/lib/settings-nav'

interface WorkspaceViewProps {
  workspace: Workspace
  section: WorkspaceSection
  /** Full view: the sidebar carries navigation, so the page drops the chip row. */
  full: boolean
  settingsSection?: string
}

/**
 * Main view: dashboard, changelog, and issues as chips, with a button into the full view.
 * Full view: just the section; the sidebar has switched to this project's navigation.
 */
export function WorkspaceView({ workspace, section, full, settingsSection }: WorkspaceViewProps) {
  const current = WORKSPACE_SECTIONS.find((item) => item.id === section)
  if (!current) throw new Error(`Unknown section ${section}`)
  return (
    <div className='flex h-full min-h-0 flex-col'>
      {full && section === 'settings' ? null : full ? (
        <header className='flex h-12 shrink-0 items-center gap-2 border-[var(--border)] border-b px-6'>
          <current.icon className='size-[14px] text-[var(--text-icon)]' />
          <h1 className='text-[var(--text-body)] text-small'>{current.label}</h1>
        </header>
      ) : (
        <header className='flex shrink-0 flex-col gap-3 px-6 pt-5'>
          <div className='flex items-start gap-3'>
            <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
              <h1 className='text-[20px] text-[var(--text-primary)] leading-tight'>
                {workspace.name}
              </h1>
              <p className='text-[var(--text-muted)] text-small'>{workspace.description}</p>
            </div>
            <ChipLink href={protoRoutes.full(workspace.id, 'workflows')} variant='primary'>
              Open project
            </ChipLink>
          </div>
          <nav
            aria-label='Project sections'
            className='flex items-center gap-6 border-[var(--border)] border-b'
          >
            {MAIN_SECTIONS.map((item) => {
              const active = section === item.id
              return (
                <Link
                  key={item.id}
                  href={protoRoutes.workspace(workspace.id, item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    '-mb-px border-b-2 pb-2.5 text-small transition-colors',
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
      )}
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
