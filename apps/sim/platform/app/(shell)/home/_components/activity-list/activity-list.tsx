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

interface EmailListProps {
  messages: HomeData['email']
  onOpen: () => void
}

export function EmailList({ messages, onOpen }: EmailListProps) {
  if (!messages.length) return <EmptyState title='No email yet' />
  return (
    <div className={styles.inbox}>
      <ScrollArea label='Email messages'>
        <ul className={styles.mailEntries}>
          {messages.map((mail) => (
            <ActivityRow
              key={mail.id}
              leading={<Avatar size='inline' name={mail.sender} src={mail.avatar} />}
              title={mail.sender}
              count={mail.count}
              detailLead={mail.subject}
              detail={mail.excerpt}
              metadata={mail.received}
              onOpen={onOpen}
            />
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}

interface AttentionListProps {
  rows: HomeData['attention']
  onOpen: () => void
}

export function AttentionList({ rows, onOpen }: AttentionListProps) {
  return (
    <HomeSection title='Needs your attention'>
      {rows.length ? (
        <ul className={styles.entries}>
          {rows.map((row) => (
            <ActivityRow
              key={row.id}
              leading={<Icon name={row.icon} />}
              title={row.title}
              detail={row.detail}
              metadata={row.meta}
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
