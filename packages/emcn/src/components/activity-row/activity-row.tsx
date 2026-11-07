'use client'

import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { useRender } from '@base-ui/react/use-render'
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
  detail?: string
  detailContent?: ReactNode
  detailLead?: string
  /** Lets the detail take more lines, for a sentence a touch screen has no tooltip to finish. */
  wrapDetail?: boolean
  showChevron?: boolean
  disabled?: boolean
  /** `comfortable` for a settings list, where each row is a resource rather than a line of activity. */
  density?: 'regular' | 'comfortable'
}

type ActivityTarget =
  | { href: string; onOpen?: never; render?: never; readOnly?: never }
  | { href?: never; onOpen: () => void; render?: never; readOnly?: never }
  /** The row's own link, for a destination whose navigation carries a guard. */
  | { href?: never; onOpen?: never; render: ReactElement; readOnly?: never }
  /** A row in the same list that opens nothing, such as a source this deployment does not offer. */
  | { href?: never; onOpen?: never; render?: never; readOnly: true }

type ActivityMetadata =
  | {
      textMetadata?: string
      /** A glyph held beside `textMetadata`, such as a running spinner. */
      metadataLeading?: ReactNode
      people?: never
    }
  | { textMetadata?: never; metadataLeading?: never; people: ComponentProps<typeof AvatarGroup> }

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
  onNavigate,
  leading,
  title,
  count,
  detail,
  detailContent,
  detailLead,
  wrapDetail,
  textMetadata,
  metadataLeading,
  people,
  disabled = false,
  showChevron = !disabled,
  density = 'regular',
  onOpen,
  href,
  render,
  readOnly,
}: ActivityRowProps & ActivityTarget & ActivityMetadata) {
  const chevron = showChevron && !readOnly
  const content = (
    <>
      <ActivityBody leading={leading}>
        <span data-type='T059'>
          <CountedLabel label={title} count={count} />
        </span>
        {(detail || detailContent) && (
          <span className={styles.detail} data-type='T050'>
            {wrapDetail ? (
              (detailContent ?? detail)
            ) : (
              <OverflowText text={detailLead ? `${detailLead} ${detail ?? ''}` : (detail ?? '')}>
                {detailLead && (
                  <>
                    <strong data-type='T051'>{detailLead}</strong>{' '}
                  </>
                )}
                {detailContent ?? detail}
              </OverflowText>
            )}
          </span>
        )}
      </ActivityBody>
      {(textMetadata || people || chevron) && (
        <span className={styles.meta} data-type='T052'>
          {textMetadata && (
            <span className={styles.metaLabel}>
              {metadataLeading}
              {textMetadata}
            </span>
          )}
          {people && (
            <AvatarGroup people={people.people} total={people.total} label={people.label} />
          )}
          {chevron && <Icon name='I032' />}
        </span>
      )}
    </>
  )
  return (
    <li className={styles.entry}>
      {readOnly ? (
        <div className={styles.row} data-density={density} data-read-only>
          {content}
        </div>
      ) : render ? (
        <RenderedRow render={render} rowDensity={density}>
          {content}
        </RenderedRow>
      ) : href !== undefined && !disabled ? (
        <Link href={href} className={styles.row} data-density={density} onNavigate={onNavigate}>
          {content}
        </Link>
      ) : (
        <button
          type='button'
          className={styles.row}
          data-density={density}
          onClick={onOpen}
          disabled={disabled}
        >
          {content}
        </button>
      )}
    </li>
  )
}
