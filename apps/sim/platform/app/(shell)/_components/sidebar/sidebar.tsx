'use client'

import { type ReactNode, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import type { ShellData } from '@/platform/app/(shell)/_components/model'
import { OrganizationMenu } from '@/platform/app/(shell)/_components/organization-menu/organization-menu'
import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { HelpMenu } from '@/platform/app/(shell)/_components/sidebar/help-menu'
import styles from '@/platform/app/(shell)/_components/sidebar/sidebar.module.css'
import { SidebarCollections } from '@/platform/app/(shell)/_components/sidebar/sidebar-collections'
import { Avatar, AvatarImage, Chip, Icon, ScrollArea } from '@/platform/design-system/components'
import { IdentityButton } from '@/platform/design-system/components/identity-button/identity-button'
import { platformHref } from '@/platform/design-system/navigation'

interface SidebarProps {
  data: ShellData | null
  activeChat?: string
  home: boolean
  settings: boolean
  actions?: ReactNode
  navigation?: ReactNode
  navigate: (href: string) => void
  onNavigate: () => void
}
export function Sidebar({
  data,
  activeChat,
  home,
  settings,
  actions,
  navigation,
  navigate,
  onNavigate,
}: SidebarProps) {
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
        <HelpMenu iconOnly />
      </footer>
    </aside>
  )
}
