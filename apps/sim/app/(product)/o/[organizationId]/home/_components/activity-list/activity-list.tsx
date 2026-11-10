import { ActivityRow } from '@sim/emcn/activity-row'
import { Avatar } from '@sim/emcn/avatar'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { ScrollArea } from '@sim/emcn/scroll-area'
import { FailureNotice } from '@sim/emcn/status'
import { HomeSection } from '@/app/(product)/_components/home-section/home-section'
import styles from '@/app/(product)/o/[organizationId]/home/_components/activity-list/activity-list.module.css'
import type { AttentionItem, EmailItem } from '@/platform/lib/data/models/home'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { usePlatformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'
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

function AttentionRow({ row, asOf }: { row: AttentionItem; asOf: number }) {
  const scope = useSurfaceScope()
  const hrefFor = usePlatformHref()
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
      href={hrefFor(row.href ?? surfaceHref(scope, '/home'))}
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
      {state.status === 'error' && (
        <FailureNotice message='This could not load.' retrying={state.retrying} onRetry={onRetry} />
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
                <ul className={styles.entries}>
                  {state.items.map((row) => (
                    <AttentionRow key={row.id} row={row} asOf={asOf} />
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
