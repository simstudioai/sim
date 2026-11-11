'use client'

import type { ReactNode } from 'react'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-section.module.css'

interface UsageBlockProps {
  title: string
  /** A quiet note at the heading's end, such as the span the block covers. */
  note?: string
  /** The figures on screen belong to the previous period while the new one loads. */
  dimmed?: boolean
  children?: ReactNode
}

/**
 * A titled Insights section without a surface: charts and tables carry their own frame, so the
 * bordered `SettingsSection` would box a box. The one place Insights draws a section heading.
 */
export function UsageBlock({ title, note, dimmed, children }: UsageBlockProps) {
  return (
    <section className={styles.block} aria-label={title} data-dimmed={dimmed || undefined}>
      <div className={styles.heading}>
        <h2 data-type='T093'>{title}</h2>
        {note && (
          <span className={styles.quiet} data-type='T060'>
            {note}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}
