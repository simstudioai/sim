'use client'

import type { ReactNode } from 'react'
import { Chip, ChipLink } from '@sim/emcn'
import { ArrowUpRight } from '@sim/emcn/icons'
import { JiraIcon, LinearIcon } from '@/components/icons'
import type { WorkspaceSettingsSection } from '@/components/settings/navigation'
import type { Project } from '@/app/playground/org/lib/project'
import { workspaceRoutes } from '@/app/playground/org/lib/routes'
import { SETTINGS_NAV } from '@/app/playground/org/lib/settings-nav'
import { useProjectDescription } from '@/app/playground/org/lib/use-project-resources'

interface ProjectSettingsProps {
  project: Project
  sectionId: string
}

/**
 * One settings section; the settings list itself lives in the sidebar. The project's General
 * page is the prototype's own; every other section is the real workspace settings page.
 */
export function ProjectSettings({ project, sectionId }: ProjectSettingsProps) {
  const active = SETTINGS_NAV.find((item) => item.id === sectionId)
  if (!active) throw new Error(`Unknown settings section ${sectionId}`)
  const ActiveIcon = active.icon
  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto flex max-w-[760px] flex-col gap-6 px-8 py-8'>
        <header className='flex items-start gap-3'>
          <ActiveIcon className='mt-1 size-[18px] shrink-0 text-[var(--text-icon)]' />
          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            <h2 className='text-[20px] text-[var(--text-primary)] leading-tight'>{active.label}</h2>
            <p className='text-[var(--text-muted)] text-small'>{active.description}</p>
          </div>
        </header>
        {active.group === 'project' ? (
          <ProjectGeneral project={project} />
        ) : project.isMock ? (
          <span className='text-[var(--text-muted)] text-small'>Nothing here yet.</span>
        ) : (
          <ChipLink
            href={workspaceRoutes.settings(project.id, active.id as WorkspaceSettingsSection)}
            variant='border'
            rightIcon={ArrowUpRight}
            className='self-start'
          >
            Open {active.label} in workspace settings
          </ChipLink>
        )}
      </div>
    </div>
  )
}

function ProjectGeneral({ project }: { project: Project }) {
  const { tracker, feedbackSources } = project.mock
  const description = useProjectDescription(project)
  const TrackerIcon =
    tracker.kind === 'jira' ? JiraIcon : tracker.kind === 'linear' ? LinearIcon : null
  const rows: [string, ReactNode][] = [
    ['Name', project.name],
    ['Description', description],
    [
      'Tracker',
      <span key='tracker' className='flex items-center gap-1.5'>
        {TrackerIcon && <TrackerIcon className='size-[14px]' />}
        {tracker.kind === 'sim' ? 'Sim tracker' : `${tracker.label} · two-way sync`}
      </span>,
    ],
    [
      'Feedback sources',
      feedbackSources.length ? feedbackSources.map((source) => source.label).join(', ') : 'None',
    ],
    ['Triage', 'Sim proposes issues from feedback; a person accepts them'],
    ['Reporter replies', 'Reply in the original thread when a change ships'],
    ['Changelog', 'Drafted by Sim, released by a person'],
  ]
  return (
    <div className='flex flex-col'>
      {rows.map(([label, value]) => (
        <div
          key={label}
          className='flex items-center gap-4 border-[var(--border)] border-b py-3.5 text-small last:border-b-0'
        >
          <span className='w-[160px] shrink-0 text-[var(--text-muted)]'>{label}</span>
          <span className='min-w-0 flex-1 text-[var(--text-body)]'>{value}</span>
          <Chip className='shrink-0'>Edit</Chip>
        </div>
      ))}
    </div>
  )
}
