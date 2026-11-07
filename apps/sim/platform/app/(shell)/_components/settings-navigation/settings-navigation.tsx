'use client'

import { useState } from 'react'
import { Chip } from '@sim/emcn/button'
import { SearchField } from '@sim/emcn/search-field'
import { useSearchParams } from 'next/navigation'
import type { SettingsNavGroup } from '@/platform/app/(shell)/_components/model'
import styles from '@/platform/app/(shell)/_components/settings-navigation/settings-navigation.module.css'
import { platformHref } from '@/platform/lib/navigation'
import { plural } from '@/platform/lib/plural'

interface SettingsNavigationProps {
  section?: string
  /** The viewer's gated sections. Absent means the static fixture list. */
  groups?: readonly SettingsNavGroup[]
}

export function SettingsNavigation({ section = 'general', groups = [] }: SettingsNavigationProps) {
  const params = useSearchParams()
  const [query, setQuery] = useState('')
  const filter = query.trim().toLowerCase()
  const labelled = groups.map((entry) => ({
    label: entry.label,
    items: entry.items.map((item) => ({
      ...item,
      label: item.title,
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
            href={entry.href ?? platformHref(`/settings/${entry.key}`, params)}
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
          group(plural(matches.length, 'result'), matches)
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
