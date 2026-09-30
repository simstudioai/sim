'use client'

import { useRef } from 'react'
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
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { RunningDot } from '@/app/playground/org/components/glyphs'
import { DRAFTS } from '@/app/playground/org/lib/changelog-data'
import {
  CHATS,
  type Chat,
  ORGANIZATION,
  PEOPLE,
  WORKSPACES,
  type Workspace,
} from '@/app/playground/org/lib/mock-data'
import { PROTO_BASE, protoRoutes, settingsProject } from '@/app/playground/org/lib/routes'
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
import { useSidebarStore } from '@/stores/sidebar/store'

const RUNNING_CHAT_IDS = new Set(DRAFTS.flatMap((draft) => draft.running.map((w) => w.chat.id)))

const NAV_ITEMS: SidebarNavItemData[] = [
  { id: 'home', label: 'New chat', icon: Home, href: PROTO_BASE },
  { id: 'search', label: 'Search', icon: Search, href: protoRoutes.search },
  { id: 'connectors', label: 'Connectors', icon: Integration, href: protoRoutes.connectors },
]

/** Mock org rail: Home / Search / Connectors, then projects and recent chats; a project's settings take it over. */
export function ProtoSidebar() {
  const { isCollapsed: railCollapsed, isPeeking } = useSidebarChrome()
  const isCollapsed = railCollapsed && !isPeeking
  const pathname = usePathname()
  const settingsWorkspace = WORKSPACES.find((w) => w.id === settingsProject(pathname))
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const scrollEdges = useScrollEdges(scrollContainerRef, {
    contentRef: scrollContentRef,
    enabled: !isCollapsed,
  })

  return (
    <aside
      className='group/rail sidebar-container relative h-full overflow-hidden bg-[var(--surface-1)]'
      data-collapsed={isCollapsed || undefined}
      aria-label='Organization sidebar'
    >
      <div className='flex h-full flex-col'>
        <div className='relative flex shrink-0 items-center gap-[1px] px-2 pt-2'>
          <div className='min-w-0 flex-1'>
            {settingsWorkspace ? (
              <SidebarTooltip label={`Back to ${settingsWorkspace.name}`} enabled side='bottom'>
                <ChipLink
                  href={protoRoutes.workspace(settingsWorkspace.id)}
                  fullWidth
                  className={SIDEBAR_RAIL_CHIP_CLASS}
                  leftAdornment={
                    <span className='flex shrink-0 items-center gap-1'>
                      <ChevronLeft className='size-[14px] text-[var(--text-icon)]' />
                      <IdentityTile initial={settingsWorkspace.name[0]} />
                    </span>
                  }
                >
                  {settingsWorkspace.name} settings
                </ChipLink>
              </SidebarTooltip>
            ) : (
              <Chip
                fullWidth
                className={SIDEBAR_RAIL_CHIP_CLASS}
                onClick={isCollapsed ? toggleCollapsed : undefined}
                leftAdornment={<IdentityTile initial={ORGANIZATION.name[0]} />}
                rightIcon={isCollapsed ? undefined : ChevronDown}
              >
                {ORGANIZATION.name}
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
          {(settingsWorkspace ? [] : NAV_ITEMS).map((item) => (
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
            {settingsWorkspace ? (
              <SettingsSections
                workspace={settingsWorkspace}
                pathname={pathname}
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
                    {WORKSPACES.map((workspace) => (
                      <ProjectRow
                        key={workspace.id}
                        workspace={workspace}
                        pathname={pathname}
                        railCollapsed={isCollapsed}
                      />
                    ))}
                  </div>
                </SidebarSection>

                <SidebarSection
                  title='Recent chats'
                  railCollapsed={isCollapsed}
                  className={SIDEBAR_SECTION_GAP_CLASS}
                >
                  <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
                    {CHATS.map((chat) => (
                      <ChatRow
                        key={chat.id}
                        chat={chat}
                        href={protoRoutes.chat(chat.id)}
                        active={pathname === protoRoutes.chat(chat.id)}
                      />
                    ))}
                  </div>
                </SidebarSection>
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
              leftAdornment={<Avatar size='xs' name={PEOPLE.teddy.name} />}
            >
              {PEOPLE.teddy.name}
            </Chip>
          </div>
          {!isCollapsed && <Chip leftIcon={Settings} aria-label='Settings' />}
        </div>
      </div>
    </aside>
  )
}

interface ProjectRowProps {
  workspace: Workspace
  pathname: string | null
  railCollapsed: boolean
}

/** A project row: where its resources live. Chats are not filed under it. */
function ProjectRow({ workspace, pathname, railCollapsed }: ProjectRowProps) {
  const base = `${PROTO_BASE}/p/${workspace.id}`
  const inProject = pathname === base || Boolean(pathname?.startsWith(`${base}/`))
  return (
    <SidebarTooltip label={workspace.name} enabled={railCollapsed}>
      <Link
        href={protoRoutes.workspace(workspace.id)}
        className={cn(
          chipVariants({ active: inProject, fullWidth: true }),
          SIDEBAR_RAIL_CHIP_CLASS
        )}
      >
        <IdentityTile initial={workspace.name[0]} />
        <OverflowText
          label={workspace.name}
          className='sidebar-collapse-hide flex-1 text-[var(--text-body)]'
          focusTarget='nearest-interactive'
        />
        {!railCollapsed && workspace.needsYou > 0 && (
          <ChipTag variant='gray'>{workspace.needsYou}</ChipTag>
        )}
      </Link>
    </SidebarTooltip>
  )
}

interface ChatRowProps {
  chat: Chat
  href: string
  active: boolean
}

/** Title, then a spinner while an agent is running in it, else how long ago it moved. */
function ChatRow({ chat, href, active }: ChatRowProps) {
  const running = RUNNING_CHAT_IDS.has(chat.id)
  return (
    <Link href={href} className={cn(chipVariants({ active, fullWidth: true }), 'h-[26px] gap-2')}>
      <OverflowText
        label={chat.title}
        className='sidebar-collapse-hide flex-1 text-[var(--text-body)] text-small'
        focusTarget='nearest-interactive'
      />
      {running ? (
        <RunningDot />
      ) : (
        <span className='shrink-0 text-[var(--text-muted)] text-caption'>{chat.age}</span>
      )}
    </Link>
  )
}

interface SettingsSectionsProps {
  workspace: Workspace
  pathname: string | null
  railCollapsed: boolean
}

/** Settings: the project sidebar gives way to the settings list, grouped like prod. */
function SettingsSections({ workspace, pathname, railCollapsed }: SettingsSectionsProps) {
  const base = protoRoutes.settings(workspace.id)
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
              const href = protoRoutes.settings(workspace.id, item.id)
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
