import type { ReactNode } from 'react'
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
  onOpen: () => void
}

export function ActivityRow({
  leading,
  title,
  count,
  detail,
  detailLead,
  metadata,
  showChevron = true,
  onOpen,
}: ActivityRowProps) {
  return (
    <li>
      <button type='button' className={styles.row} onClick={onOpen}>
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
      </button>
    </li>
  )
}
