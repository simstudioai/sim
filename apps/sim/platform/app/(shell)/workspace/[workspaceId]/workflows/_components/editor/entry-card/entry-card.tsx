'use client'

import { type ReactNode, useId } from 'react'
import { Icon } from '@sim/emcn/icon'
import { StatusTag } from '@sim/emcn/status'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/entry-card/entry-card.module.css'

interface EntryCardProps {
  /** Names the entry for assistive technology, as "Input 2". */
  label: string
  /** What the header shows: the entry's name, or its label until it has one. */
  title: ReactNode
  /** The entry's value type, beside its title. */
  typeTag?: string
  collapsed: boolean
  /** Folds or unfolds the entry; without it the header cannot fold the entry. */
  onToggle?: () => void
  /** Add and remove controls at the header's end, outside the fold toggle. */
  actions?: ReactNode
  children: ReactNode
}

/**
 * One entry of a list sub-block: a header that folds the entry, with its name and value type, and
 * the entry's own fields beneath it while unfolded. Entries sit apart by gap alone.
 */
export function EntryCard({
  label,
  title,
  typeTag,
  collapsed,
  onToggle,
  actions,
  children,
}: EntryCardProps) {
  const bodyId = useId()
  return (
    <div role='group' aria-label={label} className={styles.entry}>
      <div className={styles.header}>
        <button
          type='button'
          className={styles.toggle}
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : bodyId}
          disabled={!onToggle}
          onClick={onToggle}
        >
          <span className={styles.chevron}>
            <Icon name={collapsed ? 'I032' : 'I051'} />
          </span>
          <span className={styles.title} data-type='T060'>
            {title}
          </span>
          {typeTag && <StatusTag label={typeTag} />}
        </button>
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
