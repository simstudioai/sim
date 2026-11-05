'use client'

import { Activity, type ReactNode, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { PLATFORM_DESTINATIONS } from '@/platform/app/(shell)/_components/destinations'
import type {
  ShellActions,
  ShellChat,
  ShellData,
  ShellDestination,
} from '@/platform/app/(shell)/_components/model'
import { OrganizationMenu } from '@/platform/app/(shell)/_components/organization-menu/organization-menu'
import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { SettingsNavigation } from '@/platform/app/(shell)/_components/settings-navigation/settings-navigation'
import { AccountMenu } from '@/platform/app/(shell)/_components/sidebar/account-menu'
import { ChatsSection } from '@/platform/app/(shell)/_components/sidebar/chats-section'
import { HelpMenu } from '@/platform/app/(shell)/_components/sidebar/help-menu'
import { linkMenuActions } from '@/platform/app/(shell)/_components/sidebar/row-links'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar.module.css'
import { WorkspacesSection } from '@/platform/app/(shell)/_components/sidebar/workspaces-section'
import {
  Avatar,
  AvatarImage,
  Chip,
  ContextActionMenu,
  Icon,
  ScrollArea,
} from '@/platform/design-system/components'
import { IdentityButton } from '@/platform/design-system/components/identity-button/identity-button'
import { platformHref } from '@/platform/design-system/navigation'

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
  const search = useSearchParams()
  const sidebarHeader = useRef<HTMLDivElement>(null)
  const sidebarFooter = useRef<HTMLElement>(null)
  const preferences = useInterfacePreferences()
  const accountName = preferences?.profileName ?? data?.user.name ?? ''
  const destinations: readonly ShellDestination[] = data?.destinations ?? PLATFORM_DESTINATIONS
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
            onSettings={() => navigate('/settings/members')}
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
          <ScrollArea label='Platform navigation'>
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
              <WorkspacesSection data={data} actions={actions} navigate={navigate} />
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
          <ScrollArea label='Settings navigation'>
            <SettingsNavigation
              section={settingsSection}
              organization={data?.organization.name}
              groups={data?.settingsNavigation}
            />
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
              image={preferences?.picture ?? data.user.image}
              onSettings={() => navigate('/settings')}
              onSignOut={actions.signOut}
            />
          ) : (
            <IdentityButton
              label={accountName}
              leading={
                preferences?.picture ? (
                  <span className={styles.accountPhoto}>
                    <AvatarImage src={preferences.picture} name={accountName} />
                  </span>
                ) : (
                  <Avatar name={accountName} size='inline' />
                )
              }
              onClick={() => navigate('/settings')}
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
