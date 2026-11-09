'use client'

import { Activity, type ReactNode, useRef } from 'react'
import { Avatar, AvatarImage } from '@sim/emcn/avatar'
import { Chip } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { IdentityButton } from '@sim/emcn/identity-button'
import { ContextActionMenu } from '@sim/emcn/menu/action-menu'
import { ScrollArea } from '@sim/emcn/scroll-area'
import { useSearchParams } from 'next/navigation'
import { platformDestinations } from '@/app/(product)/_components/destinations'
import type { ShellActions, ShellChat, ShellData } from '@/app/(product)/_components/model'
import { OrganizationMenu } from '@/app/(product)/_components/organization-menu/organization-menu'
import { useInterfacePreferences } from '@/app/(product)/_components/session/interface-preferences'
import { SettingsNavigation } from '@/app/(product)/_components/settings-navigation/settings-navigation'
import { AccountMenu } from '@/app/(product)/_components/sidebar/account-menu'
import { ChatsSection } from '@/app/(product)/_components/sidebar/chats-section'
import { HelpMenu } from '@/app/(product)/_components/sidebar/help-menu'
import { linkMenuActions } from '@/app/(product)/_components/sidebar/row-links'
import styles from '@/app/(product)/_components/sidebar/sidebar.module.css'
import { WorkspacesSection } from '@/app/(product)/_components/sidebar/workspaces-section'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { platformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'
import { workspaceLocation } from '@/platform/lib/workspace-navigation'
import type { ShellDestination } from '@/platform/shared/shell'

interface SidebarProps {
  data: ShellData | null
  actions: ShellActions
  chats: readonly ShellChat[]
  activeChat?: string
  pathname: string
  settingsSection?: string
  toolbar?: ReactNode
  onBack: () => void
  navigate: (href: string) => void
  onNavigate: () => void
}

export function Sidebar({
  data,
  actions,
  chats,
  activeChat,
  pathname,
  settingsSection,
  toolbar,
  onBack,
  navigate,
  onNavigate,
}: SidebarProps) {
  const settings = Boolean(settingsSection)
  const activeWorkspace = workspaceLocation(pathname)?.id
  const search = useSearchParams()
  const scope = useSurfaceScope()
  const sidebarHeader = useRef<HTMLDivElement>(null)
  const sidebarFooter = useRef<HTMLElement>(null)
  const preferences = useInterfacePreferences()
  const accountPhoto = preferences?.picture ?? data?.user.image
  const accountName = preferences?.profileName ?? data?.user.name ?? ''
  const destinations: readonly ShellDestination[] =
    data?.destinations ?? platformDestinations(scope)
  return (
    <aside className={styles.sidebar} data-material='shell' aria-label='Platform sidebar'>
      <div ref={sidebarHeader} className={styles.sidebarHeader}>
        {settings ? (
          <IdentityButton label='Back to app' leading={<Icon name='I093' />} onClick={onBack}>
            Back to app
          </IdentityButton>
        ) : (
          <OrganizationMenu
            anchor={sidebarHeader}
            organization={data?.organization}
            actions={actions.organization}
            onSettings={() => navigate(surfaceHref(scope, '/settings/members'))}
          />
        )}
        {toolbar}
      </div>
      <div
        className={styles.sidebarBody}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a[href]')) onNavigate()
        }}
      >
        <Activity mode={settings ? 'hidden' : 'visible'}>
          <ScrollArea label='Platform navigation' hideScrollbar>
            <nav className={styles.nav} aria-label='Main navigation'>
              <div className={styles.group}>
                {destinations
                  .filter((item) => item.id !== 'settings')
                  .map((item) => (
                    <ContextActionMenu
                      key={item.id}
                      label={`Actions for ${item.label}`}
                      actions={linkMenuActions(item.value)}
                    >
                      <Chip
                        href={platformHref(item.value, search)}
                        selected={pathname === item.value || pathname.startsWith(`${item.value}/`)}
                        icon={item.icon}
                      >
                        {item.label}
                      </Chip>
                    </ContextActionMenu>
                  ))}
              </div>
              <WorkspacesSection
                data={data}
                actions={actions}
                activeWorkspace={activeWorkspace}
                navigate={navigate}
              />
              {data?.chatsAvailable !== false && (
                <ChatsSection
                  chats={chats}
                  status={data?.status?.chats}
                  activeChat={activeChat}
                  actions={actions.chats}
                  navigate={navigate}
                />
              )}
            </nav>
          </ScrollArea>
        </Activity>
        {settings && (
          <ScrollArea label='Settings navigation' hideScrollbar>
            <SettingsNavigation section={settingsSection} groups={data?.settingsNavigation} />
          </ScrollArea>
        )}
      </div>
      <footer ref={sidebarFooter} className={styles.sidebarFooter}>
        {!settings &&
          data &&
          accountName &&
          (actions.signOut ? (
            <AccountMenu
              anchor={sidebarFooter}
              name={accountName}
              image={accountPhoto}
              onSettings={() => navigate(surfaceHref(scope, '/settings'))}
              onSignOut={actions.signOut}
            />
          ) : (
            <IdentityButton
              label={accountName}
              leading={
                accountPhoto ? (
                  <span className={styles.accountPhoto}>
                    <AvatarImage src={accountPhoto} name={accountName} />
                  </span>
                ) : (
                  <Avatar name={accountName} size='inline' />
                )
              }
              onClick={() => navigate(surfaceHref(scope, '/settings'))}
            >
              {accountName}
            </IdentityButton>
          ))}
        <div className={styles.help}>
          <HelpMenu iconOnly help={actions.help} />
        </div>
      </footer>
    </aside>
  )
}
