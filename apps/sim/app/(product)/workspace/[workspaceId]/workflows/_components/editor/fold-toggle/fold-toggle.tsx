'use client'

import type { ReactNode } from 'react'
import { Icon } from '@sim/emcn/icon'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/fold-toggle/fold-toggle.module.css'

interface FoldToggleProps {
  open: boolean
  /** The id of the body this toggle shows, named while it is open. */
  controls: string
  /** Folds or unfolds the entry; without it the toggle cannot fold. */
  onToggle?: () => void
  /** The entry's title and whatever follows it, such as a type tag or a summary. */
  children: ReactNode
}

/**
 * The header control that folds a list entry, as input, response and variable fields and the
 * filter, sort and tag rules use it. Its title is rich text, which carries workflow search marks
 * that the shared Disclosure's plain label cannot.
 */
export function FoldToggle({ open, controls, onToggle, children }: FoldToggleProps) {
  return (
    <button
      type='button'
      className={styles.toggle}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      disabled={!onToggle}
      onClick={onToggle}
    >
      <span className={styles.chevron}>
        <Icon name={open ? 'I051' : 'I090'} />
      </span>
      {children}
    </button>
  )
}
