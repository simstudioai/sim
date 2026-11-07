import { ActivityRow } from '@sim/emcn/activity-row'
import { Avatar } from '@sim/emcn/avatar'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { ScrollArea } from '@sim/emcn/scroll-area'
import { FailureNotice } from '@sim/emcn/status'
import { HomeSection } from '@/platform/embedded/app/(shell)/_components/home-section/home-section'
import styles from '@/platform/embedded/app/(shell)/home/_components/activity-list/activity-list.module.css'
import { WidgetSkeleton } from '@/platform/embedded/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import type { AttentionItem, EmailItem } from '@/platform/embedded/lib/data/home-view'
import type { HomeListState } from '@/platform/shared/home'
import { formatRelativeTime } from '@/platform/shared/time'

interface EmailListProps {
  items: readonly EmailItem[]
  asOf: number
  onOpen: (mail: EmailItem) => void
}

function relativeTime(at: number | undefined, asOf: number) {
  return at === undefined ? undefined : formatRelativeTime(at, asOf)
}

export function EmailList({ items, asOf, onOpen }: EmailListProps) {
  if (!items.length) return <EmptyState title='No email yet' />
  return (
    <div className={styles.viewport}>
      <ScrollArea label='Email messages'>
        <ul className={styles.entries} data-row-rhythm='dividers'>
          {items.map((mail) => (
            <ActivityRow
              key={mail.id}
              leading={<Avatar size='inline' name={mail.sender} decorative />}
              title={mail.sender}
              count={mail.count}
              detailLead={mail.subject}
              detail={mail.excerpt}
              textMetadata={relativeTime(mail.receivedAt, asOf)}
              onOpen={() => onOpen(mail)}
            />
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}

function AttentionRow({ row, asOf }: { row: AttentionItem; asOf: number }) {
  const leading = <Icon name={row.icon} />
  const metadata = relativeTime(row.occurredAt, asOf)
  return row.onOpen ? (
    <ActivityRow
      leading={leading}
      title={row.title}
      detail={row.detail}
      textMetadata={metadata}
      onOpen={row.onOpen}
    />
  ) : (
    <ActivityRow
      leading={leading}
      title={row.title}
      detail={row.detail}
      textMetadata={metadata}
      href={row.href}
    />
  )
}

interface AttentionListProps {
  state: HomeListState<AttentionItem>
  asOf: number
  onRetry: () => void
}

export function AttentionList({ state, asOf, onRetry }: AttentionListProps) {
  return (
    <HomeSection title='Needs your attention'>
      {state.status === 'loading' && <WidgetSkeleton label='Loading what needs your attention' />}
      {state.status === 'error' && (
        <FailureNotice
          intent='warning'
          message='This could not load.'
          retrying={state.retrying}
          onRetry={onRetry}
        />
      )}
      {state.status === 'ready' && (
        <>
          {state.partial && (
            <FailureNotice
              intent='warning'
              message='Some items could not load.'
              onRetry={onRetry}
            />
          )}
          {state.items.length > 0 ? (
            <div className={styles.viewport}>
              <ScrollArea label='Attention requests'>
                <ul className={styles.entries} data-row-rhythm='dividers'>
                  {state.items.map((row) => (
                    <AttentionRow key={row.id} row={row} asOf={asOf} />
                  ))}
                </ul>
              </ScrollArea>
            </div>
          ) : (
            !state.partial && <EmptyState title='You’re all caught up' />
          )}
        </>
      )}
    </HomeSection>
  )
}
