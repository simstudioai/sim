'use client'

import type { ReactNode } from 'react'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { FailureNotice } from '@sim/emcn/status'
import { PageColumn } from '@sim/emcn-platform/page-column'
import { DirectoryBack } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/detail-split/detail-split.module.css'
import type { WorkspaceRead } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useListReturn } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'

interface DetailSplitProps {
  /** Where Back returns: the list, with its search, filters and sort. */
  back: { href: string; label: string }
  /** Names the scrolling reading column for assistive technology. */
  label: string
  /** Decisions and other record actions, pinned above the details. */
  controls?: ReactNode
  /** The facts rail: status, timestamps and outcomes. */
  facts: ReactNode
  /** The record's read; anything but ready replaces the split, never Back. */
  read?: WorkspaceRead
  /** The reading column, which alone scrolls. */
  children: ReactNode
}

const READY: WorkspaceRead = { status: 'ready' }

/**
 * A record's details beside its facts. Back and the controls stay put; only the reading column
 * scrolls, fading at whichever edge has more. On a narrow screen the facts sit above it.
 */
export function DetailSplit({
  back,
  label,
  controls,
  facts,
  read = READY,
  children,
}: DetailSplitProps) {
  const reading = useScrollEdges<HTMLDivElement>('vertical')
  const rail = useScrollEdges<HTMLElement>('vertical')
  const returnToList = useListReturn()
  return (
    <PageColumn>
      <main className={styles.record}>
        <DirectoryBack href={back.href} label={back.label} onNavigate={returnToList} />
        {read.status === 'error' && (
          <FailureNotice message={read.message} retrying={read.retrying} onRetry={read.onRetry} />
        )}
        {read.status === 'ready' && controls}
        {read.status === 'ready' && (
          <div className={styles.frame}>
            <div className={styles.split}>
              <div ref={reading} className={styles.reading} role='region' aria-label={label}>
                <div className={styles.content}>{children}</div>
              </div>
              <aside ref={rail} className={styles.facts} aria-label='Facts'>
                {facts}
              </aside>
            </div>
          </div>
        )}
      </main>
    </PageColumn>
  )
}

interface DetailSectionProps {
  title: string
  children: ReactNode
}

/** A titled block in the reading column. */
export function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <section className={styles.section} aria-label={title}>
      <h2 data-type='T042'>{title}</h2>
      {children}
    </section>
  )
}

interface DetailHeadingProps {
  title: string
  description?: string
}

/** The record's own read-only title and description, in the Integrations heading type. */
export function DetailHeading({ title, description }: DetailHeadingProps) {
  return (
    <header className={styles.heading}>
      <h1 data-type='T076'>{title}</h1>
      {description && <p data-type='T048'>{description}</p>}
    </header>
  )
}
