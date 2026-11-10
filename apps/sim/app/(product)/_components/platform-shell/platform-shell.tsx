'use client'

import { type ReactNode, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { useCompactViewport } from '@sim/emcn/layout/use-compact-viewport'
import { OverflowText } from '@sim/emcn/overflow-text'
import { ScrollArea } from '@sim/emcn/scroll-area'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { Tooltip } from '@sim/emcn/tooltip'
import { compareStrings } from '@sim/utils/string'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CommandMenu } from '@/app/(product)/_components/command-menu/command-menu'
import { PageCommandsProvider } from '@/app/(product)/_components/command-menu/page-commands'
import { useDesktopHost } from '@/app/(product)/_components/desktop/desktop-host'
import { NotificationTray } from '@/app/(product)/_components/notification-tray/notification-tray'
import styles from '@/app/(product)/_components/platform-shell/platform-shell.module.css'
import { useShellShortcuts } from '@/app/(product)/_components/platform-shell/shell-shortcuts'
import { WindowHistoryButtons } from '@/app/(product)/_components/platform-shell/window-history'
import { useSessionShell } from '@/app/(product)/_components/session/shell-actions'
import { orderSidebarItems } from '@/app/(product)/_components/sidebar/collection-order'
import { Sidebar } from '@/app/(product)/_components/sidebar/sidebar'
import { useSidebarLayout } from '@/app/(product)/_components/sidebar/sidebar-layout'
import { SidebarToolbar } from '@/app/(product)/_components/sidebar/sidebar-toolbar'
import type { ShellData } from '@/platform/lib/data/models/shell'
import { useLiveShellActions } from '@/platform/lib/data/shell-context'
import { platformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'
import { workspaceLocation } from '@/platform/lib/workspace-navigation'

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
  const { routePrefix } = useSurfaceScope()
  const surfacePath =
    pathname === routePrefix || pathname.startsWith(`${routePrefix}/`)
      ? pathname.slice(routePrefix.length)
      : pathname
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
  const settings = surfacePath.startsWith('/settings')
  const settingsDestinations: readonly { key: string; title: string }[] =
    data?.settingsNavigation?.flatMap((group) => group.items) ?? []
  const section = settings
    ? settingsDestinations.find((item) => item.key === (surfacePath.split('/')[2] || 'general'))
    : undefined
  const location = workspaceLocation(pathname)
  const conversation = surfacePath.startsWith('/chat')
  /** An agent chat opens under `/chat`, an assistant chat under Search. */
  const activeChat = /^\/(?:search\/)?chat\/([^/]+)/.exec(surfacePath)?.[1]
  const home = surfacePath === '/home'
  const integrations = surfacePath === '/integrations' || surfacePath.startsWith('/integrations/')
  const people = surfacePath === '/people' || surfacePath.startsWith('/people/')
  const searchPage = surfacePath === '/search' || surfacePath.startsWith('/search/')
  const workspace = data?.workspaces.find((item) => item.id === location?.id)
  const scrollingPage = home || integrations || Boolean(location && !location.detail)
  const chats = orderSidebarItems(
    liveActions ? (data?.chats ?? []) : session.chats,
    chatOrder,
    (item) => item.title,
    (left, right) => compareStrings(right.updatedAt ?? '', left.updatedAt ?? '')
  )
  const workspaces = orderSidebarItems(
    liveActions ? (data?.workspaces ?? []) : session.workspaces,
    workspaceOrder,
    (item) => item.name
  )
  const chatTitle = activeChat && (chats.find((item) => item.id === activeChat)?.title ?? 'Chat')
  const pageTitle = location
    ? (workspace?.name ?? 'Workspace')
    : settings
      ? section
        ? `Settings / ${section.title}`
        : 'Settings'
      : conversation
        ? chatTitle || 'New chat'
        : searchPage
          ? chatTitle || 'Search'
          : integrations
            ? 'Integrations'
            : people
              ? 'People'
              : 'Home'
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

  useShellShortcuts({
    drawer: drawerRef,
    toggleSidebar: () => toggle(),
    toggleCommand: (canOpen) => setCommand((open) => !open && canOpen),
  })

  function navigate(path: string) {
    setCommand(false)
    setDrawer(false)
    actions.requestLeave(() => router.push(platformHref(path, search)))
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
      chats={chats}
      activeChat={activeChat}
      pathname={pathname}
      settingsSection={settings ? surfacePath.split('/')[2] || 'general' : undefined}
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
    <PageCommandsProvider>
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
          className={styles.content}
          data-page-opener={(scrollingPage || people || location) && webOpener ? true : undefined}
        >
          {/* Unkeyed, so a navigation keeps the current page until the next one is ready. */}
          <Suspense fallback={null}>
            {location ? (
              <div
                className={styles.pageContent}
                data-workspace={location.detail ? 'record' : 'page'}
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
          chats={chats}
          workspaces={workspaces}
          destinations={data?.destinations}
        />
      </div>
      <NotificationTray history={data?.notifications ?? []} navigate={navigate} />
    </PageCommandsProvider>
  )
}
