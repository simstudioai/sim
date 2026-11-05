'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SettingsIntentLink } from '@/components/settings/settings-intent-link'
import { usePendingSettingsSelection } from '@/components/settings/use-pending-settings-selection'
import { popSettingsReturnUrl } from '@/lib/navigation/settings-return'
import styles from '@/platform/app/(shell)/_components/settings-navigation/settings-navigation.module.css'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { ScrollArea } from '@/platform/design-system/components/scroll-area/scroll-area'
import { SearchField } from '@/platform/design-system/components/search-field/search-field'
import { Tooltip } from '@/platform/design-system/components/tooltip/tooltip'
import {
  type SettingsSectionKey,
  useSettingsNavigation,
} from '@/platform/lib/data/settings-navigation'
import { revealSettingRow, searchSettings } from '@/platform/lib/data/settings-search'
import { plural } from '@/platform/lib/plural'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const BACK_LABEL = 'Back to app'

/** Leaving Settings runs the unsaved-changes guard, then returns to where the viewer came from. */
function useSettingsBack() {
  const router = useRouter()
  const { backHref } = useSettingsNavigation()
  return () =>
    useSettingsDirtyStore.getState().requestLeave(() => router.push(popSettingsReturnUrl(backHref)))
}

export function SettingsBackButton({ collapsed }: { collapsed?: boolean }) {
  const back = useSettingsBack()
  const row = (
    <ControlRow
      label={collapsed ? undefined : BACK_LABEL}
      accessibleLabel={collapsed ? BACK_LABEL : undefined}
      icon='I093'
      render={<button type='button' onClick={back} />}
    />
  )
  return collapsed ? <Tooltip label={BACK_LABEL}>{row}</Tooltip> : row
}

interface SectionLinkProps {
  section: SettingsSectionKey
  label: string
  icon: IconName
  href: string
  selected: boolean
  collapsed?: boolean
  onIntent: () => void
  onNavigate: () => void
}

function SectionLink({
  section,
  label,
  icon,
  href,
  selected,
  collapsed,
  onIntent,
  onNavigate,
}: SectionLinkProps) {
  const row = (
    <ControlRow
      label={collapsed ? undefined : label}
      accessibleLabel={collapsed ? label : undefined}
      icon={icon}
      render={
        <SettingsIntentLink
          data-settings-navigation='managed'
          data-settings-section={section}
          href={href}
          replace
          scroll={false}
          aria-current={selected ? 'page' : undefined}
          onIntent={onIntent}
          onNavigate={(event) => {
            event.preventDefault()
            if (selected) return
            const { isDirty, navigationBlocked, requestLeave } = useSettingsDirtyStore.getState()
            if (isDirty || navigationBlocked) requestLeave(onNavigate)
            else onNavigate()
          }}
        />
      }
    />
  )
  return collapsed ? <Tooltip label={label}>{row}</Tooltip> : row
}

interface SettingsNavigationProps {
  collapsed: boolean
}

/** Settings' sections and its search, in the organization rail's body. */
export function SettingsNavigation({ collapsed }: SettingsNavigationProps) {
  const navigation = useSettingsNavigation()
  const { groups, warmSection } = navigation
  const { activeSection: selected, navigateToSection } = usePendingSettingsSelection(
    navigation.activeSection
  )
  const [query, setQuery] = useState('')
  const searching = !collapsed && query.trim().length > 0
  const found = searching ? searchSettings(query, groups, navigation) : []
  const count = found.reduce((total, group) => total + group.results.length, 0)

  return (
    <nav
      aria-label='Settings'
      className={styles.navigation}
      data-collapsed={collapsed || undefined}
    >
      <div className={styles.top}>
        {collapsed && <SettingsBackButton collapsed />}
        {!collapsed && (
          <SearchField
            label='Search settings'
            variant='sidebar'
            placeholder='Search settings…'
            shortcut='/'
            value={query}
            onValueChange={setQuery}
          />
        )}
      </div>
      <ScrollArea label='Settings navigation' hideScrollbar>
        <div className={styles.groups}>
          {!searching &&
            groups.map((group) => (
              <div className={styles.group} key={group.key}>
                {!collapsed && (
                  <h2 className={styles.heading} data-type='T052'>
                    {group.title}
                  </h2>
                )}
                {group.items.map((item) => (
                  <SectionLink
                    key={item.key}
                    section={item.key}
                    label={item.title}
                    icon={item.icon}
                    href={item.href}
                    selected={selected === item.key}
                    collapsed={collapsed}
                    onIntent={() => {
                      if (selected !== item.key) warmSection(item.key)
                    }}
                    onNavigate={() => {
                      if (selected !== item.key) navigateToSection(item.key, item.href)
                    }}
                  />
                ))}
              </div>
            ))}
          {searching && (
            <>
              <p className={styles.count} role='status' data-type='T052'>
                {count ? plural(count, 'result') : 'No matching settings'}
              </p>
              {count === 0 && (
                <p className={styles.hint} data-type='T060'>
                  Try another search or clear the field.
                </p>
              )}
              {found.map((group) => (
                <div className={styles.group} key={group.key}>
                  <h2 className={styles.heading} data-type='T052'>
                    <Icon name={group.icon} />
                    {group.title}
                  </h2>
                  {group.results.map((result) => (
                    <SectionLink
                      key={result.id}
                      section={group.key}
                      label={result.label}
                      icon={group.icon}
                      href={result.href}
                      selected={false}
                      onIntent={() => warmSection(group.key)}
                      onNavigate={() => {
                        navigateToSection(group.key, result.href)
                        if (result.rowLabel) revealSettingRow(result.rowLabel)
                      }}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </nav>
  )
}
