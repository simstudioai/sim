'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { SettingsSection, SettingsSurface } from '@sim/emcn/settings-section'
import { InlineNotice } from '@sim/emcn/status'
import { LoadingRows } from '@sim/emcn/status/query-boundary'
import Link from 'next/link'
import styles from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts.module.css'

interface ChildrenProps {
  children: ReactNode
}

/** The sections of one settings page, in reading order. */
export function SectionStack({ children }: ChildrenProps) {
  return <div className={styles.stack}>{children}</div>
}

/** Labeled fields inside a settings surface. */
/** A heading with what acts on it, end-aligned on the same line where there is room. */
export function HeadingRow({ children }: ChildrenProps) {
  return <div className={styles.headingRow}>{children}</div>
}

export function FieldStack({ children }: ChildrenProps) {
  return <div className={styles.fields}>{children}</div>
}

/** Controls that stop accepting input together while a save is underway. */
export function FormFieldset({ disabled, children }: ChildrenProps & { disabled: boolean }) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      {children}
    </fieldset>
  )
}

interface SectionToolbarProps {
  /** Takes the free width: usually the search field. */
  grow?: ReactNode
  children?: ReactNode
}

export function SectionToolbar({ grow, children }: SectionToolbarProps) {
  return (
    <div className={styles.toolbar}>
      {grow && <div className={styles.toolbarGrow}>{grow}</div>}
      {children && <div className={styles.toolbarEnd}>{children}</div>}
    </div>
  )
}

/** Adjacent buttons in the page flow. */
export function ActionRow({ children }: ChildrenProps) {
  return <div className={styles.actions}>{children}</div>
}

/** A supporting sentence under a control or heading. */
export function Muted({ children }: ChildrenProps) {
  return (
    <p className={styles.muted} data-type='T060'>
      {children}
    </p>
  )
}

/** Sibling rows that are not a list of links, at the list gap. */
export function RowStack({ children }: ChildrenProps) {
  return <div className={styles.rows}>{children}</div>
}

/** Machine-formatted text such as a JSON value or a DNS record, kept verbatim. */
export function Preformatted({ children }: ChildrenProps) {
  return (
    <pre className={styles.pre} data-type='T005'>
      {children}
    </pre>
  )
}

interface DetailHeaderContent {
  backLabel: string
  title: string
  description?: string
  /** The page's own heading, for a page with no section heading above it. */
  pageHeading?: boolean
  children?: ReactNode
}

type DetailHeaderProps = DetailHeaderContent &
  ({ backHref: string; onBack?: never } | { onBack: () => void; backHref?: never })

/** A sub-view's way back, title and actions. */
export function DetailHeader({
  backLabel,
  backHref,
  onBack,
  title,
  description,
  pageHeading,
  children,
}: DetailHeaderProps) {
  return (
    <header className={styles.detailHeader}>
      <div className={styles.back}>
        <Button
          variant='quiet'
          size='compact'
          render={backHref ? <Link href={backHref} /> : undefined}
          onClick={onBack}
        >
          {backLabel}
        </Button>
      </div>
      <HeadingRow>
        <div className={styles.detailTitle}>
          {pageHeading ? <h1 data-type='T076'>{title}</h1> : <h2 data-type='T093'>{title}</h2>}
          {description && (
            <p className={styles.muted} data-type='T060'>
              {description}
            </p>
          )}
        </div>
        {children && <div className={styles.actions}>{children}</div>}
      </HeadingRow>
    </header>
  )
}

interface DraftConflictNoticeProps {
  onKeepMine: () => void
  onTakeLatest: () => void
}

/** The choice `useServerDraft` holds a save behind: the edits stay on screen until it is made. */
export function DraftConflictNotice({ onKeepMine, onTakeLatest }: DraftConflictNoticeProps) {
  return (
    <InlineNotice
      intent='warning'
      title='This changed while you were editing'
      message='Your edits are still here and have not been saved. Keep them to save over the newer version, or use the latest and lose them.'
      action={
        <>
          <Button size='compact' onClick={onKeepMine}>
            Keep my edits
          </Button>
          <Button size='compact' variant='quiet' onClick={onTakeLatest}>
            Use the latest
          </Button>
        </>
      }
    />
  )
}

type SectionSkeletonProps = { rows?: number } & (
  | { title: string; label?: never }
  /** A section that opens with a card and no heading, like a Subscription's plan. */
  | { title?: never; label: string }
)

/** A read's place in the page, inside the heading and card it will fill. */
export function SectionSkeleton({ title, label, rows }: SectionSkeletonProps) {
  if (title)
    return (
      <SettingsSection title={title}>
        <LoadingRows label={`Loading ${title}`} rows={rows} />
      </SettingsSection>
    )
  return (
    <SettingsSurface>
      <LoadingRows label={label ?? 'Loading'} rows={rows} />
    </SettingsSurface>
  )
}
