'use client'

import { ChipLink } from '@sim/emcn'
import { Expand } from '@sim/emcn/icons'
import { organizationRoutes } from '@/lib/navigation/paths'
import { EnvironmentSwitcher } from '@/app/o/[organizationId]/p/components/environment-switcher'
import { EnvironmentsTab } from '@/app/o/[organizationId]/p/components/environments'
import { ProjectDashboard } from '@/app/o/[organizationId]/p/components/project-dashboard'
import { useProjectDescription } from '@/app/o/[organizationId]/p/hooks/use-project-resources'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import {
  PROJECT_SECTIONS,
  type ProjectSection,
  workspaceRoutes,
} from '@/app/o/[organizationId]/p/routes'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

interface ProjectViewProps {
  project: Project
  section: ProjectSection
}

/** A project's main view: its name, the environment, and a chip per section. Build opens the workspace. */
export function ProjectView({ project, section }: ProjectViewProps) {
  const { organization } = useOrganizationContext()
  const routes = organizationRoutes(organization.id)
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <header className='flex shrink-0 flex-col gap-3 px-6 pt-5'>
        <div className='flex items-start gap-3'>
          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <h1 className='text-[20px] text-[var(--text-primary)] leading-tight'>{project.name}</h1>
            <ProjectDescription project={project} />
          </div>
          <div className='flex shrink-0 items-center gap-1'>
            <EnvironmentSwitcher project={project} section={section} />
            <ChipLink
              href={workspaceRoutes.workflows(project.id)}
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
          {PROJECT_SECTIONS.map((item) => (
            <ChipLink
              key={item.id}
              href={routes.project(project.id, item.id)}
              active={section === item.id}
              leftIcon={item.icon}
            >
              {item.label}
            </ChipLink>
          ))}
        </nav>
      </header>
      <div className='min-h-0 flex-1'>
        <SectionBody project={project} section={section} />
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
  section: ProjectSection
}

function SectionBody({ project, section }: SectionBodyProps) {
  switch (section) {
    case 'dashboard':
      return (
        <div className='flex h-full min-h-0 flex-col'>
          <ProjectDashboard project={project} />
        </div>
      )
    case 'changelog':
      return <EmptySection>No releases yet.</EmptySection>
    case 'issues':
      return <EmptySection>No issues yet.</EmptySection>
    case 'environments':
      return <EnvironmentsTab project={project} />
  }
}

/** Changelog and Issues until their entities exist. */
function EmptySection({ children }: { children: string }) {
  return <p className='px-6 py-16 text-center text-[var(--text-muted)] text-small'>{children}</p>
}
