'use client'

import { Button } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { Surface } from '@sim/emcn-platform/surface'
import styles from '@/platform/embedded/app/(shell)/_components/search-surface-header/search-surface-header.module.css'
import type { OrganizationSearchState } from '@/platform/embedded/lib/data/organization-search'

const SEARCH_MODE_ICONS = { search: 'I089', assistant: 'I073' } as const

export type SearchHeaderState = Pick<
  OrganizationSearchState,
  'activeMode' | 'modes' | 'changeMode' | 'newLabel' | 'canStartNew' | 'isStartingNew' | 'startNew'
>

/**
 * A `nav` of buttons rather than `SegmentedControl`: its radios would flip on reselect, and each
 * view here is a history entry with `aria-current`.
 */
export function SearchSurfaceHeader({ search }: { search: SearchHeaderState }) {
  const { activeMode, newLabel } = search
  return (
    <div className={styles.transparentSurface}>
      <Surface>
        <div className={styles.header}>
          <nav aria-label='Search views' className={styles.views}>
            {search.modes.map((entry) => (
              <button
                key={entry.value}
                type='button'
                className={styles.view}
                data-type='T056'
                aria-current={activeMode === entry.value ? 'page' : undefined}
                onClick={() => search.changeMode(entry.value)}
              >
                <Icon name={SEARCH_MODE_ICONS[entry.value]} />
                {entry.label}
              </button>
            ))}
          </nav>
          {search.canStartNew && (
            <Button
              variant='quiet'
              size='compact'
              icon='I074'
              narrowLabel='New'
              disabled={search.isStartingNew}
              onClick={search.startNew}
              render={<button type='button' className={styles.newButton} aria-label={newLabel} />}
            >
              {newLabel}
            </Button>
          )}
        </div>
      </Surface>
    </div>
  )
}
