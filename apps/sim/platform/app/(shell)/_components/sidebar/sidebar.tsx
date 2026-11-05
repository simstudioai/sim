'use client'

import { Activity, type ReactNode, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { PLATFORM_DESTINATIONS } from '@/platform/app/(shell)/_components/destinations'
import type { ShellData, ShellItem } from '@/platform/app/(shell)/_components/model'
import { OrganizationMenu } from '@/platform/app/(shell)/_components/organization-menu/organization-menu'
import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { SettingsNavigation } from '@/platform/app/(shell)/_components/settings-navigation/settings-navigation'
import { HelpMenu } from '@/platform/app/(shell)/_components/sidebar/help-menu'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar.module.css'
import { SidebarCollections } from '@/platform/app/(shell)/_components/sidebar/sidebar-collections'
import { Avatar, AvatarImage, Chip, Icon, ScrollArea } from '@/platform/design-system/components'
import { IdentityButton } from '@/platform/design-system/components/identity-button/identity-button'
import { platformHref } from '@/platform/design-system/navigation'

interface SidebarProps {
  data: ShellData | null
  chats: readonly ShellItem[]
  activeChat?: string
  home: boolean
  settingsSection?: string
  actions?: ReactNode
  navigate: (href: string) => void
  onNavigate: () => void
}
export function Sidebar({
  data,
  chats,
  activeChat,
  home,
  settingsSection,
  actions,
  navigate,
  onNavigate,
}: SidebarProps) {
  const settings = Boolean(settingsSection)
  const search = useSearchParams()
  const sidebarHeader = useRef<HTMLDivElement>(null)
  const preferences = useInterfacePreferences()
  const accountName = preferences?.profileName ?? data?.user.name ?? ''
  return (
    <aside className={styles.sidebar} data-material='shell' aria-label='Platform sidebar'>
      <div ref={sidebarHeader} className={styles.sidebarHeader}>
        {settings ? (
          <IdentityButton
            label='Back to app'
            leading={<Icon name='I093' />}
            onClick={() => navigate('/home')}
          >
            Back to app
          </IdentityButton>
        ) : (
          <OrganizationMenu
            anchor={sidebarHeader}
            organization={data?.organization}
            onSettings={() => navigate('/settings/members')}
          />
        )}
        {actions}
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
                {PLATFORM_DESTINATIONS.filter((item) => item.id !== 'settings').map((item) => (
                  <Chip
                    key={item.id}
                    href={platformHref(item.value, search)}
                    selected={home && item.id === 'home'}
                    icon={item.icon}
                  >
                    {item.label}
                  </Chip>
                ))}
              </div>
              <SidebarCollections
                workspaces={data?.workspaces ?? []}
                chats={chats}
                activeChat={activeChat}
                navigate={navigate}
              />
            </nav>
          </ScrollArea>
        </Activity>
        {settings && (
          <ScrollArea label='Settings navigation'>
            <SettingsNavigation section={settingsSection} organization={data?.organization.name} />
          </ScrollArea>
        )}
      </div>
      <footer className={styles.sidebarFooter}>
        {!settings && data && (
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
        )}
        <div className={styles.help}>
          <HelpMenu iconOnly />
        </div>
      </footer>
    </aside>
  )
}
