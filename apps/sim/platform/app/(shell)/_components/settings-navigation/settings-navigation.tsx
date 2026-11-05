'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { SettingsNavGroup } from '@/platform/app/(shell)/_components/model'
import { SETTINGS_DESTINATIONS } from '@/platform/app/(shell)/_components/settings-navigation/destinations'
import styles from '@/platform/app/(shell)/_components/settings-navigation/settings-navigation.module.css'
import { Chip, SearchField } from '@/platform/design-system/components'
import { platformHref } from '@/platform/design-system/navigation'

interface SettingsNavigationProps {
  section?: string
  organization?: string
  /** The viewer's gated sections. Absent means the static fixture list. */
  groups?: readonly SettingsNavGroup[]
}

const FIXTURE_GROUPS: readonly SettingsNavGroup[] = [
  {
    label: 'Personal',
    items: SETTINGS_DESTINATIONS.filter((item) => item.key !== 'members'),
  },
  {
    label: 'Organization',
    items: SETTINGS_DESTINATIONS.filter((item) => item.key === 'members'),
  },
]

export function SettingsNavigation({
  section = 'preferences',
  organization,
  groups = FIXTURE_GROUPS,
}: SettingsNavigationProps) {
  const params = useSearchParams()
  const [query, setQuery] = useState('')
  const filter = query.trim().toLowerCase()
  const labelled = groups.map((entry) => ({
    label: entry.label,
    items: entry.items.map((item) => ({
      ...item,
      label: item.key === 'members' ? (organization ?? 'Members') : item.title,
    })),
  }))
  const matches = labelled
    .flatMap((entry) => entry.items)
    .filter(
      (entry) =>
        entry.label.toLowerCase().includes(filter) || entry.title.toLowerCase().includes(filter)
    )
  function group(label: string, items: typeof matches) {
    return (
      <div className={styles.group} key={label}>
        <h2 className={styles.navHeading} data-type='T052'>
          {label}
        </h2>
        {items.map((entry) => (
          <Chip
            key={entry.key}
            selected={section === entry.key}
            href={
              entry.href ??
              platformHref(
                entry.key === 'preferences' ? '/settings' : `/settings/${entry.key}`,
                params
              )
            }
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
        labelled.map((entry) => group(entry.label, entry.items))
      )}
    </nav>
  )
}
