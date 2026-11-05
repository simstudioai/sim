'use client'

import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CommandMenu } from '@/platform/app/(shell)/_components/command-menu/command-menu'
import {
  useDesktopCommands,
  useDesktopHost,
} from '@/platform/app/(shell)/_components/desktop/desktop-host'
import type { ShellChat, ShellData } from '@/platform/app/(shell)/_components/model'
import { NotificationTray } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import styles from '@/platform/app/(shell)/_components/platform-shell/platform-shell.module.css'
import { WindowHistoryButtons } from '@/platform/app/(shell)/_components/platform-shell/window-history'
import { useChatChanges } from '@/platform/app/(shell)/_components/session/chat-changes'
import { useSessionShellActions } from '@/platform/app/(shell)/_components/session/shell-actions'
import { SETTINGS_DESTINATIONS } from '@/platform/app/(shell)/_components/settings-navigation/destinations'
import { LEGACY_DESTINATION } from '@/platform/app/(shell)/_components/sidebar/row-links'
import { Sidebar } from '@/platform/app/(shell)/_components/sidebar/sidebar'
import { useSidebarLayout } from '@/platform/app/(shell)/_components/sidebar/sidebar-layout'
import { SidebarToolbar } from '@/platform/app/(shell)/_components/sidebar/sidebar-toolbar'
import { IconButton, OverflowText, ScrollArea, Tooltip } from '@/platform/design-system/components'
import { useCompactViewport } from '@/platform/design-system/components/layout/use-compact-viewport'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { platformHref } from '@/platform/design-system/navigation'
import { useLiveShellActions } from '@/platform/lib/data/shell-context'

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

/** A focused editor can claim a shortcut through `data-owned-shortcuts`, as on the legacy surface. */
function ownsShortcut(target: EventTarget | null, shortcut: string): boolean {
  const owner = target instanceof Element ? target.closest('[data-owned-shortcuts]') : null
  return Boolean(
    owner
      ?.getAttribute('data-owned-shortcuts')
      ?.split(',')
      .some((entry) => entry.trim() === shortcut)
  )
}

interface PlatformShellProps {
  data: ShellData | null
  /** A row of its own below any native titlebar, where the window controls stay reachable. */
  banner?: ReactNode
  children: ReactNode
}

export function PlatformShell({ data, banner, children }: PlatformShellProps) {
  const scrollEdges = useScrollEdges<HTMLDivElement>()
  const pathname = usePathname()
  const search = useSearchParams()
  const router = useRouter()
  const { collapsed, setCollapsed, order } = useSidebarLayout()
  const [drawer, setDrawer] = useState(false)
  const [command, setCommand] = useState(false)
  const compact = useCompactViewport('navigation')
  const desktop = useDesktopHost()
  const drawerRef = useRef<HTMLDialogElement>(null)
  const chat = useChatChanges()
  const sessionActions = useSessionShellActions()
  const actions = useLiveShellActions() ?? sessionActions
  const settingsEntry = useRef<string | null>(null)
  const settings = pathname.startsWith('/settings')
  const settingsDestinations: readonly { key: string; title: string }[] =
    data?.settingsNavigation?.flatMap((group) => group.items) ?? SETTINGS_DESTINATIONS
  const section = settings
    ? settingsDestinations.find((item) => item.key === (pathname.split('/')[2] || 'preferences'))
    : undefined
  const conversation = pathname.startsWith('/chat')
  const activeChat = conversation ? pathname.split('/')[2] : undefined
  const home = pathname === '/home'
  const integrations = pathname === '/integrations' || pathname.startsWith('/integrations/')
  const scrollingPage = home || integrations
  const chats = [...chat.created, ...(data?.chats ?? [])]
    .filter((item) => !chat.isRemoved(item.id))
    .map((item) => ({ ...item, title: chat.titleFor(item.id, item.title) }))
  const pinnedFirst = (a: ShellChat, b: ShellChat) => Number(b.isPinned) - Number(a.isPinned)
  if (order === 'Name (A–Z)')
    chats.sort((a, b) => pinnedFirst(a, b) || a.title.localeCompare(b.title))
  if (order === 'Name (Z–A)')
    chats.sort((a, b) => pinnedFirst(a, b) || b.title.localeCompare(a.title))
  const chatTitle = activeChat && (chats.find((item) => item.id === activeChat)?.title ?? 'Chat')
  const pageTitle = settings
    ? section
      ? `Settings / ${section.title}`
      : 'Settings'
    : conversation
      ? chatTitle || 'New chat'
      : integrations
        ? 'Integrations'
        : pathname === '/people' || pathname.startsWith('/people/')
          ? 'People'
          : 'Home'
  const drawerOpen = compact && drawer

  useEffect(() => {
    const dialog = drawerRef.current
    if (drawerOpen && dialog && !dialog.open) dialog.showModal()
    if (dialog?.open && !drawerOpen) dialog.close()
  }, [drawerOpen])

  useEffect(() => {
    if (!settings) settingsEntry.current = `${pathname}${search.size ? `?${search}` : ''}`
  }, [settings, pathname, search])

  const toggleOnShortcut = useEffectEvent(() => toggle())

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey)
      )
        return
      const key = event.key.toLowerCase()
      const modal = event.target instanceof Element ? event.target.closest('dialog:modal') : null
      const canOpen = !modal || modal === drawerRef.current
      if (key === 'k') {
        event.preventDefault()
        setCommand((open) => !open && canOpen)
      }
      if (
        key === 'b' &&
        canOpen &&
        !isEditableTarget(event.target) &&
        !ownsShortcut(event.target, 'Mod+B')
      ) {
        event.preventDefault()
        toggleOnShortcut()
      }
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [])

  useDesktopCommands((command) => {
    if (command === 'toggle-sidebar') toggle()
    if (command === 'open-search') setCommand((open) => !open)
  })

  function navigate(path: string) {
    setCommand(false)
    setDrawer(false)
    actions.requestLeave(() => {
      if (LEGACY_DESTINATION.test(path)) window.location.assign(path)
      else router.push(platformHref(path, search))
    })
  }
  function toggle() {
    if (compact) setDrawer((previous) => !previous)
    else setCollapsed(!collapsed)
  }
  const toolbar = (
    <SidebarToolbar
      items={data?.inbox ?? []}
      showInbox={!data?.unbacked?.includes('inbox')}
      navigate={navigate}
      onSearch={() => setCommand(true)}
      onCollapse={toggle}
    />
  )
  const sidebar = (
    <Sidebar
      data={data}
      actions={actions}
      chats={chats}
      activeChat={activeChat}
      pathname={pathname}
      settingsSection={section?.key}
      toolbar={(!desktop || compact) && toolbar}
      onBack={() => navigate(actions.settingsReturn(settingsEntry.current))}
      navigate={navigate}
      onNavigate={() => setDrawer(false)}
    />
  )

  const openControl = (
    <Tooltip label='Expand sidebar'>
      <IconButton label='Expand sidebar' icon='I066' size='row' onClick={toggle} />
    </Tooltip>
  )
  const webOpener = !desktop && (compact || collapsed) && (
    <div className={styles.openControl}>{openControl}</div>
  )
  return (
    <>
      <div
        className={styles.shell}
        data-desktop={desktop || undefined}
        data-conversation={conversation || undefined}
        data-sidebar-collapsed={collapsed || undefined}
        data-banner={banner ? true : undefined}
      >
        {desktop && (
          <header className={styles.desktopBar} data-desktop-drag=''>
            <div className={styles.desktopSidebar}>
              <WindowHistoryButtons />
              {!compact && !collapsed ? toolbar : openControl}
            </div>
            {!conversation && !(scrollingPage && compact) && (
              <span className={styles.desktopTitle} data-type='T067'>
                <OverflowText text={pageTitle}>{pageTitle}</OverflowText>
              </span>
            )}
          </header>
        )}
        {banner && <div className={styles.banner}>{banner}</div>}
        {!compact && sidebar}
        {!scrollingPage && webOpener}
        <div ref={scrollEdges} className={styles.content}>
          {scrollingPage ? (
            <ScrollArea
              key={pathname}
              label={home ? 'Home dashboard' : 'Organization integrations'}
            >
              <div className={styles.pageContent}>
                {webOpener}
                {children}
              </div>
            </ScrollArea>
          ) : (
            children
          )}
        </div>
        <dialog
          ref={drawerRef}
          className={styles.drawer}
          aria-label='Navigation drawer'
          onCancel={(event) => {
            event.preventDefault()
            setDrawer(false)
          }}
          onClick={(event) => {
            if (event.currentTarget === event.target) setDrawer(false)
          }}
        >
          {compact && sidebar}
        </dialog>
        <CommandMenu
          open={command}
          onClose={() => setCommand(false)}
          navigate={navigate}
          chats={chats}
          workspaces={data?.workspaces ?? []}
          destinations={data?.destinations}
        />
      </div>
      <NotificationTray history={data?.notifications ?? []} navigate={navigate} />
    </>
  )
}
