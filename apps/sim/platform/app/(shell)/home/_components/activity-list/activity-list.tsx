import { useSearchParams } from 'next/navigation'
import styles from '@/platform/app/(shell)/home/_components/activity-list/activity-list.module.css'
import { HomeSection } from '@/platform/app/(shell)/home/_components/home-section/home-section'
import type {
  AttentionItem,
  EmailItem,
  HomeListState,
} from '@/platform/app/(shell)/home/_components/model'
import { WidgetSkeleton } from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import {
  ActivityRow,
  Avatar,
  Button,
  EmptyState,
  Icon,
  InlineNotice,
  ScrollArea,
} from '@/platform/design-system/components'
import { platformHref } from '@/platform/design-system/navigation'
import { formatRelativeTime } from '@/platform/lib/time'

interface EmailListProps {
  items: readonly EmailItem[]
  asOf: number | null
  onOpen: (mail: EmailItem) => void
}

function relativeTime(at: number | undefined, asOf: number | null) {
  return at === undefined || asOf === null ? undefined : formatRelativeTime(at, asOf)
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
              leading={<Avatar size='inline' name={mail.sender} src={mail.avatar} />}
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
  asOf: number | null
  onRetry?: () => void
}

export function AttentionList({ state, asOf, onRetry }: AttentionListProps) {
  const search = useSearchParams()
  const retry = (retrying = false) => (
    <Button size='compact' disabled={retrying} onClick={onRetry}>
      Try again
    </Button>
  )
  return (
    <HomeSection title='Needs your attention'>
      {state.status === 'loading' && <WidgetSkeleton label='Loading what needs your attention' />}
      {state.status === 'error' && (
        <EmptyState title='This could not load' action={retry(state.retrying)} />
      )}
      {state.status === 'ready' && state.partial && (
        <InlineNotice intent='warning' message='Some items could not load.' action={retry()} />
      )}
      {state.status === 'ready' &&
        (state.items.length ? (
          <div className={styles.viewport}>
            <ScrollArea label='Attention requests'>
              <ul className={styles.entries}>
                {state.items.map((row) =>
                  row.onOpen ? (
                    <ActivityRow
                      key={row.id}
                      leading={<Icon name={row.icon} />}
                      title={row.title}
                      detail={row.detail}
                      metadata={relativeTime(row.occurredAt, asOf)}
                      onOpen={row.onOpen}
                    />
                  ) : (
                    <ActivityRow
                      key={row.id}
                      leading={<Icon name={row.icon} />}
                      title={row.title}
                      detail={row.detail}
                      metadata={relativeTime(row.occurredAt, asOf)}
                      href={platformHref(row.href ?? '/home', search)}
                    />
                  )
                )}
              </ul>
            </ScrollArea>
          </div>
        ) : (
          !state.partial && (
            <EmptyState
              title='You’re all caught up'
              description='Reviews and requests will appear here.'
            />
          )
        ))}
    </HomeSection>
  )
}
