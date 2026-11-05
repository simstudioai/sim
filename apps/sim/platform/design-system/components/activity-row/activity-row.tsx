import type { ReactNode } from 'react'
import Link from 'next/link'
import { ActivityBody } from '@/platform/design-system/components/activity-row/activity-body'
import styles from '@/platform/design-system/components/activity-row/activity-row.module.css'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { CountedLabel } from '@/platform/design-system/components/overflow-text/counted-label'
import { OverflowText } from '@/platform/design-system/components/overflow-text/overflow-text'

interface ActivityRowProps {
  leading?: ReactNode
  title: string
  count?: number
  detail: string
  detailLead?: string
  metadata?: string
  showChevron?: boolean
}

type ActivityTarget = { href: string; onOpen?: never } | { href?: never; onOpen: () => void }

export function ActivityRow({
  leading,
  title,
  count,
  detail,
  detailLead,
  metadata,
  showChevron = true,
  onOpen,
  href,
}: ActivityRowProps & ActivityTarget) {
  const content = (
    <>
      <ActivityBody leading={leading} decorativeLeading>
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
      {(metadata || showChevron) && (
        <span className={styles.meta} data-type='T052'>
          {metadata}
          {showChevron && <Icon name='I032' />}
        </span>
      )}
    </>
  )
  return (
    <li>
      {href !== undefined ? (
        <Link href={href} className={styles.row}>
          {content}
        </Link>
      ) : (
        <button type='button' className={styles.row} onClick={onOpen}>
          {content}
        </button>
      )}
    </li>
  )
}
