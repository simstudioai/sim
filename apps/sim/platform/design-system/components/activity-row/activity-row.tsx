import type { ComponentProps, ReactNode } from 'react'
import Link from 'next/link'
import { ActivityBody } from '@/platform/design-system/components/activity-row/activity-body'
import styles from '@/platform/design-system/components/activity-row/activity-row.module.css'
import { AvatarGroup } from '@/platform/design-system/components/avatar/avatar'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { CountedLabel } from '@/platform/design-system/components/overflow-text/counted-label'
import { OverflowText } from '@/platform/design-system/components/overflow-text/overflow-text'

interface ActivityRowProps {
  onNavigate?: ComponentProps<typeof Link>['onNavigate']
  leading?: ReactNode
  title: string
  count?: number
  detail: string
  detailLead?: string
  showChevron?: boolean
  disabled?: boolean
}

type ActivityTarget = { href: string; onOpen?: never } | { href?: never; onOpen: () => void }
type ActivityMetadata =
  | { textMetadata?: string; people?: never }
  | { textMetadata?: never; people: ComponentProps<typeof AvatarGroup> }

export function ActivityRow({
  onNavigate,
  leading,
  title,
  count,
  detail,
  detailLead,
  textMetadata,
  people,
  disabled = false,
  showChevron = !disabled,
  onOpen,
  href,
}: ActivityRowProps & ActivityTarget & ActivityMetadata) {
  const content = (
    <>
      <ActivityBody leading={leading}>
        <span data-type='T059'>
          <CountedLabel label={title} count={count} />
        </span>
        <span className={styles.detail} data-type='T050'>
          <OverflowText text={detailLead ? `${detailLead} ${detail}` : detail}>
            {detailLead && (
              <>
                <strong data-type='T051'>{detailLead}</strong>{' '}
              </>
            )}
            {detail}
          </OverflowText>
        </span>
      </ActivityBody>
      {(textMetadata || people || showChevron) && (
        <span className={styles.meta} data-type='T052'>
          {textMetadata && <span className={styles.metaLabel}>{textMetadata}</span>}
          {people && (
            <AvatarGroup people={people.people} total={people.total} label={people.label} />
          )}
          {showChevron && <Icon name='I032' />}
        </span>
      )}
    </>
  )
  return (
    <li className={styles.entry}>
      {href !== undefined && !disabled ? (
        <Link href={href} className={styles.row} onNavigate={onNavigate}>
          {content}
        </Link>
      ) : (
        <button type='button' className={styles.row} onClick={onOpen} disabled={disabled}>
          {content}
        </button>
      )}
    </li>
  )
}
