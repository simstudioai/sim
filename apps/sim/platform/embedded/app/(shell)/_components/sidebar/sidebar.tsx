'use client'

import { useRef, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { IconButton } from '@sim/emcn/button'
import { ControlRow } from '@sim/emcn/button/control-row'
import { Icon } from '@sim/emcn/icon'
import { ContextActionMenu } from '@sim/emcn/menu/action-menu'
import { ScrollArea } from '@sim/emcn/scroll-area'
import { Tooltip } from '@sim/emcn/tooltip'
import { Surface } from '@sim/emcn-platform/surface'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isMacPlatform } from '@/lib/core/utils/platform'
import { isPathOrDescendant, organizationRoutes } from '@/lib/navigation/paths'
import { useSidebarChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands'
import { useSidebarResize } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-sidebar-resize'
import { isSidebarBackgroundClick } from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import { CommandMenu } from '@/platform/embedded/app/(shell)/_components/command-menu/command-menu'
import { OrganizationMenu } from '@/platform/embedded/app/(shell)/_components/organization-menu/organization-menu'
import {
  SettingsBackButton,
  SettingsNavigation,
} from '@/platform/embedded/app/(shell)/_components/settings-navigation/settings-navigation'
import { AccountMenu } from '@/platform/embedded/app/(shell)/_components/sidebar/account-menu'
import { ChatsSection } from '@/platform/embedded/app/(shell)/_components/sidebar/chats-section'
import { HelpMenu } from '@/platform/embedded/app/(shell)/_components/sidebar/help-menu'
import styles from '@/platform/embedded/app/(shell)/_components/sidebar/sidebar.module.css'
import { WorkspacesSection } from '@/platform/embedded/app/(shell)/_components/sidebar/workspaces-section'
import { useNavWarmers } from '@/platform/embedded/lib/data/settings-warmers'
import { type OrganizationNavFlags, useOrganizationShell } from '@/platform/embedded/lib/data/shell'
import { useShellActions } from '@/platform/embedded/lib/data/shell-actions'
import { copyLinkAction, openInNewTabAction } from '@/platform/embedded/lib/row-links'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useFolderStore } from '@/stores/folders/store'
import { useSearchModalStore } from '@/stores/modals/search/store'
import { useSidebarStore } from '@/stores/sidebar/store'

const EDGE_KEY_STEP_PX = 16

/**
 * The organization surface's rail in the design system's style, hosted by the same `WorkspaceChrome`
 * as the workspace sidebar, so the collapse cookie, resize, mobile drawer and desktop peek behave the
 * same. Collapse and peek state come from the chrome.
 *
 * Settings swaps the header's organization menu for Back to app and the body for its own sections,
 * so the rail stays one design on every route. Nothing between a surface and the chrome is
 * positioned: a menu portals into its surface and is positioned against the chrome's frame, which is
 * what keeps it outside the rail's clipped width.
 */
export function Sidebar(flags: OrganizationNavFlags) {
  const { isCollapsed: railCollapsed, isPeeking, onToggle } = useSidebarChrome()
  const collapsed = railCollapsed && !isPeeking
  const pathname = usePathname() ?? ''
  const { data, retryChats, retryWorkspaces } = useOrganizationShell(flags)
  const actions = useShellActions()
  const { organization, destinations } = data
  const header = useRef<HTMLDivElement>(null)
  const footer = useRef<HTMLDivElement>(null)
  const { handlePointerDown } = useSidebarResize()
  const warmers = useNavWarmers()
  const [workspacesOpen, setWorkspacesOpen] = useState(true)
  const [chatsOpen, setChatsOpen] = useState(true)
  const setCommandOpen = useSearchModalStore((state) => state.setOpen)
  const railWidth = useSidebarStore((state) => state.renderedSidebarWidth)
  const setRailWidth = useSidebarStore((state) => state.setSidebarWidth)

  const routes = organizationRoutes(organization.id)
  const isSettings = isPathOrDescendant(pathname, routes.settings)
  const membersSettings = routes.settingsSection('members')
  const generalSettings = routes.settingsSection('general')
  const shortcutModifier = isMacPlatform() ? '⌘' : 'Ctrl+'

  useRegisterGlobalCommands(() =>
    createCommands([
      { id: 'toggle-sidebar', handler: () => onToggle() },
      { id: 'open-search', handler: () => setCommandOpen(!useSearchModalStore.getState().isOpen) },
    ])
  )

  return (
    <aside
      className={styles.sidebar}
      data-collapsed={collapsed || undefined}
      data-peeking={isPeeking || undefined}
      aria-label='Organization sidebar'
      onClick={(event) => {
        const onFlyout =
          event.target instanceof Element && event.target.closest('[data-material="floating"]')
        if (isSidebarBackgroundClick(event) && !onFlyout) {
          useFolderStore.getState().clearChatSelection()
        }
      }}
    >
      <div className={styles.column}>
        <Surface canvas>
          <div data-material='shell'>
            {!isPeeking && (
              <div
                aria-hidden
                className={`desktop-window-drag-region desktop-workspace-window-drag-region ${styles.dragLane}`}
              />
            )}
            <div ref={header} className={styles.header}>
              {collapsed ? (
                <ControlRow
                  render={<button type='button' onClick={onToggle} />}
                  accessibleLabel='Expand sidebar'
                  leading={
                    <span className={styles.railMark}>
                      <span className={styles.railLogo}>
                        <Avatar
                          name={organization.name}
                          src={organization.logo ?? undefined}
                          organization
                          size='inline'
                        />
                      </span>
                      <span className={styles.railGlyph}>
                        <Icon name='I066' />
                      </span>
                    </span>
                  }
                />
              ) : (
                <>
                  {isSettings ? (
                    <div className={styles.back}>
                      <SettingsBackButton />
                    </div>
                  ) : (
                    <OrganizationMenu
                      anchor={header}
                      organization={organization}
                      onOpen={() => warmers.warmSettings('members')}
                      onSettings={() => actions.navigate(membersSettings)}
                    />
                  )}
                  <div className={styles.actions}>
                    <Tooltip label={`Quick search (${shortcutModifier}K)`}>
                      <IconButton
                        size='row'
                        label='Quick search'
                        icon='I089'
                        onClick={() => setCommandOpen(true)}
                      />
                    </Tooltip>
                    <span className={styles.collapseControl}>
                      <Tooltip label={`Collapse sidebar (${shortcutModifier}B)`}>
                        <IconButton
                          size='row'
                          label='Collapse sidebar'
                          icon='I066'
                          onClick={onToggle}
                        />
                      </Tooltip>
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
          <CommandMenu
            navigate={actions.navigate}
            chats={data.chats}
            workspaces={data.workspaces}
            destinations={destinations}
          />
        </Surface>
        <div className={styles.body}>
          {isSettings ? (
            <Surface canvas>
              <div className={styles.settingsFrame} data-material='shell'>
                <SettingsNavigation collapsed={collapsed} />
              </div>
            </Surface>
          ) : (
            <Surface canvas>
              <div className={styles.bodyFrame} data-material='shell'>
                <nav className={styles.nav} aria-label='Main navigation'>
                  {destinations.map((item) => {
                    const selected = isPathOrDescendant(pathname, item.value)
                    const row = (
                      <ControlRow
                        label={collapsed ? undefined : item.label}
                        accessibleLabel={collapsed ? item.label : undefined}
                        icon={item.icon}
                        render={
                          <Link href={item.value} aria-current={selected ? 'page' : undefined} />
                        }
                      />
                    )
                    return (
                      <ContextActionMenu
                        key={item.id}
                        label={`Actions for ${item.label}`}
                        actions={[openInNewTabAction(item.value), copyLinkAction(item.value)]}
                      >
                        <div
                          className={styles.railRow}
                          onPointerEnter={() => {
                            if (!selected) warmers.schedule(item.id)
                          }}
                          onPointerLeave={warmers.cancel}
                        >
                          {collapsed ? <Tooltip label={item.label}>{row}</Tooltip> : row}
                        </div>
                      </ContextActionMenu>
                    )
                  })}
                </nav>
                <ScrollArea label='Workspaces and chats' hideScrollbar>
                  <div className={styles.sections}>
                    <WorkspacesSection
                      data={data}
                      actions={actions}
                      onRetry={retryWorkspaces}
                      collapsed={collapsed}
                      open={workspacesOpen}
                      onOpenChange={setWorkspacesOpen}
                    />
                    {data.chatsAvailable && (
                      <ChatsSection
                        organizationId={organization.id}
                        chats={data.chats}
                        status={data.status.chats}
                        onRetry={retryChats}
                        collapsed={collapsed}
                        open={chatsOpen}
                        onOpenChange={setChatsOpen}
                      />
                    )}
                  </div>
                </ScrollArea>
              </div>
            </Surface>
          )}
        </div>
        <Surface canvas>
          <div ref={footer} className={styles.footer} data-material='shell'>
            {data.user ? (
              <AccountMenu
                anchor={footer}
                name={data.user.name}
                image={data.user.image}
                iconOnly={collapsed}
                canSignOut={data.user.canSignOut}
                onOpen={() => warmers.warmSettings('general')}
                onSettings={() => actions.navigate(generalSettings)}
                onSignOut={actions.signOut}
              />
            ) : (
              <span className={styles.accountSkeleton} aria-hidden />
            )}
            <div className={styles.help}>
              <HelpMenu />
            </div>
          </div>
        </Surface>
      </div>
      {!isPeeking && (
        <div
          className={styles.edge}
          data-collapsed={collapsed || undefined}
          role={collapsed ? 'button' : 'separator'}
          tabIndex={0}
          aria-orientation={collapsed ? undefined : 'vertical'}
          aria-label={collapsed ? 'Expand sidebar' : 'Resize sidebar'}
          aria-valuenow={collapsed ? undefined : railWidth}
          aria-valuemin={collapsed ? undefined : SIDEBAR_WIDTH.MIN}
          aria-valuemax={collapsed ? undefined : SIDEBAR_WIDTH.MAX}
          onPointerDown={collapsed ? undefined : handlePointerDown}
          onClick={collapsed ? onToggle : undefined}
          onKeyDown={(event) => {
            if (collapsed && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              onToggle()
            } else if (!collapsed && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
              event.preventDefault()
              setRailWidth(railWidth + (event.key === 'ArrowLeft' ? -1 : 1) * EDGE_KEY_STEP_PX)
            }
          }}
        />
      )}
    </aside>
  )
}
