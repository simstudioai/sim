import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/home/_components/activity-list/activity-list.module.css'
import { HomeSection } from '@/platform/app/(shell)/home/_components/home-section/home-section'
import type { HomeData, HomeRow } from '@/platform/app/(shell)/home/_components/model'
import { Avatar, Button, EmptyState, Icon, OverflowText } from '@/platform/design-system/components'

interface ActivityRowProps {
  leading?: ReactNode
  title: string
  count?: number
  detail: string
  subject?: string
  metadata: ReactNode
  onOpen: () => void
}

function ActivityRow({
  leading,
  title,
  count,
  detail,
  subject,
  metadata,
  onOpen,
}: ActivityRowProps) {
  return (
    <li>
      <button type='button' className={styles.row} onClick={onOpen}>
        {leading && (
          <span className={styles.leading} aria-hidden='true'>
            {leading}
          </span>
        )}
        <span className={styles.copy}>
          <span className={styles.title} data-type='T059'>
            <OverflowText text={count ? `${title} ${count}` : title}>
              {title}
              {count ? <small data-type='T036'>{count}</small> : null}
            </OverflowText>
          </span>
          <span className={styles.detail} data-type='T050'>
            <OverflowText text={subject ? `${subject} ${detail}` : detail}>
              {subject && (
                <>
                  <strong data-type='T051'>{subject}</strong>{' '}
                </>
              )}
              {detail}
            </OverflowText>
          </span>
        </span>
        <span className={styles.meta} data-type='T052'>
          {metadata}
          <Icon name='I032' />
        </span>
      </button>
    </li>
  )
}

interface EmailListProps {
  messages: HomeData['email']
  onOpen: () => void
}

export function EmailList({ messages, onOpen }: EmailListProps) {
  if (!messages.length) return <EmptyState title='No email yet' />
  return (
    <ul className={styles.entries}>
      {messages.map((mail) => (
        <ActivityRow
          key={mail.id}
          leading={<Avatar size='inline' name={mail.sender} src={mail.avatar} />}
          title={mail.sender}
          count={mail.count}
          subject={mail.subject}
          detail={mail.excerpt}
          metadata={mail.received}
          onOpen={onOpen}
        />
      ))}
    </ul>
  )
}

interface WorkListProps {
  title: 'Workspaces' | 'Needs your attention'
  rows: HomeRow[]
  onOpen: () => void
}

export function WorkList({ title, rows, onOpen }: WorkListProps) {
  const workspaces = title === 'Workspaces'
  return (
    <HomeSection title={title}>
      {rows.length ? (
        <ul className={styles.entries}>
          {rows.map((row) => (
            <ActivityRow
              key={row.id}
              leading={workspaces ? undefined : <Icon name={row.icon} />}
              title={row.title}
              detail={row.detail}
              metadata={
                <>
                  {row.indicator && <Icon name={row.indicator} />}
                  {row.meta}
                </>
              }
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          title={workspaces ? 'Create your first workspace' : 'You’re all caught up'}
          description={
            workspaces
              ? 'Give a business process a place to run.'
              : 'Reviews and requests will appear here.'
          }
          action={
            workspaces ? (
              <Button size='compact' onClick={onOpen}>
                Create workspace
              </Button>
            ) : undefined
          }
        />
      )}
    </HomeSection>
  )
}
