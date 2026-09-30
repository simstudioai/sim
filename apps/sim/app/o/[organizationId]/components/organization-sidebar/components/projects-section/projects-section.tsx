'use client'

import { cn } from '@sim/emcn'
import { organizationRoutes } from '@/lib/navigation/paths'
import { ProjectRow } from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/project-row'
import {
  type ProjectDragProps,
  useProjectOrder,
} from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/use-project-order'
import { type Project, useProjects } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { SidebarSection } from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import { SIDEBAR_ITEM_GAP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'

/** Chats listed under an open project before "Show more". */
const CHAT_PREVIEW = 3

interface ProjectsSectionProps {
  organizationId: string
  isCollapsed: boolean
  pathname: string | null
}

/** The organization's projects, one per fork lineage, each with its chats underneath. */
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

/**
 * A project row. Chats are organization-wide and can touch several projects, so they live in
 * the Chats section, each marked with the projects it worked in, rather than under one project.
 */
function ProjectTree({
  organizationId,
  project,
  pathname,
  railCollapsed,
  drag,
  isAnyDragActive,
}: ProjectTreeProps) {
  const routes = organizationRoutes(organizationId)
  const inProject = project.environments.some((environment) => {
    const base = `${routes.root}/p/${environment.workspaceId}`
    return pathname === base || pathname?.startsWith(`${base}/`)
  })
  return (
    <ProjectRow
      project={project}
      href={routes.project(project.id)}
      newChatHref={`${inProject && pathname ? pathname : routes.project(project.id)}?chat=new`}
      active={inProject}
      railCollapsed={railCollapsed}
      drag={drag}
      isAnyDragActive={isAnyDragActive}
    />
  )
}
