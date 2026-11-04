'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  EmptyState,
  Select,
  SettingsRow,
  SettingsSection,
  Switch,
} from '@/platform/design-system/components'
import { useInterfacePreferences } from '@/platform/design-system/components/interface-preferences'
import { SETTINGS_DESTINATIONS } from '@/platform/design-system/features/settings/destinations'
import { ProfileSettings } from '@/platform/design-system/features/settings/profile-settings'
import styles from '@/platform/design-system/features/settings/settings.module.css'
import type { SettingsData } from '@/platform/design-system/models/settings'

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

function AppearanceSettings() {
  const path = usePathname()
  const router = useRouter()
  const search = useSearchParams()
  const settings = useInterfacePreferences()
  return (
    <SettingsSection title='Appearance'>
      <SettingsRow label='Theme' description='Select your preferred color theme' field>
        <Select
          label='Theme'
          variant='quiet'
          options={THEMES}
          value={search.get('theme') ?? 'system'}
          onValueChange={(theme) => {
            const query = new URLSearchParams(search.toString())
            query.set('theme', theme)
            router.replace(`${path}?${query}`, { scroll: false })
          }}
        />
      </SettingsRow>
      <SettingsRow
        label='Interface font'
        description='Used for messages, menus, and controls'
        field
      >
        <Select
          label='Interface font'
          variant='quiet'
          options={[
            { value: 'geist', label: 'Geist' },
            { value: 'system', label: 'System' },
          ]}
          defaultValue={settings?.systemFont ? 'system' : 'geist'}
          onValueChange={(value) => settings?.setSystemFont(value === 'system')}
        />
      </SettingsRow>
      <SettingsRow label='Code font' description='Used for code blocks, logs, and terminals' field>
        <Select
          label='Code font'
          variant='quiet'
          options={[
            { value: 'geist-mono', label: 'Geist Mono' },
            { value: 'system', label: 'System monospace' },
          ]}
          defaultValue={settings?.systemMono ? 'system' : 'geist-mono'}
          onValueChange={(value) => settings?.setSystemMono(value === 'system')}
        />
      </SettingsRow>
    </SettingsSection>
  )
}

function NotificationSettings() {
  const settings = useInterfacePreferences()
  return (
    <SettingsSection title='Notifications'>
      <SettingsRow label='In-app notifications' description='When a run needs your attention'>
        <Switch
          label='In-app notifications'
          checked={settings?.inApp}
          onCheckedChange={settings?.setInApp}
        />
      </SettingsRow>
      <SettingsRow label='Play sound' description='Play a sound when work finishes'>
        <Switch label='Play sound' checked={settings?.sound} onCheckedChange={settings?.setSound} />
      </SettingsRow>
    </SettingsSection>
  )
}

interface SettingsScreenProps {
  section?: string
  data: SettingsData | null
  profileName?: string
}

export function SettingsScreen({
  section = 'preferences',
  data,
  profileName,
}: SettingsScreenProps) {
  const title = SETTINGS_DESTINATIONS.find((entry) => entry.key === section)?.title ?? 'Preferences'
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
        {section === 'preferences' && (
          <>
            <ProfileSettings name={profileName} email={data?.email} />
            <AppearanceSettings />
          </>
        )}
        {(section === 'preferences' || section === 'notifications') && <NotificationSettings />}
        {section === 'keyboard-shortcuts' && (
          <SettingsSection title='Navigation'>
            <SettingsRow label='Search'>
              <kbd data-type='T005'>⌘ / Ctrl + K</kbd>
            </SettingsRow>
            <SettingsRow label='Search settings'>
              <kbd data-type='T005'>/</kbd>
            </SettingsRow>
            <SettingsRow label='Close menu or dialog'>
              <kbd data-type='T005'>Esc</kbd>
            </SettingsRow>
          </SettingsSection>
        )}
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
                <SettingsRow key={member.id} label={member.name} description={member.email} />
              ))}
            </SettingsSection>
          ) : (
            <EmptyState title='No members to display' />
          ))}
      </div>
    </>
  )
}
