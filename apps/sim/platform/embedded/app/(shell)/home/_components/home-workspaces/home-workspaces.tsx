'use client'

import { useState } from 'react'
import { SettingsGuardedLink } from '@/components/settings/settings-guarded-link'
import { ActivityRow } from '@/platform/design-system/components/activity-row/activity-row'
import { Chip } from '@/platform/design-system/components/button/button'
import { RowList } from '@/platform/design-system/components/settings-section/row-list'
import { FailureNotice, Spinner } from '@/platform/design-system/components/status/status'
import { HomeSection } from '@/platform/embedded/app/(shell)/home/_components/home-section/home-section'
import styles from '@/platform/embedded/app/(shell)/home/_components/home-workspaces/home-workspaces.module.css'
import { WidgetSkeleton } from '@/platform/embedded/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import type { HomeListState, HomeWorkspaceItem } from '@/platform/embedded/lib/data/home-view'
import { formatRelativeTime } from '@/platform/lib/time'

/** The sidebar's own page size, so "See more" advances the same way in both places. */
const PAGE_SIZE = 5

const STATUS_LABEL = { review: 'Review', running: 'Running' } as const

interface HomeWorkspacesProps {
  state: HomeListState<HomeWorkspaceItem>
  count: number
  asOf: number
  onRetry: () => void
}

/** Shown while a row's activity is read, since an empty slot would claim the workspace is idle. */
const SETTLING_METADATA = '…'

function metadataOf(item: HomeWorkspaceItem, asOf: number) {
  if (item.status) return STATUS_LABEL[item.status]
  return item.lastRunAt === undefined ? undefined : formatRelativeTime(item.lastRunAt, asOf)
}

/** Renders nothing for a viewer with no workspaces, rather than an empty card. */
export function HomeWorkspaces({ state, count, asOf, onRetry }: HomeWorkspacesProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  if (state.status === 'ready' && state.items.length === 0) return null
  const hasMore = count > visibleCount
  return (
    <HomeSection title='Workspaces' uncapped>
      {state.status === 'loading' && (
        <WidgetSkeleton
          label='Loading workspaces'
          rows={Math.min(count || PAGE_SIZE, PAGE_SIZE)}
          glyph={false}
        />
      )}
      {state.status === 'error' && (
        <FailureNotice
          intent='warning'
          message='Workspaces could not load.'
          retrying={state.retrying}
          onRetry={onRetry}
        />
      )}
      {state.status === 'ready' && (
        <>
          {state.partial && (
            <FailureNotice
              intent='warning'
              message='What these workspaces are doing could not load.'
              onRetry={onRetry}
            />
          )}
          <div className={styles.viewport}>
            <RowList dividers>
              {state.items.slice(0, visibleCount).map((item) => (
                <ActivityRow
                  key={item.id}
                  title={item.name}
                  detail={item.detail}
                  metadata={state.settling ? SETTLING_METADATA : metadataOf(item, asOf)}
                  metadataLeading={item.status === 'running' ? <Spinner /> : undefined}
                  render={<SettingsGuardedLink href={item.href} />}
                />
              ))}
            </RowList>
            {count > PAGE_SIZE && (
              <Chip onClick={() => setVisibleCount(hasMore ? visibleCount + PAGE_SIZE : PAGE_SIZE)}>
                {hasMore ? 'See more' : 'See less'}
              </Chip>
            )}
          </div>
        </>
      )}
    </HomeSection>
  )
}
