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
  /** Decisions and other record actions, at the end of Back's row. */
  actions?: ReactNode
  /** Names the scrolling reading column for assistive technology. */
  label: string
  /** Beside the reading column: the record's facts, or the data of the part selected in it. Nothing renders no rail. */
  rail?: ReactNode
  railLabel: string
  /** An inspector holds payloads and takes a larger share than a facts lane. */
  railKind?: 'facts' | 'inspector'
  /** The record's read; anything but ready replaces the split, never Back. */
  read?: WorkspaceRead
  /** The reading column, which alone scrolls. */
  children: ReactNode
}

const READY: WorkspaceRead = { status: 'ready' }

/**
 * A record's details beside its rail. Back and the actions share one pinned row; the record's own
 * identifiers belong in its facts. The reading column and the rail each scroll, fading at whichever
 * edge has more, and the rail's boundary spans only its content. A facts rail keeps a narrow lane;
 * an inspector, which holds payloads, takes a larger share. On a narrow screen the record scrolls as
 * one, with facts above the reading column and an inspector below it.
 */
export function DetailSplit({
  back,
  actions,
  label,
  rail,
  railLabel,
  railKind = 'facts',
  read = READY,
  children,
}: DetailSplitProps) {
  const reading = useScrollEdges<HTMLDivElement>('vertical')
  const aside = useScrollEdges<HTMLElement>('vertical')
  const stack = useScrollEdges<HTMLDivElement>('vertical')
  const returnToList = useListReturn()
  const ready = read.status === 'ready'
  return (
    <PageColumn>
      <main className={styles.record}>
        <div className={styles.bar}>
          <DirectoryBack href={back.href} label={back.label} onNavigate={returnToList} />
          {ready && actions && <div className={styles.actions}>{actions}</div>}
        </div>
        {read.status === 'error' && (
          <FailureNotice message={read.message} retrying={read.retrying} onRetry={read.onRetry} />
        )}
        {ready && (
          <div className={styles.frame}>
            <div ref={stack} className={styles.split}>
              <div ref={reading} className={styles.reading} role='region' aria-label={label}>
                <div className={styles.content}>{children}</div>
              </div>
              {rail && (
                <aside
                  ref={aside}
                  className={styles.rail}
                  data-kind={railKind}
                  aria-label={railLabel}
                >
                  {rail}
                </aside>
              )}
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
      <h2 data-type='T093'>{title}</h2>
      {children}
    </section>
  )
}
