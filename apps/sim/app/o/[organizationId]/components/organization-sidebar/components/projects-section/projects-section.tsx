'use client'

import { useState } from 'react'
import { Button, cn, Tooltip } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  CreateProjectModal,
  useProjectCreationPolicy,
} from '@/app/o/[organizationId]/components/create-project-modal/create-project-modal'
import { ProjectRow } from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/project-row'
import {
  type ProjectDragProps,
  useProjectOrder,
} from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/use-project-order'
import { projectPaneParsers } from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import { type Project, useProjects } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { SidebarSection } from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import { SIDEBAR_ITEM_GAP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

interface ProjectsSectionProps {
  organizationId: string
  isCollapsed: boolean
  pathname: string | null
}

/** Projects select the pinned pane; chats remain independent organization conversations. */
export function ProjectsSection({ organizationId, isCollapsed, pathname }: ProjectsSectionProps) {
  const { roots } = useProjects(organizationId)
  const { projects, dragProps, isAnyDragActive } = useProjectOrder(roots)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const { canCreate, disabledReason } = useProjectCreationPolicy(organizationId)

  const openCreate = () => {
    if (!canCreate) return
    useSettingsDirtyStore.getState().requestLeave(() => setIsCreateOpen(true))
  }

  return (
    <>
      <SidebarSection
        title='Projects'
        railCollapsed={isCollapsed}
        className='shrink-0'
        action={
          !isCollapsed && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='quiet'
                  size='icon'
                  aria-label='New project'
                  disabled={!canCreate}
                  onClick={openCreate}
                >
                  <Plus className='size-[16px]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>{disabledReason ?? 'New project'}</Tooltip.Content>
            </Tooltip.Root>
          )
        }
      >
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
      <CreateProjectModal
        organizationId={organizationId}
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
      />
    </>
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
      active={inProject}
      railCollapsed={railCollapsed}
      drag={drag}
      isAnyDragActive={isAnyDragActive}
    />
  )
}
