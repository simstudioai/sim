import type { ComponentProps, ReactNode } from 'react'
import Link from 'next/link'
import { ActivityBody } from '#emcn/components/activity-row/activity-body'
import styles from '#emcn/components/activity-row/activity-row.module.css'
import { AvatarGroup } from '#emcn/components/avatar/avatar'
import { Icon } from '#emcn/components/icon/icon'
import { CountedLabel } from '#emcn/components/overflow-text/counted-label'
import { OverflowText } from '#emcn/components/overflow-text/overflow-text'

interface ActivityRowProps {
  onNavigate?: ComponentProps<typeof Link>['onNavigate']
  leading?: ReactNode
  title: string
  count?: number
  detail: string
  detailContent?: ReactNode
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
  detailContent,
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
            {detailContent ?? detail}
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
