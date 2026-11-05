'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getOrganizationSettingsHref } from '@/components/settings/navigation'
import { isMacPlatform } from '@/lib/core/utils/platform'
import { organizationRoutes } from '@/lib/navigation/paths'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { OrganizationSettingsRail } from '@/app/o/[organizationId]/settings/organization-settings-rail'
import { useSidebarChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands'
import { useSidebarResize } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-sidebar-resize'
import { isSidebarBackgroundClick } from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import { CommandMenu } from '@/platform/app/(shell)/_components/command-menu/command-menu'
import { OrganizationMenu } from '@/platform/app/(shell)/_components/organization-menu/organization-menu'
import { AccountMenu } from '@/platform/app/(shell)/_components/sidebar/account-menu'
import { ChatsSection } from '@/platform/app/(shell)/_components/sidebar/chats-section'
import { HelpMenu } from '@/platform/app/(shell)/_components/sidebar/help-menu'
import {
  copyLinkAction,
  openInNewTabAction,
} from '@/platform/app/(shell)/_components/sidebar/row-links'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar.module.css'
import { WorkspacesSection } from '@/platform/app/(shell)/_components/sidebar/workspaces-section'
import {
  Avatar,
  ContextActionMenu,
  Icon,
  IconButton,
  ScrollArea,
  Tooltip,
} from '@/platform/design-system/components'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import { useNavWarmers } from '@/platform/lib/data/nav-warmers'
import { type OrganizationNavFlags, useOrganizationShell } from '@/platform/lib/data/shell'
import { useFolderStore } from '@/stores/folders/store'
import { useSearchModalStore } from '@/stores/modals/search/store'

/** Menus and dialogs portal into their surface, so unlike legacy popovers they sit inside the rail. */
const OVERLAY_SELECTOR = '[data-side], dialog'

/**
 * The organization surface's rail in the design system's style, hosted by the same `WorkspaceChrome`
 * as the workspace sidebar, so the collapse cookie, resize, mobile drawer and desktop peek behave the
 * same. Collapse and peek state come from the chrome.
 *
 * Three surfaces beside each other rather than one around the rail, because Settings keeps its own
 * legacy navigation between the header and footer, and nothing legacy can render inside a surface.
 * Nothing between a surface and the chrome is positioned: a menu portals into its surface and is
 * positioned against the chrome's frame, which is what keeps it outside the rail's clipped width.
 */
export function Sidebar(flags: OrganizationNavFlags) {
  const { isCollapsed: railCollapsed, isPeeking, onToggle } = useSidebarChrome()
  const collapsed = railCollapsed && !isPeeking
  const pathname = usePathname()
  const router = useRouter()
  const { data, actions } = useOrganizationShell(flags)
  const { organization, destinations } = data
  const header = useRef<HTMLDivElement>(null)
  const footer = useRef<HTMLDivElement>(null)
  const { handlePointerDown } = useSidebarResize()
  const warmers = useNavWarmers(organization.id)
  const [workspacesOpen, setWorkspacesOpen] = useState(true)
  const [chatsOpen, setChatsOpen] = useState(true)
  const commandOpen = useSearchModalStore((state) => state.isOpen)
  const setCommandOpen = useSearchModalStore((state) => state.setOpen)

  const settingsPath = organizationRoutes(organization.id).settings
  const isSettings = pathname === settingsPath || Boolean(pathname?.startsWith(`${settingsPath}/`))
  const membersSettings = getOrganizationSettingsHref(organization.id, 'members')
  const generalSettings = organizationRoutes(organization.id).settingsSection('general')
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
      data-settings={isSettings || undefined}
      aria-label='Organization sidebar'
      onClick={(event) => {
        const overlay = event.target instanceof Element && event.target.closest(OVERLAY_SELECTOR)
        if (!overlay && isSidebarBackgroundClick(event))
          useFolderStore.getState().clearChatSelection()
      }}
    >
      <div className={styles.column}>
        <RedesignSurface>
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
                  <OrganizationMenu
                    anchor={header}
                    organization={organization}
                    actions={actions.organization}
                    onOpen={() => router.prefetch(membersSettings)}
                    onSettings={() => actions.navigate(membersSettings)}
                  />
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
            open={commandOpen}
            onClose={() => setCommandOpen(false)}
            navigate={(href) => {
              setCommandOpen(false)
              actions.navigate(href)
            }}
            chats={data.chats}
            workspaces={data.workspaces}
            destinations={destinations}
          />
        </RedesignSurface>
        <div className={styles.body}>
          {isSettings ? (
            <OrganizationSettingsRail isCollapsed={collapsed} showCollapsedTooltips={collapsed} />
          ) : (
            <RedesignSurface>
              <div className={styles.bodyFrame} data-material='shell'>
                <nav className={styles.nav} aria-label='Main navigation'>
                  {destinations.map((item) => {
                    const selected =
                      pathname === item.value || Boolean(pathname?.startsWith(`${item.value}/`))
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
                      collapsed={collapsed}
                      open={workspacesOpen}
                      onOpenChange={setWorkspacesOpen}
                    />
                    {data.chatsAvailable && (
                      <ChatsSection
                        organizationId={organization.id}
                        chats={data.chats}
                        status={data.status.chats}
                        actions={actions.chats}
                        collapsed={collapsed}
                        open={chatsOpen}
                        onOpenChange={setChatsOpen}
                      />
                    )}
                  </div>
                </ScrollArea>
              </div>
            </RedesignSurface>
          )}
        </div>
        <RedesignSurface>
          <div ref={footer} className={styles.footer} data-material='shell'>
            {data.user ? (
              <AccountMenu
                anchor={footer}
                name={data.user.name}
                image={data.user.image}
                iconOnly={collapsed}
                canSignOut={data.user.canSignOut}
                onOpen={() => router.prefetch(generalSettings)}
                onSettings={() => actions.navigate(generalSettings)}
                onSignOut={actions.signOut}
              />
            ) : (
              <span className={styles.accountSkeleton} aria-hidden />
            )}
            <div className={styles.help}>
              <HelpMenu help={actions.help} />
            </div>
          </div>
        </RedesignSurface>
      </div>
      {!isPeeking && (
        <div
          className={styles.edge}
          data-collapsed={collapsed || undefined}
          role={collapsed ? 'button' : 'separator'}
          tabIndex={0}
          aria-orientation={collapsed ? undefined : 'vertical'}
          aria-label={collapsed ? 'Expand sidebar' : 'Resize sidebar'}
          onPointerDown={collapsed ? undefined : handlePointerDown}
          onClick={collapsed ? onToggle : undefined}
          onKeyDown={(event) => {
            if (collapsed && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              onToggle()
            }
          }}
        />
      )}
    </aside>
  )
}
