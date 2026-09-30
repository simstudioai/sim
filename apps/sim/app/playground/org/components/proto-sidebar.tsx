'use client'

import { useRef, useState } from 'react'
import {
  Avatar,
  Chip,
  ChipLink,
  chipVariants,
  cn,
  OverflowText,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import {
  ChevronDown,
  ChevronLeft,
  Integration,
  PanelLeft,
  Plus,
  Search,
  Settings,
  SquarePen,
} from '@sim/emcn/icons'
import { formatRelativeTime } from '@sim/utils/formatting'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { useActiveOrganization, useSession } from '@/lib/auth/auth-client'
import { RunningDot } from '@/app/playground/org/components/glyphs'
import { ProjectRow } from '@/app/playground/org/components/project-row'
import { type Project, useProjects } from '@/app/playground/org/lib/project'
import { type ProjectChat, useProjectSources } from '@/app/playground/org/lib/project-sources'
import {
  BUILD_SECTION_IDS,
  fullViewProject,
  MAIN_SECTION_IDS,
  PROTO_BASE,
  protoRoutes,
  settingsProject,
  WORKSPACE_SECTIONS,
  type WorkspaceSection,
} from '@/app/playground/org/lib/routes'
import { protoParsers } from '@/app/playground/org/lib/search-params'
import {
  SETTINGS_GROUP_TITLES,
  SETTINGS_GROUPS,
  SETTINGS_NAV,
} from '@/app/playground/org/lib/settings-nav'
import { type ProjectDragProps, useProjectOrder } from '@/app/playground/org/lib/use-project-order'
import { useSidebarChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import {
  isNavItemActive,
  SidebarNavChip,
  type SidebarNavItemData,
  SidebarSection,
  SidebarTooltip,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import {
  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
  SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_RAIL_CHIP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import {
  type MothershipChatMetadata,
  useMothershipChats,
  useOrganizationMothershipChats,
} from '@/hooks/queries/mothership-chats'
import { useSidebarStore } from '@/stores/sidebar/store'

const CHAT_PREVIEW = 3

const NAV_ITEMS: SidebarNavItemData[] = [
  { id: 'home', label: 'New chat', icon: SquarePen, href: PROTO_BASE },
  { id: 'search', label: 'Search', icon: Search, href: protoRoutes.search },
  { id: 'connectors', label: 'Connectors', icon: Integration, href: protoRoutes.connectors },
]

/** How the sidebar shows a chat's age: "5m", "2h", "3d". */
function compactAge(date: Date): string {
  const relative = formatRelativeTime(date.toISOString())
  return relative === 'just now' ? 'now' : relative.replace(' ago', '')
}

/** One shape for a row, whether the chat is a real Sim chat or one from a pack. */
interface ChatItem {
  id: string
  name: string
  age: string
  running: boolean
}

function toChatItems(
  project: Project,
  real: MothershipChatMetadata[] | undefined,
  fromSource: ProjectChat[]
): ChatItem[] {
  if (project.isMock)
    return fromSource.map((chat) => ({
      id: chat.id,
      name: chat.title,
      age: chat.age,
      running: chat.running,
    }))
  return (real ?? []).map((chat) => ({
    id: chat.id,
    name: chat.name,
    age: compactAge(chat.updatedAt),
    running: chat.isActive,
  }))
}

/** Org rail: Home / Search / Connectors, then the real workspaces as projects (each with its chats). */
export function ProtoSidebar() {
  const { isCollapsed: railCollapsed, isPeeking } = useSidebarChrome()
  const isCollapsed = railCollapsed && !isPeeking
  const pathname = usePathname()
  const [{ chat: openChat }] = useQueryStates(protoParsers)
  const { projects, roots } = useProjects()
  const { projects: orderedProjects, dragProps, isAnyDragActive } = useProjectOrder(roots)
  const { data: organization } = useActiveOrganization()
  const { data: session } = useSession()
  /** Only a mock project has a full view here; a real project's Build is its workspace pages. */
  const fullProject = projects.find(
    (project) => project.isMock && project.id === fullViewProject(pathname)
  )
  const inSettings = Boolean(fullProject && settingsProject(pathname))
  const organizationId = projects.find((project) => project.organizationId)?.organizationId
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const scrollEdges = useScrollEdges(scrollContainerRef, {
    contentRef: scrollContentRef,
    enabled: !isCollapsed,
  })
  const organizationName = organization?.name ?? 'Organization'
  const userName = session?.user?.name ?? 'You'

  return (
    <aside
      className='group/rail sidebar-container relative h-full overflow-hidden bg-[var(--surface-1)]'
      data-collapsed={isCollapsed || undefined}
      aria-label='Organization sidebar'
    >
      <div className='flex h-full flex-col'>
        <div className='relative flex shrink-0 items-center gap-[1px] px-2 pt-2'>
          <div className='min-w-0 flex-1'>
            {fullProject ? (
              <SidebarTooltip label={`Back to ${fullProject.name}`} enabled side='bottom'>
                <ChipLink
                  href={
                    inSettings
                      ? protoRoutes.full(fullProject.id)
                      : protoRoutes.workspace(fullProject.id)
                  }
                  fullWidth
                  className={SIDEBAR_RAIL_CHIP_CLASS}
                  leftAdornment={
                    <span className='flex shrink-0 items-center gap-1'>
                      <ChevronLeft className='size-[14px] text-[var(--text-icon)]' />
                      <IdentityTile initial={fullProject.name[0]} />
                    </span>
                  }
                >
                  {inSettings ? `${fullProject.name} settings` : fullProject.name}
                </ChipLink>
              </SidebarTooltip>
            ) : (
              <Chip
                fullWidth
                className={SIDEBAR_RAIL_CHIP_CLASS}
                onClick={isCollapsed ? toggleCollapsed : undefined}
                leftAdornment={<IdentityTile initial={organizationName[0]} />}
                rightIcon={isCollapsed ? undefined : ChevronDown}
              >
                {organizationName}
              </Chip>
            )}
          </div>
          {!isCollapsed && (
            <SidebarTooltip label='Collapse sidebar' enabled side='bottom' shortcut='⌘B'>
              <Chip leftIcon={PanelLeft} aria-label='Collapse sidebar' onClick={toggleCollapsed} />
            </SidebarTooltip>
          )}
        </div>

        <div
          className={cn(
            SIDEBAR_SECTION_GAP_CLASS,
            SIDEBAR_ITEM_GAP_CLASS,
            SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
            'flex shrink-0 flex-col border-b px-2 transition-colors duration-150',
            !scrollEdges.top && 'border-transparent'
          )}
        >
          {(inSettings
            ? []
            : fullProject
              ? fullNavItems(fullProject.id, PRIMARY_SECTIONS)
              : NAV_ITEMS
          ).map((item) => (
            <SidebarTooltip key={item.id} label={item.label} enabled={isCollapsed}>
              <SidebarNavChip
                item={item}
                active={
                  item.id === 'home' ? pathname === PROTO_BASE : isNavItemActive(item, pathname)
                }
              />
            </SidebarTooltip>
          ))}
        </div>

        <div
          ref={scrollContainerRef}
          className={cn(
            SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
            SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
            scrollFadeClass,
            'flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden'
          )}
          {...scrollFadeAttributes(scrollEdges)}
        >
          <div ref={scrollContentRef} className='flex flex-col'>
            {fullProject && inSettings ? (
              <SettingsSections
                project={fullProject}
                pathname={pathname}
                railCollapsed={isCollapsed}
              />
            ) : fullProject ? (
              <FullViewSections
                project={fullProject}
                pathname={pathname}
                openChat={openChat}
                railCollapsed={isCollapsed}
              />
            ) : (
              <>
                <SidebarSection
                  title='Projects'
                  railCollapsed={isCollapsed}
                  action={
                    isCollapsed ? undefined : (
                      <Chip leftIcon={Plus} aria-label='New project' className='mr-2 h-[18px]' />
                    )
                  }
                >
                  <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                    {orderedProjects.map((project) => (
                      <ProjectTree
                        key={project.id}
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

                {organizationId && (
                  <OrgChats
                    organizationId={organizationId}
                    pathname={pathname}
                    railCollapsed={isCollapsed}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <div
          className={cn(
            'flex shrink-0 items-center gap-[1px] border-t px-2 py-2 transition-colors',
            !scrollEdges.bottom && 'border-transparent'
          )}
        >
          <div className='min-w-0 flex-1'>
            <Chip
              fullWidth
              className={SIDEBAR_RAIL_CHIP_CLASS}
              leftAdornment={<Avatar size='xs' name={userName} />}
            >
              {userName}
            </Chip>
          </div>
          {!isCollapsed && <Chip leftIcon={Settings} aria-label='Settings' />}
        </div>
      </div>
    </aside>
  )
}

interface OrgChatsProps {
  organizationId: string
  pathname: string | null
  railCollapsed: boolean
}

/** Chats that belong to no project: the organization's own Sim conversations. */
function OrgChats({ organizationId, pathname, railCollapsed }: OrgChatsProps) {
  const { data: chats = [] } = useOrganizationMothershipChats(organizationId)
  if (!chats.length) return null
  return (
    <SidebarSection
      title='Recent chats'
      railCollapsed={railCollapsed}
      className={SIDEBAR_SECTION_GAP_CLASS}
    >
      <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
        {chats.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={{
              id: chat.id,
              name: chat.name,
              age: compactAge(chat.updatedAt),
              running: chat.isActive,
            }}
            href={protoRoutes.chat(null, chat.id)}
            active={pathname === protoRoutes.chat(null, chat.id)}
          />
        ))}
      </div>
    </SidebarSection>
  )
}

interface ProjectTreeProps {
  project: Project
  pathname: string | null
  openChat: string
  railCollapsed: boolean
  drag: ProjectDragProps
  isAnyDragActive: boolean
}

/** Which of the project's environments the path is in, if any. */
function activeEnvironmentId(project: Project, pathname: string | null): string | null {
  for (const environment of project.environments) {
    const base = `${PROTO_BASE}/p/${environment.workspaceId}`
    if (pathname === base || pathname?.startsWith(`${base}/`)) return environment.workspaceId
  }
  return null
}

/**
 * A project row with its chats listed underneath, like Codex's project → threads.
 * A project spans every environment in its fork lineage; the chats shown belong to the
 * environment you are in. The row itself carries the workspace sidebar's ergonomics.
 */
function ProjectTree({
  project,
  pathname,
  openChat,
  railCollapsed,
  drag,
  isAnyDragActive,
}: ProjectTreeProps) {
  const [showAll, setShowAll] = useState(false)
  const activeId = activeEnvironmentId(project, pathname)
  const inProject = activeId !== null
  const chatWorkspaceId = activeId ?? project.id
  /** null follows navigation (open while you're in the project); a click pins it open or shut. */
  const [override, setOverride] = useState<boolean | null>(null)
  const expanded = override ?? inProject
  const sources = useProjectSources()
  const { data: realChats } = useMothershipChats(project.isMock ? undefined : chatWorkspaceId)
  const chats = toChatItems(project, realChats, sources.chatsFor(project))
  const needsYou = project.overlayPending ? 0 : sources.needsYouFor(project)
  const visible = showAll ? chats : chats.slice(0, CHAT_PREVIEW)
  const panelHref = (chatId: string) =>
    `${inProject && pathname ? pathname : protoRoutes.workspace(project.id)}?chat=${chatId}`

  return (
    <div className='flex flex-col gap-[1px]'>
      <ProjectRow
        project={project}
        href={protoRoutes.workspace(project.id)}
        newChatHref={panelHref('new')}
        active={inProject}
        expanded={chats.length > 0 ? expanded : undefined}
        needsYou={needsYou}
        railCollapsed={railCollapsed}
        drag={drag}
        isAnyDragActive={isAnyDragActive}
        onToggleExpand={() => setOverride(inProject ? !expanded : true)}
      />
      {!railCollapsed && expanded && chats.length > 0 && (
        <div className='flex flex-col gap-[1px] pl-[22px]'>
          {visible.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              href={panelHref(chat.id)}
              active={openChat === chat.id && inProject}
            />
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

interface ChatRowProps {
  chat: ChatItem
  href: string
  active: boolean
}

/** Title, then a spinner while Sim is still working in it, else how long ago it moved. */
function ChatRow({ chat, href, active }: ChatRowProps) {
  return (
    <Link href={href} className={cn(chipVariants({ active, fullWidth: true }), 'h-[26px] gap-2')}>
      <OverflowText
        label={chat.name}
        className='sidebar-collapse-hide flex-1 text-[var(--text-body)] text-small'
        focusTarget='nearest-interactive'
      />
      {chat.running ? (
        <RunningDot />
      ) : (
        <span className='shrink-0 text-[var(--text-muted)] text-caption'>{chat.age}</span>
      )}
    </Link>
  )
}

const PRIMARY_SECTIONS: readonly WorkspaceSection[] = MAIN_SECTION_IDS
const BUILD_SECTIONS: readonly WorkspaceSection[] = BUILD_SECTION_IDS

function fullNavItems(
  workspaceId: string,
  sections: readonly WorkspaceSection[]
): SidebarNavItemData[] {
  return WORKSPACE_SECTIONS.filter((item) => sections.includes(item.id)).map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    href: protoRoutes.full(workspaceId, item.id),
  }))
}

interface FullViewSectionsProps {
  project: Project
  pathname: string | null
  openChat: string
  railCollapsed: boolean
}

/** Mock project full view: its static Build sections, then its chats, in place of Projects and Recent chats. */
function FullViewSections({ project, pathname, openChat, railCollapsed }: FullViewSectionsProps) {
  const sources = useProjectSources()
  const { data: realChats } = useMothershipChats(project.isMock ? undefined : project.id)
  const chats = toChatItems(project, realChats, sources.chatsFor(project))
  return (
    <>
      <SidebarSection title='Build' railCollapsed={railCollapsed}>
        <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
          {fullNavItems(project.id, BUILD_SECTIONS).map((item) => (
            <SidebarTooltip key={item.id} label={item.label} enabled={railCollapsed}>
              <SidebarNavChip item={item} active={isNavItemActive(item, pathname)} />
            </SidebarTooltip>
          ))}
        </div>
      </SidebarSection>
      {chats.length > 0 && (
        <SidebarSection
          title='Chats'
          railCollapsed={railCollapsed}
          className={SIDEBAR_SECTION_GAP_CLASS}
        >
          <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
            {chats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                href={`${pathname ?? protoRoutes.full(project.id)}?chat=${chat.id}`}
                active={openChat === chat.id}
              />
            ))}
          </div>
        </SidebarSection>
      )}
    </>
  )
}

interface SettingsSectionsProps {
  project: Project
  pathname: string | null
  railCollapsed: boolean
}

/**
 * Mock project settings: the project sidebar gives way to the settings list, grouped like prod.
 * The project's own General page has content; the workspace sections have nothing behind them.
 */
function SettingsSections({ project, pathname, railCollapsed }: SettingsSectionsProps) {
  const base = protoRoutes.settings(project.id)
  return (
    <>
      {SETTINGS_GROUPS.map((group, index) => (
        <SidebarSection
          key={group}
          title={SETTINGS_GROUP_TITLES[group] ?? group}
          railCollapsed={railCollapsed}
          className={cn(index > 0 && SIDEBAR_SECTION_GAP_CLASS)}
        >
          <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
            {SETTINGS_NAV.filter((item) => item.group === group).map((item) => {
              const href = protoRoutes.settings(project.id, item.id)
              const active =
                pathname === href ||
                (item.id === SETTINGS_NAV[0].id && pathname === base.replace(/\/[^/]+$/, ''))
              return (
                <SidebarTooltip key={item.id} label={item.label} enabled={railCollapsed}>
                  <SidebarNavChip
                    item={{ id: item.id, label: item.label, icon: item.icon, href }}
                    active={active}
                  />
                </SidebarTooltip>
              )
            })}
          </div>
        </SidebarSection>
      ))}
    </>
  )
}
