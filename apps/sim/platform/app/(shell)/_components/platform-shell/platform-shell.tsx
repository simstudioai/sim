'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CommandMenu } from '@/platform/app/(shell)/_components/command-menu/command-menu'
import { useDesktopHost } from '@/platform/app/(shell)/_components/desktop/desktop-host'
import type { ShellData } from '@/platform/app/(shell)/_components/model'
import { NotificationTray } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import styles from '@/platform/app/(shell)/_components/platform-shell/platform-shell.module.css'
import { WindowHistoryButtons } from '@/platform/app/(shell)/_components/platform-shell/window-history'
import { useChatChanges } from '@/platform/app/(shell)/_components/session/chat-changes'
import { SETTINGS_DESTINATIONS } from '@/platform/app/(shell)/_components/settings-navigation/destinations'
import { Sidebar } from '@/platform/app/(shell)/_components/sidebar/sidebar'
import { useSidebarLayout } from '@/platform/app/(shell)/_components/sidebar/sidebar-layout'
import { SidebarToolbar } from '@/platform/app/(shell)/_components/sidebar/sidebar-toolbar'
import { IconButton, OverflowText, ScrollArea, Tooltip } from '@/platform/design-system/components'
import { useCompactViewport } from '@/platform/design-system/components/layout/use-compact-viewport'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { platformHref } from '@/platform/design-system/navigation'

interface PlatformShellProps {
  data: ShellData | null
  children: ReactNode
}

export function PlatformShell({ data, children }: PlatformShellProps) {
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
  const settings = pathname.startsWith('/settings')
  const section = settings
    ? SETTINGS_DESTINATIONS.find((item) => item.key === (pathname.split('/')[2] || 'preferences'))
    : undefined
  const conversation = pathname.startsWith('/chat')
  const activeChat = conversation ? pathname.split('/')[2] : undefined
  const home = !settings && !conversation
  const chats = [...chat.created, ...(data?.chats ?? [])]
    .filter((item) => !chat.isRemoved(item.id))
    .map((item) => ({ ...item, title: chat.titleFor(item.id, item.title) }))
  if (order === 'Name (A–Z)') chats.sort((a, b) => a.title.localeCompare(b.title))
  if (order === 'Name (Z–A)') chats.sort((a, b) => b.title.localeCompare(a.title))
  const chatTitle = activeChat && (chats.find((item) => item.id === activeChat)?.title ?? 'Chat')
  const pageTitle = settings
    ? section
      ? `Settings / ${section.title}`
      : 'Settings'
    : conversation
      ? chatTitle || 'New chat'
      : 'Home'
  const drawerOpen = compact && drawer

  useEffect(() => {
    const dialog = drawerRef.current
    if (drawerOpen && dialog && !dialog.open) dialog.showModal()
    if (dialog?.open && !drawerOpen) dialog.close()
  }, [drawerOpen])

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'k'
      )
        return
      event.preventDefault()
      setCommand((previous) => !previous)
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [])

  function navigate(path: string) {
    setCommand(false)
    setDrawer(false)
    router.push(platformHref(path, search))
  }
  function toggle() {
    if (compact) setDrawer((previous) => !previous)
    else setCollapsed((previous) => !previous)
  }
  const actions = (
    <SidebarToolbar
      items={data?.inbox ?? []}
      navigate={navigate}
      onSearch={() => setCommand(true)}
      onCollapse={toggle}
    />
  )
  const sidebar = (
    <Sidebar
      data={data}
      chats={chats}
      activeChat={activeChat}
      home={home}
      settingsSection={section?.key}
      actions={(!desktop || compact) && actions}
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
      >
        {desktop && (
          <header className={styles.desktopBar} data-desktop-drag=''>
            <div className={styles.desktopSidebar}>
              <WindowHistoryButtons />
              {!compact && !collapsed ? actions : openControl}
            </div>
            {!conversation && !(home && compact) && (
              <span className={styles.desktopTitle} data-type='T067'>
                <OverflowText text={pageTitle}>{pageTitle}</OverflowText>
              </span>
            )}
          </header>
        )}
        {!compact && sidebar}
        {!home && webOpener}
        <div ref={scrollEdges} className={styles.content}>
          {home ? (
            <ScrollArea label='Home dashboard'>
              <div className={styles.homeContent}>
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
        />
      </div>
      <NotificationTray history={data?.notifications ?? []} navigate={navigate} />
    </>
  )
}
