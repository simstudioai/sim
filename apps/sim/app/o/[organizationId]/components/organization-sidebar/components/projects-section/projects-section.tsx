'use client'

import { cn } from '@sim/emcn'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { organizationRoutes } from '@/lib/navigation/paths'
import { ProjectRow } from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/project-row'
import {
  type ProjectDragProps,
  useProjectOrder,
} from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/use-project-order'
import { projectPaneParsers } from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import { type Project, useProjects } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { SidebarSection } from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import { SIDEBAR_ITEM_GAP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'

interface ProjectsSectionProps {
  organizationId: string
  isCollapsed: boolean
  pathname: string | null
}

/** Projects select the pinned pane; chats remain independent organization conversations. */
export function ProjectsSection({ organizationId, isCollapsed, pathname }: ProjectsSectionProps) {
  const { roots } = useProjects(organizationId)
  const { projects, dragProps, isAnyDragActive } = useProjectOrder(roots)
  return (
    <SidebarSection title='Projects' railCollapsed={isCollapsed} className='shrink-0'>
      <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
        {projects.map((project) => (
          <ProjectTree
            key={project.id}
            organizationId={organizationId}
            project={project}
            pathname={pathname}
            railCollapsed={isCollapsed}
            drag={dragProps(project)}
            isAnyDragActive={isAnyDragActive}
          />
        ))}
      </div>
    </SidebarSection>
  )
}

interface ProjectTreeProps {
  organizationId: string
  project: Project
  pathname: string | null
  railCollapsed: boolean
  drag: ProjectDragProps
  isAnyDragActive: boolean
}

function ProjectTree({
  organizationId,
  project,
  pathname,
  railCollapsed,
  drag,
  isAnyDragActive,
}: ProjectTreeProps) {
  const routes = organizationRoutes(organizationId)
  const searchParams = useSearchParams()
  const [{ project: selectedWorkspace }] = useQueryStates(projectPaneParsers)
  const inProject = project.environments.some(
    (environment) => environment.workspaceId === selectedWorkspace
  )
  const query = new URLSearchParams(searchParams.toString())
  if (inProject) query.delete('project')
  else query.set('project', project.id)
  query.delete('section')
  query.set('pane', 'project')
  const chatPath = pathname?.startsWith(`/o/${organizationId}/chat/`) ? pathname : routes.home
  const href = `${chatPath}?${query}`
  return (
    <ProjectRow
      project={project}
      href={href}
      newChatHref={`${routes.home}?project=${encodeURIComponent(project.id)}&pane=project`}
      active={inProject}
      railCollapsed={railCollapsed}
      drag={drag}
      isAnyDragActive={isAnyDragActive}
    />
  )
}
