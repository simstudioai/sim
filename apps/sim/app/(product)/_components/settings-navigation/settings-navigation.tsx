'use client'

import { useState } from 'react'
import { Chip } from '@sim/emcn/button'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { SearchField } from '@sim/emcn/search-field'
import { useSearchParams } from 'next/navigation'
import { useDesktopHost } from '@/app/(product)/_components/desktop/desktop-host'
import type { SettingsNavGroup } from '@/app/(product)/_components/model'
import styles from '@/app/(product)/_components/settings-navigation/settings-navigation.module.css'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { platformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'
import { plural } from '@/platform/shared/plural'
import { searchSettings } from '@/platform/shared/settings-search'

interface SettingsNavigationProps {
  section?: string
  /** The viewer's gated sections. Absent means the static fixture list. */
  groups?: readonly SettingsNavGroup[]
}

export function SettingsNavigation({ section = 'general', groups = [] }: SettingsNavigationProps) {
  const params = useSearchParams()
  const scope = useSurfaceScope()
  const [query, setQuery] = useState('')
  const desktop = useDesktopHost()
  const filter = query.trim().toLowerCase()
  const sectionHref = (item: SettingsNavGroup['items'][number]) =>
    item.href ?? platformHref(surfaceHref(scope, `/settings/${item.key}`), params)
  const visible = groups
    .map((entry) => ({
      label: entry.label,
      items: entry.items.filter((item) => !item.desktop || desktop),
    }))
    .filter((entry) => entry.items.length > 0)
  const found = searchSettings(
    query,
    visible.flatMap((entry) => entry.items.map((item) => ({ ...item, href: sectionHref(item) })))
  )
  const count = found.reduce((total, entry) => total + entry.results.length, 0)
  function group(
    label: string,
    items: readonly {
      key: string
      label: string
      href: string
      icon: IconName
      selected: boolean
    }[]
  ) {
    return (
      <div className={styles.group} key={label}>
        <h2 className={styles.navHeading} data-type='T052'>
          {label}
        </h2>
        {items.map((entry) => (
          <Chip key={entry.key} selected={entry.selected} href={entry.href} icon={entry.icon}>
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
        count ? (
          <>
            <p className={styles.navHeading} role='status' data-type='T052'>
              {plural(count, 'result')}
            </p>
            {found.map((entry) =>
              group(
                entry.title,
                entry.results.map((result) => ({
                  key: result.id,
                  label: result.label,
                  href: result.href,
                  icon: entry.icon,
                  selected: false,
                }))
              )
            )}
          </>
        ) : (
          <div className={styles.result} role='status'>
            <strong data-type='T043'>No matching settings</strong>
            <p data-type='T060'>Try another search or clear the field.</p>
          </div>
        )
      ) : (
        visible.map((entry) =>
          group(
            entry.label,
            entry.items.map((item) => ({
              key: item.key,
              label: item.title,
              href: sectionHref(item),
              icon: item.icon,
              selected: section === item.key,
            }))
          )
        )
      )}
    </nav>
  )
}
