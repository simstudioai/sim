'use client'

import { Chip, ChipLink, cn } from '@sim/emcn'
import { Settings } from '@sim/emcn/icons'
import { organizationRoutes } from '@/lib/navigation/paths'
import { EnvironmentSwitcher } from '@/app/o/[organizationId]/p/components/environment-switcher'
import { EnvironmentsTab } from '@/app/o/[organizationId]/p/components/environments'
import { ProjectDashboard } from '@/app/o/[organizationId]/p/components/project-dashboard'
import { ProjectResources } from '@/app/o/[organizationId]/p/components/project-resources'
import { ProjectSettings } from '@/app/o/[organizationId]/p/components/project-settings'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { PROJECT_SECTIONS, type ProjectSection } from '@/app/o/[organizationId]/p/routes'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'

interface ProjectViewProps {
  project: Project
  section: ProjectSection
  onBrowse?: () => void
  onSectionChange?: (section: ProjectSection) => void
  onEnvironmentChange?: (workspaceId: string) => void
}

/** Project content shared by the pinned pane and compatibility routes. */
export function ProjectView({
  project,
  section,
  onBrowse,
  onSectionChange,
  onEnvironmentChange,
}: ProjectViewProps) {
  const { organization } = useOrganizationContext()
  const routes = organizationRoutes(organization.id)
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <header className='flex shrink-0 flex-col gap-3 px-6 pt-5'>
        <div className='flex items-start gap-3'>
          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <div className='flex items-center gap-1.5'>
              <h1 className='text-[20px] text-[var(--text-primary)] leading-tight'>
                {project.name}
              </h1>

              {onSectionChange && (
                <Chip
                  leftIcon={Settings}
                  aria-label='Project settings'
                  onClick={() => onSectionChange('settings')}
                />
              )}
            </div>
          </div>
          <div className='flex shrink-0 items-center gap-1'>
            <EnvironmentSwitcher
              project={project}
              section={section}
              onChange={onEnvironmentChange}
            />
          </div>
        </div>
        <nav
          aria-label='Project sections'
          className='flex items-center gap-6 overflow-x-auto border-[var(--border)] border-b'
        >
          {PROJECT_SECTIONS.map((item) =>
            onSectionChange ? (
              <button
                key={item.id}
                type='button'
                onClick={() => onSectionChange(item.id)}
                aria-current={section === item.id ? 'page' : undefined}
                className={cn(
                  '-mb-px shrink-0 border-b-2 pb-2.5 text-small transition-colors',
                  section === item.id
                    ? 'border-[var(--text-primary)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-muted)] hover-hover:text-[var(--text-body)]'
                )}
              >
                {item.label}
              </button>
            ) : (
              <ChipLink
                key={item.id}
                href={routes.project(project.id, item.id)}
                active={section === item.id}
              >
                {item.label}
              </ChipLink>
            )
          )}
        </nav>
      </header>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <SectionBody project={project} section={section} onBrowse={onBrowse} />
      </div>
    </div>
  )
}

interface SectionBodyProps {
  onBrowse?: () => void
  project: Project
  section: ProjectSection
}

function SectionBody({ project, section, onBrowse }: SectionBodyProps) {
  switch (section) {
    case 'resources':
      return <ProjectResources key={project.id} project={project} />
    case 'settings':
      return <ProjectSettings key={project.projectId} project={project} onBrowse={onBrowse} />
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
