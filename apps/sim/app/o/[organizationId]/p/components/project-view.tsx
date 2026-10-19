'use client'

import { ChipLink, cn } from '@sim/emcn'
import { organizationRoutes } from '@/lib/navigation/paths'
import { EnvironmentSwitcher } from '@/app/o/[organizationId]/p/components/environment-switcher'
import { EnvironmentsTab } from '@/app/o/[organizationId]/p/components/environments'
import { ProjectDashboard } from '@/app/o/[organizationId]/p/components/project-dashboard'
import { ProjectResources } from '@/app/o/[organizationId]/p/components/project-resources'
import { ProjectSettings } from '@/app/o/[organizationId]/p/components/project-settings'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { PROJECT_SECTIONS, type ProjectSection } from '@/app/o/[organizationId]/p/routes'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { ChangelogEmptyState } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import { ResourceWorkspaceHost } from '@/app/workspace/[workspaceId]/home/components/resource-workspace-host'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { PermissionAccessBoundary } from '@/ee/access-requests/components/permission-access-boundary'

interface ProjectViewProps {
  project: Project
  section: ProjectSection
  onBrowse?: () => void
  onSectionChange?: (section: ProjectSection) => void
  onEnvironmentChange?: (workspaceId: string) => void
}

/** The header stays mounted across environments; only the body loads the selected workspace. */
export function ProjectView({
  project,
  section,
  onBrowse,
  onSectionChange,
  onEnvironmentChange,
}: ProjectViewProps) {
  const { organization } = useOrganizationContext()
  const routes = organizationRoutes(organization.id)
  const dashboardsEnabled = useFeatureFlag('dashboards')
  const changelogEnabled = useFeatureFlag('changelog')
  const sections = PROJECT_SECTIONS.filter(
    (item) =>
      (item.id !== 'dashboard' || dashboardsEnabled) &&
      (item.id !== 'changelog' || changelogEnabled)
  )
  /** A section whose flag is off, such as the default Dashboard, shows the first one available. */
  const activeSection = sections.some((item) => item.id === section) ? section : sections[0].id
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <header className='flex shrink-0 flex-col gap-3 px-6 pt-5'>
        <div className='flex items-start gap-3'>
          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <h1 className='text-[20px] text-[var(--text-primary)] leading-tight'>{project.name}</h1>
          </div>
          <div className='flex shrink-0 items-center gap-1'>
            <EnvironmentSwitcher
              project={project}
              section={activeSection}
              onChange={onEnvironmentChange}
            />
          </div>
        </div>
        <nav
          aria-label='Project sections'
          className='scrollbar-none flex items-center gap-5 overflow-x-auto border-[var(--border)] border-b'
        >
          {sections.map((item) =>
            onSectionChange ? (
              <button
                key={item.id}
                type='button'
                onClick={() => onSectionChange(item.id)}
                aria-current={activeSection === item.id ? 'page' : undefined}
                className={cn(
                  '-mb-px shrink-0 border-b-2 pb-2.5 text-small transition-colors',
                  activeSection === item.id
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
                active={activeSection === item.id}
              >
                {item.label}
              </ChipLink>
            )
          )}
        </nav>
      </header>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <ResourceWorkspaceHost workspaceId={project.id} organizationId={organization.id}>
          <SectionBody project={project} section={activeSection} onBrowse={onBrowse} />
        </ResourceWorkspaceHost>
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
          <PermissionAccessBoundary configKey='hideFilesTab'>
            <ProjectDashboard project={project} />
          </PermissionAccessBoundary>
        </div>
      )
    case 'changelog':
      return (
        <div className='flex h-full min-h-0 flex-col'>
          <ChangelogEmptyState />
        </div>
      )
    case 'issues':
      return <EmptySection>No issues yet.</EmptySection>
    case 'environments':
      return <EnvironmentsTab project={project} />
  }
}

/** Issues until its entity exists. */
function EmptySection({ children }: { children: string }) {
  return <p className='px-6 py-16 text-center text-[var(--text-muted)] text-small'>{children}</p>
}
