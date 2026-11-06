'use client'

import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import type { OrganizationSearchState } from '@/app/o/[organizationId]/search/use-organization-search'
import styles from '@/platform/app/(shell)/search/_components/search-surface/search-surface.module.css'
import { Button } from '@/platform/design-system/components/button/button'
import { Icon } from '@/platform/design-system/components/icon/icon'

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
      <RedesignSurface>
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
      </RedesignSurface>
    </div>
  )
}
