'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { ScrollArea } from '@sim/emcn/scroll-area'
import { InlineNotice, Spinner } from '@sim/emcn/status'
import { HomeSection } from '@/app/(product)/o/[organizationId]/home/_components/home-section/home-section'
import styles from '@/app/(product)/o/[organizationId]/home/_components/home-workspaces/home-workspaces.module.css'
import { RetryButton } from '@/app/(product)/o/[organizationId]/home/_components/retry-button/retry-button'
import type { HomeListState, HomeWorkspaceItem } from '@/platform/shared/home'
import { formatRelativeTime } from '@/platform/shared/time'

/** The sidebar's own page size, so See more advances the same way in both places. */
const PAGE_SIZE = 5

const STATUS_LABEL = { review: 'Review', running: 'Running' } as const

/**
 * Stands in for a row's detail while its activity is read: an empty slot would claim the workspace
 * is idle, and the line holds the row at the height the answer will give it.
 */
const SETTLING_DETAIL = '…'

function metadataOf(item: HomeWorkspaceItem, asOf: number) {
  if (item.status) return STATUS_LABEL[item.status]
  return item.lastRunAt === undefined ? undefined : formatRelativeTime(item.lastRunAt, asOf)
}

interface HomeWorkspacesProps {
  state: HomeListState<HomeWorkspaceItem>
  asOf: number
  onRetry: () => void
}

/** The viewer's workspaces with what their runs are doing. Renders nothing for a viewer with none. */
export function HomeWorkspaces({ state, asOf, onRetry }: HomeWorkspacesProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  if (state.status === 'ready' && state.items.length === 0) return null
  return (
    <HomeSection title='Workspaces'>
      {state.status === 'error' && (
        <InlineNotice
          intent='warning'
          message='Workspaces could not load.'
          action={<RetryButton retrying={state.retrying} onRetry={onRetry} />}
        />
      )}
      {state.status === 'ready' && (
        <>
          {state.partial && (
            <InlineNotice
              intent='warning'
              message='What these workspaces are doing could not load.'
              action={<RetryButton onRetry={onRetry} />}
            />
          )}
          <div className={styles.viewport} aria-busy={state.settling || undefined}>
            <ScrollArea label='Workspace list'>
              <ul className={styles.entries}>
                {state.items.slice(0, visibleCount).map((item) => (
                  <ActivityRow
                    key={item.id}
                    title={item.name}
                    detail={state.settling ? SETTLING_DETAIL : item.detail}
                    textMetadata={state.settling ? undefined : metadataOf(item, asOf)}
                    metadataLeading={item.status === 'running' ? <Spinner /> : undefined}
                    href={item.href}
                  />
                ))}
              </ul>
            </ScrollArea>
            {state.items.length > PAGE_SIZE && (
              <span className={styles.more}>
                <Button
                  variant='quiet'
                  size='compact'
                  onClick={() =>
                    setVisibleCount(
                      state.items.length > visibleCount ? visibleCount + PAGE_SIZE : PAGE_SIZE
                    )
                  }
                >
                  {state.items.length > visibleCount ? 'See more' : 'See less'}
                </Button>
              </span>
            )}
          </div>
        </>
      )}
    </HomeSection>
  )
}
