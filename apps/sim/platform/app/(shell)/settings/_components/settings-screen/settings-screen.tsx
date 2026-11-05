'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useInterfacePreferences } from '@/platform/app/(shell)/_components/session/interface-preferences'
import { SETTINGS_DESTINATIONS } from '@/platform/app/(shell)/_components/settings-navigation/destinations'
import { AppearanceSettings } from '@/platform/app/(shell)/settings/_components/appearance-settings/appearance-settings'
import type { SettingsData } from '@/platform/app/(shell)/settings/_components/model'
import { NotificationSettings } from '@/platform/app/(shell)/settings/_components/notification-settings/notification-settings'
import { ProfileSettings } from '@/platform/app/(shell)/settings/_components/profile/profile-settings'
import KeyboardShortcutsSection from '@/platform/app/(shell)/settings/_components/sections/keyboard-shortcuts/keyboard-shortcuts-section'
import styles from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen.module.css'
import { EmptyState } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'

interface SettingsScreenProps {
  section?: string
  data: SettingsData | null
  profileName?: string
  /** A live section's title and body, in place of the fixture sections below. */
  title?: string
  children?: ReactNode
}

export function SettingsScreen({
  section = 'preferences',
  data,
  profileName,
  title: liveTitle,
  children,
}: SettingsScreenProps) {
  const title =
    liveTitle ??
    SETTINGS_DESTINATIONS.find((entry) => entry.key === section)?.title ??
    'Preferences'
  const start = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const marker = start.current
    if (!marker) return
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting))
    observer.observe(marker)
    return () => observer.disconnect()
  }, [])
  return (
    <>
      <div ref={start} className={styles.scrollStart} aria-hidden='true' />
      <header
        aria-label='Settings location'
        className={styles.breadcrumb}
        data-scrolled={scrolled || undefined}
      >
        <span className={styles.parent} data-type='T057'>
          Settings
        </span>
        <span aria-hidden='true' className={styles.parent} data-type='T057'>
          /
        </span>
        <span className={styles.fullTitle} data-type='T057'>
          {title}
        </span>
        <span className={styles.compactTitle} data-type='T042'>
          {title}
        </span>
      </header>
      <div className={styles.content}>
        <header className={styles.heading}>
          <h1 data-type='T076'>{title}</h1>
          {section === 'preferences' && <p data-type='T067'>Manage your personal preferences</p>}
        </header>
        {children ?? <FixtureSections section={section} data={data} profileName={profileName} />}
      </div>
    </>
  )
}

function FixtureSections({
  section,
  data,
  profileName,
}: Pick<SettingsScreenProps, 'section' | 'data' | 'profileName'>) {
  const preferences = useInterfacePreferences()
  return (
    <>
      {section === 'preferences' && (
        <>
          <ProfileSettings name={profileName} email={data?.email} />
          <AppearanceSettings />
        </>
      )}
      {(section === 'preferences' || section === 'notifications') && <NotificationSettings />}
      {section === 'keyboard-shortcuts' && <KeyboardShortcutsSection />}
      {section === 'connections' &&
        (data?.connections.length ? (
          <SettingsSection title='Connected accounts'>
            {data.connections.map((name) => (
              <SettingsRow key={name} label={name} />
            ))}
          </SettingsSection>
        ) : (
          <EmptyState title='No connected accounts' />
        ))}
      {section === 'members' &&
        (data?.members.length ? (
          <SettingsSection title='Organization members'>
            {data.members.map((member) => (
              <SettingsRow
                key={member.id}
                label={
                  member.email === data.email
                    ? (preferences?.profileName ?? member.name)
                    : member.name
                }
                description={member.email}
              />
            ))}
          </SettingsSection>
        ) : (
          <EmptyState title='No members to display' />
        ))}
    </>
  )
}
