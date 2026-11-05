'use client'

import type { ReactNode } from 'react'
import styles from '@/platform/app/(shell)/settings/_components/section-parts/section-parts.module.css'
import { Button, InlineNotice, SegmentedControl } from '@/platform/design-system/components'

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
  return <ul className={styles.list}>{children}</ul>
}

interface DetailHeaderProps {
  backLabel: string
  onBack: () => void
  title: string
  description?: string
  children?: ReactNode
}

/** A sub-view's way back, title and actions. */
export function DetailHeader({
  backLabel,
  onBack,
  title,
  description,
  children,
}: DetailHeaderProps) {
  return (
    <header className={styles.detailHeader}>
      <div className={styles.back}>
        <Button variant='quiet' size='compact' onClick={onBack}>
          {backLabel}
        </Button>
      </div>
      <div className={styles.detailTitleRow}>
        <div className={styles.detailTitle}>
          <h2 data-type='T093'>{title}</h2>
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

/** Loading text at the place the content will appear, so nothing reads as empty meanwhile. */
export function LoadingState({ label }: { label: string }) {
  return (
    <p className={styles.muted} data-type='T060' role='status'>
      {label}
    </p>
  )
}

interface QueryErrorStateProps {
  message: string
  retrying?: boolean
  onRetry?: () => void
}

/** A failed read. It must say so rather than leaving the setting looking absent. */
export function QueryErrorState({ message, retrying, onRetry }: QueryErrorStateProps) {
  return (
    <InlineNotice
      intent='danger'
      message={message}
      action={
        onRetry && (
          <Button variant='quiet' size='compact' disabled={retrying} onClick={onRetry}>
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        )
      }
    />
  )
}

interface SectionTabsProps<Tab extends string> {
  label: string
  tabs: ReadonlyArray<{ value: Tab; label: string }>
  value: Tab
  onSelect: (tab: Tab) => void
}

export function SectionTabs<Tab extends string>({
  label,
  tabs,
  value,
  onSelect,
}: SectionTabsProps<Tab>) {
  return <SegmentedControl label={label} options={tabs} value={value} onSelect={onSelect} />
}
