'use client'

import type { ReactElement, ReactNode } from 'react'
import { useRender } from '@base-ui/react/use-render'
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
  detail?: string
  detailLead?: string
  metadata?: string
  /** A glyph held beside `metadata`, such as a running spinner. */
  metadataLeading?: ReactNode
  showChevron?: boolean
  /** `comfortable` for a settings list, where each row is a resource rather than a line of activity. */
  density?: 'regular' | 'comfortable'
}

type ActivityTarget =
  | { href: string; onOpen?: never; render?: never }
  | { href?: never; onOpen: () => void; render?: never }
  /** The row's own link, for a destination whose navigation carries a guard. */
  | { href?: never; onOpen?: never; render: ReactElement }

interface RenderedRowProps {
  render: ReactElement
  rowDensity: ActivityRowProps['density']
  children: ReactNode
}

function RenderedRow({ render, rowDensity, children }: RenderedRowProps) {
  return useRender({
    render,
    props: { className: styles.row, 'data-density': rowDensity, children },
  })
}

export function ActivityRow({
  leading,
  title,
  count,
  detail,
  detailLead,
  metadata,
  metadataLeading,
  showChevron = true,
  density = 'regular',
  onOpen,
  href,
  render,
}: ActivityRowProps & ActivityTarget) {
  const content = (
    <>
      <ActivityBody leading={leading} decorativeLeading>
        <span data-type='T059'>
          <CountedLabel label={title} count={count} />
        </span>
        {detail && (
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
        )}
      </ActivityBody>
      {(metadata || showChevron) && (
        <span className={styles.meta} data-type='T052'>
          {metadata && (
            <span className={styles.metaLabel}>
              {metadataLeading}
              {metadata}
            </span>
          )}
          {showChevron && <Icon name='I032' />}
        </span>
      )}
    </>
  )
  return (
    <li className={styles.entry}>
      {render ? (
        <RenderedRow render={render} rowDensity={density}>
          {content}
        </RenderedRow>
      ) : href !== undefined ? (
        <Link href={href} className={styles.row} data-density={density}>
          {content}
        </Link>
      ) : (
        <button type='button' className={styles.row} data-density={density} onClick={onOpen}>
          {content}
        </button>
      )}
    </li>
  )
}
