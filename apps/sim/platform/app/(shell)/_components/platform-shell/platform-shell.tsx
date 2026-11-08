'use client'

import {
  type ReactNode,
  Suspense,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { IconButton } from '@sim/emcn/button'
import { useCompactViewport } from '@sim/emcn/layout/use-compact-viewport'
import { OverflowText } from '@sim/emcn/overflow-text'
import { ScrollArea } from '@sim/emcn/scroll-area'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { Tooltip } from '@sim/emcn/tooltip'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CommandMenu } from '@/platform/app/(shell)/_components/command-menu/command-menu'
import {
  useDesktopCommands,
  useDesktopHost,
} from '@/platform/app/(shell)/_components/desktop/desktop-host'
import type { ShellData } from '@/platform/app/(shell)/_components/model'
import { NotificationTray } from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import styles from '@/platform/app/(shell)/_components/platform-shell/platform-shell.module.css'
import { WindowHistoryButtons } from '@/platform/app/(shell)/_components/platform-shell/window-history'
import { useSessionShell } from '@/platform/app/(shell)/_components/session/shell-actions'
import { orderSidebarItems } from '@/platform/app/(shell)/_components/sidebar/collection-order'
import { Sidebar } from '@/platform/app/(shell)/_components/sidebar/sidebar'
import { useSidebarLayout } from '@/platform/app/(shell)/_components/sidebar/sidebar-layout'
import { SidebarToolbar } from '@/platform/app/(shell)/_components/sidebar/sidebar-toolbar'
import { workspaceNavigation } from '@/platform/app/(shell)/_components/workspace-navigation/destinations'
import { useLiveShellActions } from '@/platform/lib/data/shell-context'
import { isAbsoluteHref, platformHref } from '@/platform/lib/navigation'
import { isWorkspaceTab, workspaceLocation } from '@/platform/lib/workspace-navigation'

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

interface PlatformShellProps {
  data: ShellData | null
  /** A row of its own below any native titlebar, where the window controls stay reachable. */
  banner?: ReactNode
  children: ReactNode
}

export function PlatformShell({ data, banner, children }: PlatformShellProps) {
  const content = useRef<HTMLDivElement>(null)
  const scrollEdges = useScrollEdges<HTMLDivElement>('vertical', { viewport: content })
  const pathname = usePathname()
  const search = useSearchParams()
  const router = useRouter()
  const { collapsed, setCollapsed, chatOrder, workspaceOrder } = useSidebarLayout()
  const [drawer, setDrawer] = useState(false)
  const [command, setCommand] = useState(false)
  const compact = useCompactViewport('navigation')
  const desktop = useDesktopHost()
  const drawerRef = useRef<HTMLDialogElement>(null)
  const liveActions = useLiveShellActions()
  const session = useSessionShell(liveActions ? null : data)
  const actions = liveActions ?? session.actions
  const settingsEntry = useRef<string | null>(null)
  const settings = pathname.startsWith('/settings')
  const settingsDestinations: readonly { key: string; title: string }[] =
    data?.settingsNavigation?.flatMap((group) => group.items) ?? []
  const section = settings
    ? settingsDestinations.find((item) => item.key === (pathname.split('/')[2] || 'general'))
    : undefined
  const location = workspaceLocation(pathname)
  const workspaceChat = location?.section === 'chat'
  const conversation = workspaceChat || pathname.startsWith('/chat')
  const activeChat = workspaceChat
    ? location.detail
    : conversation
      ? pathname.split('/')[2]
      : undefined
  const home = pathname === '/home'
  const integrations = pathname === '/integrations' || pathname.startsWith('/integrations/')
  const people = pathname === '/people' || pathname.startsWith('/people/')
  const workspace = data?.workspaces.find((item) => item.id === location?.id)
  const navigation = location
    ? workspaceNavigation(location.id, workspace?.workflows, data?.unbacked)
    : null
  const workspaceItems = navigation && [
    ...navigation.primary,
    ...navigation.pages,
    ...navigation.workflows,
  ]
  const directory = location?.section === 'integrations' || location?.section === 'skills'
  /** A workspace tab scrolls as one page; a record's details scroll only their reading column. */
  const workspaceReading = isWorkspaceTab(location?.section) && !location?.detail
  const scrollingPage = home || integrations || directory || workspaceReading
  const chats = orderSidebarItems(
    liveActions ? (data?.chats ?? []) : session.chats,
    chatOrder,
    (item) => item.title,
    (left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
  )
  const workspaces = orderSidebarItems(
    liveActions ? (data?.workspaces ?? []) : session.workspaces,
    workspaceOrder,
    (item) => item.name
  )
  const organizationChats = chats.filter((chat) => !chat.workspaceId)
  const workspaceChats = location ? chats.filter((chat) => chat.workspaceId === location.id) : []
  const chatTitle = activeChat && (chats.find((item) => item.id === activeChat)?.title ?? 'Chat')
  const workspaceTitle = workspaceItems?.find(
    (item) =>
      item.value === pathname || (item.id !== 'back' && pathname.startsWith(`${item.value}/`))
  )?.label
  const pageTitle =
    workspaceTitle ??
    (settings
      ? section
        ? `Settings / ${section.title}`
        : 'Settings'
      : conversation
        ? chatTitle || 'New chat'
        : integrations
          ? 'Integrations'
          : pathname === '/people' || pathname.startsWith('/people/')
            ? 'People'
            : 'Home')
  const drawerOpen = compact && drawer

  useEffect(() => {
    const dialog = drawerRef.current
    if (drawerOpen && dialog && !dialog.open) dialog.showModal()
    if (dialog?.open && !drawerOpen) dialog.close()
  }, [drawerOpen])

  useEffect(() => {
    if (!settings)
      settingsEntry.current = `${pathname}${search.size ? `?${search}` : ''}${window.location.hash}`
  }, [settings, pathname, search])

  // A workspace page starts at the top unless it has just restored where its reader left it.
  useLayoutEffect(() => {
    const viewport = content.current
    const restored = viewport?.dataset.restoredScroll === window.location.pathname
    if (viewport) delete viewport.dataset.restoredScroll
    if (!restored && pathname.startsWith('/workspace/')) viewport?.scrollTo({ top: 0 })
  }, [pathname])

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
      if (key === 'b' && canOpen && !isEditableTarget(event.target)) {
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
      if (isAbsoluteHref(path)) window.location.assign(path)
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
      data={data && { ...data, workspaces }}
      actions={actions}
      chats={organizationChats}
      workspaceChats={workspaceChats}
      activeChat={activeChat}
      pathname={pathname}
      settingsSection={settings ? pathname.split('/')[2] || 'general' : undefined}
      toolbar={(!desktop || compact) && toolbar}
      onBack={() => navigate(settingsEntry.current ?? actions.settingsLanding)}
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
        {webOpener}
        <div
          ref={scrollEdges}
          role={location ? 'region' : undefined}
          aria-label={location ? `Workspace ${workspaceTitle ?? 'content'}` : undefined}
          className={styles.content}
          data-page-opener={
            (scrollingPage || people || (location && !workspaceChat)) && webOpener
              ? true
              : undefined
          }
        >
          {/* Unkeyed, so a navigation keeps the current page until the next one is ready. */}
          <Suspense fallback={null}>
            {location && !workspaceChat ? (
              <div
                className={styles.pageContent}
                data-workspace-pane={directory || workspaceReading ? undefined : true}
                data-workspace-page={workspaceReading || undefined}
              >
                {children}
              </div>
            ) : scrollingPage ? (
              <ScrollArea
                key={pathname}
                label={home ? 'Home dashboard' : 'Organization integrations'}
              >
                <div className={styles.pageContent}>{children}</div>
              </ScrollArea>
            ) : (
              children
            )}
          </Suspense>
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
          chats={location ? workspaceChats : organizationChats}
          workspaces={location ? [] : workspaces}
          destinations={workspaceItems ?? data?.destinations}
        />
      </div>
      <NotificationTray history={data?.notifications ?? []} navigate={navigate} />
    </>
  )
}
