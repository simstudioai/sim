'use client'

import { useState } from 'react'
import { Button, cn, DropdownMenuItem, OverflowText, Tooltip } from '@sim/emcn'
import { Box, Pin, Plus } from '@sim/emcn/icons'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { SettingsGuardedLink as Link } from '@/components/settings/settings-guarded-link'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  CreateProjectModal,
  useProjectCreationPolicy,
} from '@/app/o/[organizationId]/components/create-project-modal/create-project-modal'
import { ProjectRow } from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/project-row'
import { useProjectActions } from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/use-project-actions'
import { useProjectOrder } from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/use-project-order'
import { projectPaneParsers } from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import { type Project, useProjects } from '@/app/o/[organizationId]/p/hooks/use-projects'
import {
  CollapsedSidebarMenu,
  SidebarSection,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import { SIDEBAR_ITEM_GAP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu'
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
  const hover = useHoverMenu()
  const actions = useProjectActions()
  const projectLink = useProjectLink(organizationId, pathname)

  const openCreate = () => {
    if (!canCreate) return
    useSettingsDirtyStore.getState().requestLeave(() => {
      hover.close()
      setIsCreateOpen(true)
    })
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
        {isCollapsed ? (
          <div className='px-2'>
            <CollapsedSidebarMenu
              icon={<Box className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
              hover={hover}
              ariaLabel='Projects'
              primaryAction={canCreate ? { label: 'New project', onSelect: openCreate } : undefined}
            >
              {projects.length === 0 ? (
                <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
              ) : (
                projects.map((project) => {
                  const { href, active } = projectLink(project)
                  return (
                    <DropdownMenuItem key={project.id} asChild active={active}>
                      <Link href={href}>
                        <IdentityTile initial={project.name[0]} />
                        <OverflowText label={project.name} className='flex-1' />
                        {actions.isPinned(project) && (
                          <Pin
                            role='img'
                            aria-label='Pinned'
                            className='size-[12px] shrink-0 text-[var(--text-icon)]'
                          />
                        )}
                      </Link>
                    </DropdownMenuItem>
                  )
                })
              )}
            </CollapsedSidebarMenu>
          </div>
        ) : (
          <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
            {projects.map((project) => {
              const { href, active } = projectLink(project)
              return (
                <ProjectRow
                  key={project.id}
                  project={project}
                  href={href}
                  active={active}
                  railCollapsed={false}
                  drag={dragProps(project)}
                  isAnyDragActive={isAnyDragActive}
                />
              )
            })}
          </div>
        )}
      </SidebarSection>
      <CreateProjectModal
        organizationId={organizationId}
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
      />
    </>
  )
}

/** A project link toggles the pinned pane on the current chat (or home), keeping other params. */
function useProjectLink(organizationId: string, pathname: string | null) {
  const routes = organizationRoutes(organizationId)
  const searchParams = useSearchParams()
  const [{ project: selectedWorkspace }] = useQueryStates(projectPaneParsers)
  const chatPath = pathname?.startsWith(`/o/${organizationId}/chat/`) ? pathname : routes.home
  return (project: Project) => {
    const active = project.environments.some(
      (environment) => environment.workspaceId === selectedWorkspace
    )
    const query = new URLSearchParams(searchParams.toString())
    if (active) query.delete('project')
    else query.set('project', project.id)
    query.delete('section')
    query.set('pane', 'project')
    return { href: `${chatPath}?${query}`, active }
  }
}
