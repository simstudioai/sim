import styles from '@/platform/app/(shell)/home/_components/activity-list/activity-list.module.css'
import { HomeSection } from '@/platform/app/(shell)/home/_components/home-section/home-section'
import type { HomeData } from '@/platform/app/(shell)/home/_components/model'
import {
  ActivityRow,
  Avatar,
  EmptyState,
  Icon,
  ScrollArea,
} from '@/platform/design-system/components'
import { formatRelativeTime } from '@/platform/lib/time'

interface ActivityListProps {
  data: HomeData | null
  onOpen: () => void
}

export function EmailList({ data, onOpen }: ActivityListProps) {
  if (!data?.email.length) return <EmptyState title='No email yet' />
  return (
    <div className={styles.inbox}>
      <ScrollArea label='Email messages'>
        <ul className={styles.mailEntries}>
          {data.email.map((mail) => (
            <ActivityRow
              key={mail.id}
              leading={<Avatar size='inline' name={mail.sender} src={mail.avatar} />}
              title={mail.sender}
              count={mail.count}
              detailLead={mail.subject}
              detail={mail.excerpt}
              metadata={formatRelativeTime(mail.receivedAt, data.asOf)}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}

export function AttentionList({ data, onOpen }: ActivityListProps) {
  return (
    <HomeSection title='Needs your attention'>
      {data?.attention.length ? (
        <ul className={styles.entries}>
          {data.attention.map((row) => (
            <ActivityRow
              key={row.id}
              leading={<Icon name={row.icon} />}
              title={row.title}
              detail={row.detail}
              metadata={formatRelativeTime(row.occurredAt, data.asOf)}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          title='You’re all caught up'
          description='Reviews and requests will appear here.'
        />
      )}
    </HomeSection>
  )
}
