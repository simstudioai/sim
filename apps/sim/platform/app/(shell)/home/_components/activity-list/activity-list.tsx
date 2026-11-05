import styles from '@/platform/app/(shell)/home/_components/activity-list/activity-list.module.css'
import { HomeSection } from '@/platform/app/(shell)/home/_components/home-section/home-section'
import type {
  AttentionItem,
  EmailItem,
  HomeListState,
} from '@/platform/app/(shell)/home/_components/model'
import { RetryButton } from '@/platform/app/(shell)/home/_components/retry-button/retry-button'
import { WidgetSkeleton } from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import { ActivityRow } from '@/platform/design-system/components/activity-row/activity-row'
import { Avatar } from '@/platform/design-system/components/avatar/avatar'
import { EmptyState } from '@/platform/design-system/components/empty-state/empty-state'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { ScrollArea } from '@/platform/design-system/components/scroll-area/scroll-area'
import { InlineNotice } from '@/platform/design-system/components/status/status'
import { formatRelativeTime } from '@/platform/lib/time'

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
        <ul className={styles.entries}>
          {items.map((mail) => (
            <ActivityRow
              key={mail.id}
              leading={<Avatar size='inline' name={mail.sender} decorative />}
              title={mail.sender}
              count={mail.count}
              detailLead={mail.subject}
              detail={mail.excerpt}
              metadata={relativeTime(mail.receivedAt, asOf)}
              onOpen={() => onOpen(mail)}
            />
          ))}
        </ul>
      </ScrollArea>
    </div>
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
        <InlineNotice
          intent='warning'
          message='This could not load.'
          action={<RetryButton retrying={state.retrying} onRetry={onRetry} />}
        />
      )}
      {state.status === 'ready' && (
        <>
          {state.partial && (
            <InlineNotice
              intent='warning'
              message='Some items could not load.'
              action={<RetryButton onRetry={onRetry} />}
            />
          )}
          {state.items.length > 0 ? (
            <div className={styles.viewport}>
              <ScrollArea label='Attention requests'>
                <ul className={styles.entries}>
                  {state.items.map((row) => (
                    <ActivityRow
                      key={row.id}
                      leading={<Icon name={row.icon} />}
                      title={row.title}
                      detail={row.detail}
                      metadata={relativeTime(row.occurredAt, asOf)}
                      {...(row.onOpen ? { onOpen: row.onOpen } : { href: row.href })}
                    />
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
