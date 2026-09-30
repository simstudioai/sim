'use client'

import { ChipLink } from '@sim/emcn'
import { Expand } from '@sim/emcn/icons'
import { Changelog } from '@/app/playground/org/components/changelog'
import { EnvironmentSwitcher } from '@/app/playground/org/components/environment-switcher'
import { IssuesList } from '@/app/playground/org/components/issues-list'
import { ProjectSettings } from '@/app/playground/org/components/project-settings'
import { ProtoDashboard } from '@/app/playground/org/components/proto-dashboard'
import { ResourceSection } from '@/app/playground/org/components/resource-section'
import type { Project } from '@/app/playground/org/lib/project'
import {
  MAIN_SECTIONS,
  protoRoutes,
  WORKSPACE_SECTIONS,
  type WorkspaceSection,
} from '@/app/playground/org/lib/routes'
import { DEFAULT_SETTINGS_SECTION } from '@/app/playground/org/lib/settings-nav'
import { useProjectDescription } from '@/app/playground/org/lib/use-project-resources'

interface WorkspaceViewProps {
  project: Project
  section: WorkspaceSection
  /** Full view: the sidebar carries navigation, so the page drops the chip row. */
  full: boolean
  settingsSection?: string
}

/**
 * Main view: dashboard, changelog, and issues as chips, with a button into the full view.
 * Full view: just the section; the sidebar has switched to this project's navigation.
 */
export function WorkspaceView({ project, section, full, settingsSection }: WorkspaceViewProps) {
  const current = WORKSPACE_SECTIONS.find((item) => item.id === section)
  if (!current) throw new Error(`Unknown section ${section}`)
  return (
    <div className='flex h-full min-h-0 flex-col'>
      {full && section === 'settings' ? null : full ? (
        <header className='flex h-12 shrink-0 items-center gap-2 border-[var(--border)] border-b px-6'>
          <current.icon className='size-[14px] text-[var(--text-icon)]' />
          <h1 className='min-w-0 flex-1 text-[var(--text-body)] text-small'>{current.label}</h1>
          <EnvironmentSwitcher project={project} section={section} full />
        </header>
      ) : (
        <header className='flex shrink-0 flex-col gap-3 px-6 pt-5'>
          <div className='flex items-start gap-3'>
            <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
              <h1 className='text-[20px] text-[var(--text-primary)] leading-tight'>
                {project.name}
              </h1>
              <ProjectDescription project={project} />
            </div>
            <div className='flex shrink-0 items-center gap-1'>
              <EnvironmentSwitcher project={project} section={section} full={false} />
              <ChipLink
                href={protoRoutes.full(project.id, 'workflows')}
                variant='border'
                leftIcon={Expand}
              >
                Open full view
              </ChipLink>
            </div>
          </div>
          <nav
            aria-label='Project sections'
            className='-mx-1 flex items-center gap-1 border-[var(--border)] border-b px-1 pb-3'
          >
            {MAIN_SECTIONS.map((item) => (
              <ChipLink
                key={item.id}
                href={protoRoutes.workspace(project.id, item.id)}
                active={section === item.id}
                leftIcon={item.icon}
              >
                {item.label}
              </ChipLink>
            ))}
          </nav>
        </header>
      )}
      <div className='min-h-0 flex-1'>
        <SectionBody project={project} section={section} settingsSection={settingsSection} />
      </div>
    </div>
  )
}

function ProjectDescription({ project }: { project: Project }) {
  const text = useProjectDescription(project)
  return <p className='min-h-[18px] text-[var(--text-muted)] text-small'>{text}</p>
}

interface SectionBodyProps {
  project: Project
  section: WorkspaceSection
  settingsSection?: string
}

function SectionBody({ project, section, settingsSection }: SectionBodyProps) {
  switch (section) {
    case 'dashboard':
      return (
        <div className='flex h-full min-h-0 flex-col'>
          <ProtoDashboard project={project} />
        </div>
      )
    case 'changelog':
      return <Changelog project={project} />
    case 'issues':
      return <IssuesList project={project} />
    case 'settings':
      return (
        <ProjectSettings
          project={project}
          sectionId={settingsSection ?? DEFAULT_SETTINGS_SECTION}
        />
      )
    default:
      return <ResourceSection project={project} section={section} />
  }
}
