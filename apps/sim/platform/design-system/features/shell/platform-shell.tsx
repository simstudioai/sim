'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ComponentRecipe } from '@/platform/design-system/catalog/component-recipe'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import {
  AvatarImage,
  Chip,
  Icon,
  IconButton,
  ScrollArea,
  Tooltip,
} from '@/platform/design-system/components'
import { avatarInitials } from '@/platform/design-system/components/avatar-initials'
import { useChatChanges } from '@/platform/design-system/components/chat-changes'
import { CommandSearch } from '@/platform/design-system/components/command-search'
import { useDesktopHost } from '@/platform/design-system/components/desktop-host'
import { HelpMenu } from '@/platform/design-system/components/help-menu'
import { useInterfacePreferences } from '@/platform/design-system/components/interface-preferences'
import { NotificationTray } from '@/platform/design-system/components/notification-tray'
import { OverlayDialog } from '@/platform/design-system/components/overlay-dialog'
import { usePlatformTheme } from '@/platform/design-system/components/product-surface'
import { useSidebarLayout } from '@/platform/design-system/components/sidebar-layout'
import { useCompactViewport } from '@/platform/design-system/components/use-compact-viewport'
import { NotificationCenter } from '@/platform/design-system/features/shell/notification-center'
import { OrganizationControl } from '@/platform/design-system/features/shell/organization-control'
import styles from '@/platform/design-system/features/shell/shell.module.css'
import { SidebarCollections } from '@/platform/design-system/features/shell/sidebar-collections'
import { WindowHistoryButtons } from '@/platform/design-system/features/shell/window-history'
import type { ShellData } from '@/platform/design-system/models/shell'
import { platformHref } from '@/platform/design-system/navigation'

interface PlatformShellProps {
  data: ShellData | null
  children: ReactNode
  desktopTitle?: string
  navigation?: ReactNode
}

export function PlatformShell({ data, children, navigation, desktopTitle }: PlatformShellProps) {
  const pathname = usePathname()
  const search = useSearchParams()
  const router = useRouter()
  const { collapsed, setCollapsed } = useSidebarLayout()
  const [drawer, setDrawer] = useState(false)
  const [command, setCommand] = useState(false)
  const compact = useCompactViewport('navigation')
  const desktop = useDesktopHost()
  const light = usePlatformTheme() === 'light'
  const drawerRef = useRef<HTMLDialogElement>(null)
  const sidebarHeader = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const chat = useChatChanges()
  const preferences = useInterfacePreferences()
  const accountName = preferences?.profileName ?? data?.user.name ?? ''
  const settings = pathname.startsWith('/settings')
  const conversation = pathname.startsWith('/chat')
  const activeChat = conversation ? pathname.split('/')[2] : undefined
  const home = !settings && !conversation
  const chats = [...chat.created, ...(data?.chats ?? [])].filter((item) => !chat.isRemoved(item.id))
  const chatTitle =
    activeChat &&
    chat.titleFor(activeChat, chats.find((item) => item.id === activeChat)?.title ?? 'Chat')
  const pageTitle = settings
    ? (desktopTitle ?? 'Settings')
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
    <div ref={toolbar} className={styles.actions}>
      <Tooltip label='Search (⌘K)'>
        <IconButton label='Search' icon='I089' onClick={() => setCommand(true)} />
      </Tooltip>
      <NotificationCenter anchor={toolbar} items={data?.inbox ?? []} navigate={navigate} />
      <Tooltip label='Collapse sidebar'>
        <IconButton label='Collapse sidebar' icon='I066' onClick={toggle} />
      </Tooltip>
    </div>
  )
  const sidebar = (
    <aside className={styles.sidebar} data-material='shell' aria-label='Platform sidebar'>
      <div ref={sidebarHeader} className={styles.sidebarHeader}>
        {settings ? (
          <button
            type='button'
            className={styles.identity}
            data-type='T043'
            onClick={() => navigate('/home')}
          >
            <Icon name='I093' />
            Back to app
          </button>
        ) : (
          <OrganizationControl
            anchor={sidebarHeader}
            organization={data?.organization}
            onSettings={() => navigate('/settings/members')}
          />
        )}
        {(!desktop || compact) && actions}
      </div>
      <div
        className={styles.sidebarBody}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a[href]')) setDrawer(false)
        }}
      >
        <ScrollArea label={settings ? 'Settings navigation' : 'Platform navigation'}>
          {settings ? (
            navigation
          ) : (
            <nav className={styles.nav} aria-label='Main navigation'>
              <div className={styles.group}>
                <Chip href={platformHref('/home', search)} selected={home} icon='I104'>
                  Home
                </Chip>
                <Chip href={platformHref('/home', search)} icon='I070'>
                  Integrations
                </Chip>
              </div>
              <SidebarCollections data={data} activeChat={activeChat} navigate={navigate} />
            </nav>
          )}
        </ScrollArea>
      </div>
      <footer className={styles.sidebarFooter}>
        {settings || !data ? (
          <ComponentRecipe
            recipe={light ? 'C1032' : 'C1030'}
            slots={{ iconButton: <HelpMenu iconOnly /> }}
          />
        ) : (
          <ComponentRecipe
            recipe={light ? 'C1033' : 'C1029'}
            slots={{
              label: preferences?.picture ? (
                <span className={styles.accountPhoto}>
                  <AvatarImage src={preferences.picture} name={accountName} />
                </span>
              ) : (
                avatarInitials(accountName)
              ),
              label2: (
                <button
                  className={styles.identity}
                  type='button'
                  onClick={() => navigate('/settings')}
                >
                  {accountName}
                </button>
              ),
              iconButton: <HelpMenu iconOnly />,
            }}
          />
        )}
      </footer>
    </aside>
  )

  const openControl = (
    <Tooltip label='Expand sidebar'>
      <IconButton
        label='Expand sidebar'
        icon='I066'
        size={compact ? 'touch' : 'small'}
        onClick={toggle}
      />
    </Tooltip>
  )
  const destinations = [
    { id: 'home', label: 'Home', icon: 'I104', href: '/home' },
    { id: 'new', label: 'New chat', icon: 'I073', href: '/chat' },
    { id: 'settings', label: 'Settings', icon: 'I116', href: '/settings' },
    ...chats.map((item) => ({
      id: `chat-${item.id}`,
      label: chat.titleFor(item.id, item.title),
      icon: 'I073' as const,
      href: `/chat/${item.id}`,
    })),
    ...(data?.workspaces ?? []).map((item) => ({
      id: `workspace-${item.id}`,
      label: item.name,
      icon: 'I025' as const,
      href: '/home',
    })),
  ] satisfies { id: string; label: string; icon: IconName; href: string }[]

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
            {!conversation && (
              <span className={styles.desktopTitle} data-type='T067'>
                {pageTitle}
              </span>
            )}
          </header>
        )}
        {!compact && !collapsed && sidebar}
        <div
          className={styles.content}
          onScroll={(event) => {
            if (home && compact)
              event.currentTarget.toggleAttribute(
                'data-scrolled',
                event.currentTarget.scrollTop > 0
              )
          }}
        >
          {home && !desktop && (
            <header className={styles.homeHeader} data-material='shell'>
              {compact && <span data-type='T042'>Home</span>}
            </header>
          )}
          {!desktop && (compact || collapsed) && (
            <div className={styles.openControl}>{openControl}</div>
          )}
          {children}
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
          {drawerOpen && sidebar}
        </dialog>
        <OverlayDialog
          label='Search'
          presentation='command'
          open={command}
          onClose={() => setCommand(false)}
        >
          <CommandSearch items={destinations} onSelect={navigate} />
        </OverlayDialog>
      </div>
      <NotificationTray history={data?.notifications ?? []} navigate={navigate} />
    </>
  )
}
