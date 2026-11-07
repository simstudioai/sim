import { useSearchParams } from 'next/navigation'
import styles from '@/platform/app/(shell)/home/_components/activity-list/activity-list.module.css'
import { HomeSection } from '@/platform/app/(shell)/home/_components/home-section/home-section'
import type { AttentionItem, EmailItem } from '@/platform/app/(shell)/home/_components/model'
import { RetryButton } from '@/platform/app/(shell)/home/_components/retry-button/retry-button'
import { WidgetSkeleton } from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import {
  ActivityRow,
  Avatar,
  EmptyState,
  Icon,
  InlineNotice,
  ScrollArea,
} from '@/platform/design-system/components'
import { platformHref } from '@/platform/design-system/navigation'
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
        <ul className={styles.entries}>
          {items.map((mail) => (
            <ActivityRow
              key={mail.id}
              leading={<Avatar size='inline' name={mail.sender} />}
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

function AttentionRow({
  row,
  asOf,
  search,
}: {
  row: AttentionItem
  asOf: number
  search: ReturnType<typeof useSearchParams>
}) {
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
      href={platformHref(row.href ?? '/home', search)}
    />
  )
}

interface AttentionListProps {
  state: HomeListState<AttentionItem>
  asOf: number
  onRetry: () => void
}

export function AttentionList({ state, asOf, onRetry }: AttentionListProps) {
  const search = useSearchParams()
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
                    <AttentionRow key={row.id} row={row} asOf={asOf} search={search} />
                  ))}
                </ul>
              </ScrollArea>
            </div>
          ) : (
            !state.partial && (
              <EmptyState
                title='You’re all caught up'
                description='Anything that needs you will appear here.'
              />
            )
          )}
        </>
      )}
    </HomeSection>
  )
}
