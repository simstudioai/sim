'use client'

import { cn } from '@sim/emcn'
import Link from 'next/link'
import { Changelog } from '@/app/playground/org/components/changelog'
import { ChatAbout } from '@/app/playground/org/components/chat-about'
import { IssuesList } from '@/app/playground/org/components/issues-list'
import { ProjectSettings } from '@/app/playground/org/components/project-settings'
import { ProtoDashboard } from '@/app/playground/org/components/proto-dashboard'
import { ResourceKinds } from '@/app/playground/org/components/resource-kinds'
import { ResourceSection } from '@/app/playground/org/components/resource-section'
import { isPanelKind } from '@/app/playground/org/lib/chat-resources'
import type { Workspace } from '@/app/playground/org/lib/mock-data'
import {
  MAIN_SECTION_IDS,
  MAIN_SECTIONS,
  type ProjectSection,
  protoRoutes,
} from '@/app/playground/org/lib/routes'
import { DEFAULT_SETTINGS_SECTION } from '@/app/playground/org/lib/settings-nav'

const TABS = [
  ...MAIN_SECTIONS.map((item) => ({ id: item.id as ProjectSection, label: item.label })),
  { id: 'resources' as ProjectSection, label: 'Resources' },
]

/** What a chat started from this page opens first: the dashboard, a kind's list, or the project. */
function pageRef(workspace: Workspace, section: ProjectSection): string {
  if (section === 'dashboard' && workspace.dashboards[0])
    return `dashboard:${workspace.id}:${workspace.dashboards[0]}`
  if (isPanelKind(section)) return `browse:${workspace.id}:${section}`
  return `browse:${workspace.id}`
}

interface WorkspaceViewProps {
  workspace: Workspace
  section: ProjectSection
  settingsSection?: string
}

/**
 * The project page: dashboard, changelog, issues, and resources as tabs. Resources lists every
 * other kind underneath; opening one keeps the page and the tab, and swaps what is below.
 */
export function WorkspaceView({ workspace, section, settingsSection }: WorkspaceViewProps) {
  const activeTab: ProjectSection = MAIN_SECTION_IDS.includes(section as never)
    ? section
    : 'resources'
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
          <ChatAbout open={pageRef(workspace, section)} />
        </div>
        <nav
          aria-label='Project sections'
          className='flex items-center gap-6 border-[var(--border)] border-b'
        >
          {TABS.map((item) => {
            const active = activeTab === item.id
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
      <div className='min-h-0 flex-1'>
        <SectionBody workspace={workspace} section={section} settingsSection={settingsSection} />
      </div>
    </div>
  )
}

interface SectionBodyProps {
  workspace: Workspace
  section: ProjectSection
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
    case 'resources':
      return <ResourceKinds workspace={workspace} />
    case 'settings':
      return (
        <ProjectSettings
          workspace={workspace}
          sectionId={settingsSection ?? DEFAULT_SETTINGS_SECTION}
        />
      )
    default:
      return <ResourceSection workspace={workspace} section={section} />
  }
}
