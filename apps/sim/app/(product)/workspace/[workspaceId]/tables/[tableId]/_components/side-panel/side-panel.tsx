'use client'

import { type ReactNode, useRef } from 'react'
import { IconButton } from '@sim/emcn/button'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { useNotificationTrayClearance } from '@/app/(product)/_components/notification-tray/tray-clearance'
import styles from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/side-panel/side-panel.module.css'

interface SidePanelProps {
  /** The panel's heading, which also names it for assistive technology. */
  title: string
  onClose: () => void
  /** A step back to the panel's previous view, shown before the title. */
  back?: { label: string; onBack: () => void }
  /** Actions at the foot of the panel, such as Cancel and Save, in reading order. */
  footer?: ReactNode
  children: ReactNode
}

/**
 * The table's right-hand panel for configuring a column, a workflow group or an enrichment, and for
 * reading an execution: a heading with its close action, a body that scrolls with edge fades, and
 * an optional footer of actions. The grid gives up the panel's width while it is open, so no cell
 * hides beneath it, and the notification tray rises above the footer so it never covers Save.
 */
export function SidePanel({ title, onClose, back, footer, children }: SidePanelProps) {
  const body = useScrollEdges<HTMLDivElement>('vertical')
  const footerRef = useRef<HTMLElement>(null)
  useNotificationTrayClearance(footerRef, Boolean(footer))
  return (
    <aside className={styles.panel} aria-label={title}>
      <header className={styles.header}>
        <span className={styles.heading}>
          {back && <IconButton label={back.label} icon='I093' onClick={back.onBack} />}
          <h2 className={styles.title} data-type='T059'>
            {title}
          </h2>
        </span>
        <IconButton label='Close' icon='I105' onClick={onClose} />
      </header>
      <div ref={body} className={styles.body}>
        {children}
      </div>
      {footer && (
        <footer ref={footerRef} className={styles.footer}>
          {footer}
        </footer>
      )}
    </aside>
  )
}

interface SidePanelSectionProps {
  /** A caption above the section's fields; omitted for a section that needs none. */
  title?: string
  children: ReactNode
}

/** A group of related fields in the panel body, separated from its neighbors by the section gap. */
export function SidePanelSection({ title, children }: SidePanelSectionProps) {
  return (
    <section className={styles.section}>
      {title && (
        <h3 className={styles.sectionTitle} data-type='T050'>
          {title}
        </h3>
      )}
      {children}
    </section>
  )
}

interface SidePanelNoteProps {
  children: ReactNode
}

/** Supporting copy in the panel body, such as an empty result or what a section does not need. */
export function SidePanelNote({ children }: SidePanelNoteProps) {
  return (
    <p className={styles.note} data-type='T060'>
      {children}
    </p>
  )
}
