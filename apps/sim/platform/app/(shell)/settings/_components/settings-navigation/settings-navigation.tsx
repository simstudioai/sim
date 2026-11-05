'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { SETTINGS_DESTINATIONS } from '@/platform/app/(shell)/settings/_components/settings-navigation/destinations'
import styles from '@/platform/app/(shell)/settings/_components/settings-navigation/settings-navigation.module.css'
import { Chip, SearchField } from '@/platform/design-system/components'
import { platformHref } from '@/platform/design-system/navigation'

interface SettingsNavigationProps {
  section?: string
  organization?: string
}

export function SettingsNavigation({
  section = 'preferences',
  organization,
}: SettingsNavigationProps) {
  const params = useSearchParams()
  const [query, setQuery] = useState('')
  const filter = query.trim().toLowerCase()
  const destinations = SETTINGS_DESTINATIONS.map((item) => ({
    ...item,
    label: item.key === 'members' ? (organization ?? 'Members') : item.title,
  }))
  const matches = destinations.filter(
    (entry) =>
      entry.label.toLowerCase().includes(filter) || entry.title.toLowerCase().includes(filter)
  )
  function group(label: string, items: typeof destinations) {
    return (
      <div className={styles.group} key={label}>
        <h2 className={styles.navHeading} data-type='T052'>
          {label}
        </h2>
        {items.map((entry) => (
          <Chip
            key={entry.key}
            selected={section === entry.key}
            href={platformHref(
              entry.key === 'preferences' ? '/settings' : `/settings/${entry.key}`,
              params
            )}
            icon={entry.icon}
          >
            {entry.label}
          </Chip>
        ))}
      </div>
    )
  }
  return (
    <nav aria-label='Settings' className={styles.navigation}>
      <SearchField
        label='Search settings'
        variant='sidebar'
        placeholder='Search settings…'
        shortcut='/'
        onValueChange={setQuery}
      />
      {filter ? (
        matches.length ? (
          group(`${matches.length} ${matches.length === 1 ? 'result' : 'results'}`, matches)
        ) : (
          <div className={styles.result} role='status'>
            <strong data-type='T043'>No matching settings</strong>
            <p data-type='T060'>Try another search or clear the field.</p>
          </div>
        )
      ) : (
        <>
          {group(
            'Personal',
            destinations.filter((item) => item.key !== 'members')
          )}
          {group(
            'Organization',
            destinations.filter((item) => item.key === 'members')
          )}
        </>
      )}
    </nav>
  )
}
