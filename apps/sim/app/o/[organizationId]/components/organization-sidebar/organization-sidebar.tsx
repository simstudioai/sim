'use client'

import { type ComponentProps, memo, useCallback, useRef, useState } from 'react'
import { Chip, cn, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'
import { PanelLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { usePathname } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { isMacPlatform } from '@/lib/core/utils/platform'
import { DOCS_URL, SLACK_COMMUNITY_URL } from '@/lib/help-links'
import { organizationRoutes } from '@/lib/navigation/paths'
import { captureEvent } from '@/lib/posthog/client'
import {
  ChatsSection,
  OrganizationFooter,
  OrganizationHeader,
  WorkspacesSection,
} from '@/app/o/[organizationId]/components/organization-sidebar/components'
import {
  useCollapsedTooltips,
  useOrganizationChats,
} from '@/app/o/[organizationId]/components/organization-sidebar/hooks'
import { buildOrganizationNavItems } from '@/app/o/[organizationId]/components/organization-sidebar/navigation'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { OrganizationSettingsSidebar } from '@/app/o/[organizationId]/settings/organization-settings-sidebar'
import { useSidebarChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  isNavItemActive,
  NavItemContextMenu,
  SidebarNavChip,
  SidebarTooltip,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components'
import {
  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
  SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
  SIDEBAR_ITEM_GAP_CLASS,
  SIDEBAR_SECTION_GAP_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useSidebarResize } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useContextMenu } from '@/hooks/use-context-menu'
import { useSidebarStore } from '@/stores/sidebar/store'

const logger = createLogger('OrganizationSidebar')

/**
 * Opts a control out of the desktop shell's window-drag region. The header row is
 * draggable chrome, so anything clickable inside it has to say so or the click is
 * swallowed by the drag handler.
 */
const DRAG_EXEMPT_CLASS = '[-webkit-app-region:no-drag]'

interface OrganizationChatsProps
  extends Omit<ComponentProps<typeof ChatsSection>, 'chats' | 'isLoading'> {
  organizationId: string
}

function OrganizationChats({ organizationId, ...props }: OrganizationChatsProps) {
  const { chats, isLoading } = useOrganizationChats(organizationId)
  return <ChatsSection {...props} chats={chats} isLoading={isLoading} />
}

/**
 * The organization surface's rail: the same chrome as the workspace sidebar —
 * header row, pinned nav block, a divided scroll region of sections, and the
 * pinned footer — hosted by the same `WorkspaceChrome`, so collapse, resize, and
 * the desktop hover-peek all behave identically. Collapse and peek state come from
 * the chrome through {@link useSidebarChrome}.
 */
export const OrganizationSidebar = memo(function OrganizationSidebar() {
  const { isCollapsed: railCollapsed, isPeeking } = useSidebarChrome()
  /** The peek card always renders the expanded layout, whatever the rail's state. */
  const isCollapsed = railCollapsed && !isPeeking

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)

  const pathname = usePathname()
  const posthog = usePostHog()
  const { organization, searchAccess } = useOrganizationContext()
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed)
  const { handlePointerDown } = useSidebarResize()
  const showCollapsedTooltips = useCollapsedTooltips(isCollapsed)
  const scrollEdges = useScrollEdges(scrollContainerRef, {
    contentRef: scrollContentRef,
    enabled: !isCollapsed,
  })

  const isMac = isMacPlatform()
  const navItems = buildOrganizationNavItems(organization.id, searchAccess.memberScoped)
  const settingsPath = organizationRoutes(organization.id).settings
  const isSettings = pathname === settingsPath || pathname?.startsWith(`${settingsPath}/`)

  /**
   * One menu serves every href-bearing row (nav items, workspaces, chats): the
   * actions — open in a new tab, copy the link — only need the destination.
   */
  const [menuHref, setMenuHref] = useState<string | null>(null)
  const {
    isOpen: isHrefMenuOpen,
    position: hrefMenuPosition,
    menuRef: hrefMenuRef,
    handleContextMenu: openHrefMenu,
    closeMenu: closeHrefMenu,
  } = useContextMenu()

  const handleHrefContextMenu = useCallback(
    (e: React.MouseEvent, href: string) => {
      setMenuHref(href)
      openHrefMenu(e)
    },
    [openHrefMenu]
  )

  /** Anchors the menu to the row's options button rather than the pointer. */
  const handleChatMoreClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, href: string) => {
      if (isHrefMenuOpen) {
        closeHrefMenu()
        return
      }
      const rect = e.currentTarget.getBoundingClientRect()
      setMenuHref(href)
      openHrefMenu({
        preventDefault: () => {},
        stopPropagation: () => {},
        clientX: rect.right,
        clientY: rect.top,
      } as React.MouseEvent)
    },
    [isHrefMenuOpen, closeHrefMenu, openHrefMenu]
  )

  const handleHrefMenuClose = () => {
    closeHrefMenu()
    setMenuHref(null)
  }

  const handleOpenInNewTab = () => {
    if (menuHref) window.open(menuHref, '_blank', 'noopener,noreferrer')
  }

  const handleCopyLink = async () => {
    if (!menuHref) return
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${menuHref}`)
    } catch (error) {
      logger.error('Failed to copy link to clipboard', { error })
    }
  }

  const handleOpenDocs = () => {
    window.open(DOCS_URL, '_blank', 'noopener,noreferrer')
    captureEvent(posthog, 'docs_opened', { source: 'help_menu' })
  }

  const handleOpenSlackCommunity = () => {
    window.open(SLACK_COMMUNITY_URL, '_blank', 'noopener,noreferrer')
    captureEvent(posthog, 'slack_community_opened', { source: 'help_menu' })
  }

  const handleEdgeKeyDown = (e: React.KeyboardEvent) => {
    if (isCollapsed && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      toggleCollapsed()
    }
  }

  useRegisterGlobalCommands(() =>
    createCommands([
      {
        id: 'toggle-sidebar',
        handler: () => {
          toggleCollapsed()
        },
      },
    ])
  )

  return (
    <div className='relative h-full'>
      <aside
        className='group/rail sidebar-container relative h-full overflow-hidden bg-[var(--surface-1)] [&_.group.cursor-pointer]:duration-0'
        data-collapsed={isCollapsed || undefined}
        aria-label='Organization sidebar'
      >
        <div className='flex h-full flex-col'>
          {/* The peek card already sits below the lane; reserving it again doubles the offset. */}
          {!isPeeking && (
            <div
              aria-hidden
              className='desktop-window-drag-region desktop-workspace-window-drag-region h-[var(--desktop-title-bar-height)]'
            />
          )}
          <div
            className={cn(
              'relative flex shrink-0 items-center px-2 pt-2',
              !isPeeking &&
                '[[data-sim-desktop-title-bar=inset]_&]:pt-[var(--desktop-title-bar-height)]'
            )}
          >
            <OrganizationHeader
              organization={organization}
              isCollapsed={isCollapsed}
              onExpandSidebar={toggleCollapsed}
            />
            <div
              inert={isCollapsed}
              className={cn(
                'flex h-[30px] items-center gap-[1px] overflow-hidden',
                isCollapsed
                  ? 'w-0 opacity-0'
                  : 'w-[32px] [[data-sim-desktop-title-bar=inset]_&]:w-0'
              )}
            >
              <SidebarTooltip
                label='Collapse sidebar'
                enabled={!isCollapsed}
                side='bottom'
                shortcut={isMac ? '⌘B' : 'Ctrl+B'}
              >
                <Chip
                  leftIcon={PanelLeft}
                  aria-label='Collapse sidebar'
                  onClick={toggleCollapsed}
                  tabIndex={isCollapsed ? -1 : undefined}
                  className={cn(DRAG_EXEMPT_CLASS, '[[data-sim-desktop-title-bar=inset]_&]:hidden')}
                />
              </SidebarTooltip>
            </div>
          </div>

          {isSettings ? (
            <OrganizationSettingsSidebar
              isCollapsed={isCollapsed}
              showCollapsedTooltips={showCollapsedTooltips}
            />
          ) : (
            <>
              {/* The divider is the pinned block's bottom rule, not the scroll region's top one:
              the region's edge fade masks its own first pixels, which would erase a rule
              drawn there exactly when it should show. Same construction as the footer. */}
              <div
                className={cn(
                  SIDEBAR_SECTION_GAP_CLASS,
                  SIDEBAR_ITEM_GAP_CLASS,
                  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
                  'flex shrink-0 flex-col border-b px-2 transition-colors duration-150',
                  !scrollEdges.top && 'border-transparent'
                )}
              >
                {navItems.map((item) => {
                  const active = isNavItemActive(item, pathname)
                  return (
                    <SidebarTooltip
                      key={item.id}
                      label={item.label}
                      enabled={showCollapsedTooltips}
                    >
                      <SidebarNavChip
                        item={item}
                        active={active}
                        onContextMenu={(e) => handleHrefContextMenu(e, item.href as string)}
                      />
                    </SidebarTooltip>
                  )
                })}
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
                  <WorkspacesSection
                    organizationId={organization.id}
                    isCollapsed={isCollapsed}
                    pathname={pathname}
                    onContextMenu={handleHrefContextMenu}
                  />
                  {searchAccess.memberScoped && (
                    <OrganizationChats
                      organizationId={organization.id}
                      isCollapsed={isCollapsed}
                      pathname={pathname}
                      menuOpenHref={isHrefMenuOpen ? menuHref : null}
                      onContextMenu={handleHrefContextMenu}
                      onMoreClick={handleChatMoreClick}
                    />
                  )}
                </div>
              </div>
            </>
          )}
          <OrganizationFooter
            showDivider={scrollEdges.bottom}
            isCollapsed={isCollapsed}
            showCollapsedTooltips={showCollapsedTooltips}
            onOpenDocs={handleOpenDocs}
            onJoinSlack={handleOpenSlackCommunity}
          />

          <NavItemContextMenu
            isOpen={isHrefMenuOpen}
            position={hrefMenuPosition}
            menuRef={hrefMenuRef}
            onClose={handleHrefMenuClose}
            onOpenInNewTab={handleOpenInNewTab}
            onCopyLink={handleCopyLink}
          />
        </div>
      </aside>

      {/* Not on the peek card: the resize hook writes an inline `--sidebar-width` that
          out-specifies the `[data-peek]` rule, stranding the card at a stale width. */}
      {!isPeeking && (
        <div
          className={cn(
            'absolute top-0 right-0 bottom-0 z-20 w-[8px] translate-x-1/2',
            isCollapsed ? 'cursor-e-resize' : 'cursor-ew-resize'
          )}
          onPointerDown={isCollapsed ? undefined : handlePointerDown}
          onClick={isCollapsed ? toggleCollapsed : undefined}
          onKeyDown={handleEdgeKeyDown}
          role={isCollapsed ? 'button' : 'separator'}
          tabIndex={0}
          aria-orientation={isCollapsed ? undefined : 'vertical'}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Resize sidebar'}
        />
      )}
    </div>
  )
})
