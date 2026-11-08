'use client'

import { type ReactNode, useId } from 'react'
import { Icon } from '@sim/emcn/icon'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/rule-card.module.css'

/** Props for {@link RuleCard}. */
interface RuleCardProps {
  /** Names the group for assistive technology, such as "Condition 1". */
  label: string
  /** The header text: the generic label while open, the rule's summary while collapsed. */
  title: ReactNode
  /** Secondary text after the title, such as the rule's operator while collapsed. */
  detail?: ReactNode
  /** Hides the fields; only a card with `onToggle` can be collapsed by the viewer. */
  collapsed?: boolean
  /** Shows or hides the fields from the header; leave it out for a fixed card. */
  onToggle?: () => void
  /** The header's trailing icon actions. */
  actions?: ReactNode
  children: ReactNode
}

/**
 * One entry of an ordered list of rules (a filter condition, a sort, a tag, a fallback model): a
 * header naming it, with its actions, above its fields. The header toggles the fields when the list
 * lets the entry collapse.
 */
export function RuleCard({
  label,
  title,
  detail,
  collapsed = false,
  onToggle,
  actions,
  children,
}: RuleCardProps) {
  const bodyId = useId()
  const heading = (
    <>
      <span className={styles.title} data-type='T059'>
        {title}
      </span>
      {detail && (
        <span className={styles.detail} data-type='T052'>
          {detail}
        </span>
      )}
    </>
  )
  return (
    <div className={styles.card} role='group' aria-label={label}>
      <div className={styles.header}>
        {onToggle ? (
          <button
            type='button'
            className={styles.toggle}
            aria-expanded={!collapsed}
            aria-controls={collapsed ? undefined : bodyId}
            onClick={onToggle}
          >
            <span className={styles.chevron}>
              <Icon name={collapsed ? 'I032' : 'I051'} />
            </span>
            {heading}
          </button>
        ) : (
          <span className={styles.heading}>{heading}</span>
        )}
        {actions && <span className={styles.actions}>{actions}</span>}
      </div>
      {!collapsed && (
        <div id={bodyId} className={styles.body}>
          {children}
        </div>
      )}
    </div>
  )
}

/** Props for {@link RuleField}. */
interface RuleFieldProps {
  label: string
  /** The id of the native field the label names and focuses. */
  htmlFor?: string
  children: ReactNode
}

/** A labelled field inside a {@link RuleCard} whose control renders no label of its own. */
export function RuleField({ label, htmlFor, children }: RuleFieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={htmlFor} data-type='T059'>
        {label}
      </label>
      {children}
    </div>
  )
}

/** Props for {@link RuleList}. */
interface RuleListProps {
  /** The rules, each a {@link RuleCard}; none for an empty list. */
  children?: ReactNode
  /** A trailing action that adds a rule, sized to its label. */
  action?: ReactNode
}

/** The stack of a builder's rules, with its add action beneath them. */
export function RuleList({ children, action }: RuleListProps) {
  return (
    <div className={styles.list}>
      {children}
      {action && <div className={styles.listAction}>{action}</div>}
    </div>
  )
}
