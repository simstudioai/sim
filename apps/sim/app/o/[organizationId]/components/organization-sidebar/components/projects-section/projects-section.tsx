'use client'

import { useState } from 'react'
import { chipVariants, cn, OverflowText } from '@sim/emcn'
import { formatRelativeTime } from '@sim/utils/formatting'
import Link from 'next/link'
import { useQueryStates } from 'nuqs'
import { organizationRoutes } from '@/lib/navigation/paths'
import { ProjectRow } from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/project-row'
import {
  type ProjectDragProps,
  useProjectOrder,
} from '@/app/o/[organizationId]/components/organization-sidebar/components/projects-section/use-project-order'
import { type Project, useProjects } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { projectParsers } from '@/app/o/[organizationId]/p/search-params'
import { SidebarSection } from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import { SIDEBAR_ITEM_GAP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'

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
  const [{ chat: openChat }] = useQueryStates(projectParsers)
  return (
    <SidebarSection title='Projects' railCollapsed={isCollapsed} className='shrink-0'>
      <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
        {projects.map((project) => (
          <ProjectTree
            key={project.id}
            organizationId={organizationId}
            project={project}
            pathname={pathname}
            openChat={openChat}
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
  openChat: string
  railCollapsed: boolean
  drag: ProjectDragProps
  isAnyDragActive: boolean
}

/**
 * A project row with its chats listed underneath. A project spans every environment in its
 * lineage; the chats shown belong to the environment you are in.
 */
function ProjectTree({
  organizationId,
  project,
  pathname,
  openChat,
  railCollapsed,
  drag,
  isAnyDragActive,
}: ProjectTreeProps) {
  const routes = organizationRoutes(organizationId)
  const [showAll, setShowAll] = useState(false)
  const activeId =
    project.environments.find((environment) => {
      const base = `${routes.root}/p/${environment.workspaceId}`
      return pathname === base || pathname?.startsWith(`${base}/`)
    })?.workspaceId ?? null
  const inProject = activeId !== null
  /** null follows navigation (open while you're in the project); a click pins it open or shut. */
  const [override, setOverride] = useState<boolean | null>(null)
  const expanded = override ?? inProject
  const { data: chats = [] } = useMothershipChats(activeId ?? project.id)
  const visible = showAll ? chats : chats.slice(0, CHAT_PREVIEW)
  const panelHref = (chatId: string) =>
    `${inProject && pathname ? pathname : routes.project(project.id)}?chat=${chatId}`

  return (
    <div className='flex flex-col gap-[1px]'>
      <ProjectRow
        project={project}
        href={routes.project(project.id)}
        newChatHref={panelHref('new')}
        active={inProject}
        expanded={chats.length > 0 ? expanded : undefined}
        railCollapsed={railCollapsed}
        drag={drag}
        isAnyDragActive={isAnyDragActive}
        onToggleExpand={() => setOverride(inProject ? !expanded : true)}
      />
      {!railCollapsed && expanded && chats.length > 0 && (
        <div className='flex flex-col gap-[1px] pl-[22px]'>
          {visible.map((chat) => (
            <Link
              key={chat.id}
              href={panelHref(chat.id)}
              className={cn(
                chipVariants({ active: openChat === chat.id && inProject, fullWidth: true }),
                'h-[26px] gap-2'
              )}
            >
              <OverflowText
                label={chat.name}
                className='sidebar-collapse-hide flex-1 text-[var(--text-body)] text-small'
                focusTarget='nearest-interactive'
              />
              {chat.isActive ? (
                <span
                  role='img'
                  aria-label='Running'
                  className='inline-flex size-[14px] shrink-0 items-center justify-center'
                >
                  <span className='size-[7px] rounded-full bg-[var(--caution)]' />
                </span>
              ) : (
                <span className='shrink-0 text-[var(--text-muted)] text-caption'>
                  {formatRelativeTime(chat.updatedAt.toISOString())
                    .replace(' ago', '')
                    .replace('just now', 'now')}
                </span>
              )}
            </Link>
          ))}
          {chats.length > CHAT_PREVIEW && (
            <button
              type='button'
              onClick={() => setShowAll((prev) => !prev)}
              className={cn(
                chipVariants({ fullWidth: true }),
                'h-[26px] text-[var(--text-muted)] text-small'
              )}
            >
              {showAll ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
