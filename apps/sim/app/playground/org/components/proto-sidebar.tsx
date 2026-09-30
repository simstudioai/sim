'use client'

import { useRef, useState } from 'react'
import {
  Avatar,
  Chip,
  ChipLink,
  ChipTag,
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
  Home,
  Integration,
  PanelLeft,
  Plus,
  Search,
  Settings,
} from '@sim/emcn/icons'
import { formatRelativeTime } from '@sim/utils/formatting'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import type { WorkspaceSettingsSection } from '@/components/settings/navigation'
import { useActiveOrganization, useSession } from '@/lib/auth/auth-client'
import { RunningDot } from '@/app/playground/org/components/glyphs'
import { type Project, useProjects } from '@/app/playground/org/lib/project'
import {
  fullViewProject,
  MAIN_SECTION_IDS,
  PROTO_BASE,
  protoRoutes,
  settingsProject,
  WORKSPACE_SECTIONS,
  type WorkspaceSection,
  workspaceRoutes,
} from '@/app/playground/org/lib/routes'
import { protoParsers } from '@/app/playground/org/lib/search-params'
import {
  SETTINGS_GROUP_TITLES,
  SETTINGS_GROUPS,
  SETTINGS_NAV,
} from '@/app/playground/org/lib/settings-nav'
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
  { id: 'home', label: 'New chat', icon: Home, href: PROTO_BASE },
  { id: 'search', label: 'Search', icon: Search, href: protoRoutes.search },
  { id: 'connectors', label: 'Connectors', icon: Integration, href: protoRoutes.connectors },
]

/** How the sidebar shows a chat's age: "5m", "2h", "3d". */
function compactAge(date: Date): string {
  const relative = formatRelativeTime(date.toISOString())
  return relative === 'just now' ? 'now' : relative.replace(' ago', '')
}

/** Org rail: Home / Search / Connectors, then the real workspaces as projects (each with its chats). */
export function ProtoSidebar() {
  const { isCollapsed: railCollapsed, isPeeking } = useSidebarChrome()
  const isCollapsed = railCollapsed && !isPeeking
  const pathname = usePathname()
  const [{ chat: openChat }] = useQueryStates(protoParsers)
  const { projects } = useProjects()
  const { data: organization } = useActiveOrganization()
  const { data: session } = useSession()
  const fullProject = projects.find((project) => project.id === fullViewProject(pathname))
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
                    {projects.map((project) => (
                      <ProjectTree
                        key={project.id}
                        project={project}
                        pathname={pathname}
                        openChat={openChat}
                        railCollapsed={isCollapsed}
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
            chat={chat}
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
}

/**
 * A project row with its chats listed underneath, like Codex's project → threads.
 * Hovering the row reveals + for a new chat in that project.
 */
function ProjectTree({ project, pathname, openChat, railCollapsed }: ProjectTreeProps) {
  const [showAll, setShowAll] = useState(false)
  const base = `${PROTO_BASE}/p/${project.id}`
  const inProject = pathname === base || Boolean(pathname?.startsWith(`${base}/`))
  /** null follows navigation (open while you're in the project); a click pins it open or shut. */
  const [override, setOverride] = useState<boolean | null>(null)
  const expanded = override ?? inProject
  const { data: chats = [] } = useMothershipChats(project.id)
  const visible = showAll ? chats : chats.slice(0, CHAT_PREVIEW)
  const panelHref = (chatId: string) =>
    `${inProject && pathname ? pathname : protoRoutes.workspace(project.id)}?chat=${chatId}`

  return (
    <div className='flex flex-col gap-[1px]'>
      <SidebarTooltip label={project.name} enabled={railCollapsed}>
        <div
          className={cn(
            chipVariants({ active: inProject, fullWidth: true }),
            SIDEBAR_RAIL_CHIP_CLASS,
            'group/project'
          )}
        >
          <Link
            href={protoRoutes.workspace(project.id)}
            onClick={() => setOverride(inProject ? !expanded : true)}
            aria-expanded={chats.length > 0 ? expanded : undefined}
            className='flex min-w-0 flex-1 items-center gap-2'
          >
            <IdentityTile initial={project.name[0]} />
            <OverflowText
              label={project.name}
              className='sidebar-collapse-hide flex-1 text-[var(--text-body)]'
              focusTarget='nearest-interactive'
            />
          </Link>
          {!railCollapsed && (
            <>
              {project.mock.needsYou > 0 && (
                <ChipTag variant='gray' className='group-hover/project:hidden'>
                  {project.mock.needsYou}
                </ChipTag>
              )}
              <Link
                href={panelHref('new')}
                aria-label={`New chat in ${project.name}`}
                title={`New chat in ${project.name}`}
                className='hidden size-[18px] shrink-0 items-center justify-center rounded-[4px] hover-hover:bg-[var(--surface-active)] group-hover/project:flex'
              >
                <Plus className='size-[12px] text-[var(--text-icon)]' />
              </Link>
            </>
          )}
        </div>
      </SidebarTooltip>
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
  chat: MothershipChatMetadata
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
      {chat.isActive ? (
        <RunningDot />
      ) : (
        <span className='shrink-0 text-[var(--text-muted)] text-caption'>
          {compactAge(chat.updatedAt)}
        </span>
      )}
    </Link>
  )
}

const PRIMARY_SECTIONS: readonly WorkspaceSection[] = MAIN_SECTION_IDS
const BUILD_SECTIONS: readonly WorkspaceSection[] = WORKSPACE_SECTIONS.map((s) => s.id).filter(
  (id) => !MAIN_SECTION_IDS.includes(id)
)

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

/** Full view: the project's build sections, then its chats, in place of Projects and Recent chats. */
function FullViewSections({ project, pathname, openChat, railCollapsed }: FullViewSectionsProps) {
  const { data: chats = [] } = useMothershipChats(project.id)
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
 * Settings: the project sidebar gives way to the settings list, grouped like prod.
 * The project's own General page stays here; every other section opens the real settings page.
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
              const href =
                item.group === 'project'
                  ? protoRoutes.settings(project.id, item.id)
                  : workspaceRoutes.settings(project.id, item.id as WorkspaceSettingsSection)
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
