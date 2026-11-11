'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { PageOverflow } from '@sim/emcn-platform/page-column'
import Link from 'next/link'
import { useSettingsHeading } from '@/app/(product)/_components/settings-parts/settings-page'
import styles from '@/app/(product)/_components/settings-parts/settings-parts.module.css'

interface ChildrenProps {
  children: ReactNode
}

/** The sections of one settings page, in reading order. */
export function SectionStack({ children }: ChildrenProps) {
  return <div className={styles.stack}>{children}</div>
}

/** Labeled fields inside a settings surface. */
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

/** The list element `ActivityRow` rows sit in. */
export function ResourceList({ children }: ChildrenProps) {
  return (
    <PageOverflow>
      <ul className={styles.list}>{children}</ul>
    </PageOverflow>
  )
}

interface DetailHeaderContent {
  backLabel: string
  title: string
  description?: string
  children?: ReactNode
}

type DetailHeaderProps = DetailHeaderContent &
  ({ backHref: string; onBack?: never } | { onBack: () => void; backHref?: never })

/**
 * A sub-view's way back, title and actions. It takes the place of the page's `SettingsPageHeader`,
 * so it renders the page's heading.
 */
export function DetailHeader({
  backLabel,
  backHref,
  onBack,
  title,
  description,
  children,
}: DetailHeaderProps) {
  const heading = useSettingsHeading()
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
      <div className={styles.detailTitleRow}>
        <div className={styles.detailTitle}>
          {heading.level === 'h1' ? (
            <h1 id={heading.id} data-type='T093'>
              {title}
            </h1>
          ) : (
            <h2 id={heading.id} data-type='T093'>
              {title}
            </h2>
          )}
          {description && (
            <p className={styles.muted} data-type='T060'>
              {description}
            </p>
          )}
        </div>
        {children && <div className={styles.actions}>{children}</div>}
      </div>
    </header>
  )
}
