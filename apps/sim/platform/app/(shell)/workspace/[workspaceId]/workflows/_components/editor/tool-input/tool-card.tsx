'use client'

import type { DragEvent, MouseEvent, ReactNode } from 'react'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/tool-input/tool-input.module.css'

/** Native drag-and-drop wiring that lets a card move within the tool list. */
interface ToolCardDrag {
  draggable: boolean
  dragging: boolean
  dropTarget: boolean
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}

interface ToolCardProps {
  mark: ReactNode
  /** The tool's name, possibly with the workflow-search match marked. */
  name: ReactNode
  /** The plain name, which names the header action for assistive technology. */
  title: string
  badges?: ReactNode
  actions: ReactNode
  /** Whether the card has a body to open. */
  expandable: boolean
  expanded: boolean
  /** The header's action: toggles the body, or edits a custom tool that has none. */
  onActivate?: () => void
  /** The tool is set to None, so the model never calls it. */
  muted?: boolean
  drag: ToolCardDrag
  children?: ReactNode
}

/**
 * Keeps an action's click off the header. A portalled menu (Remove all from server) still bubbles
 * its clicks through React to the header, which would otherwise toggle the card it just changed.
 */
function stopHeaderToggle(event: MouseEvent) {
  event.stopPropagation()
}

/** One selected tool: its identity row with status and actions, over its settings when open. */
export function ToolCard({
  mark,
  name,
  title,
  badges,
  actions,
  expandable,
  expanded,
  onActivate,
  muted,
  drag,
  children,
}: ToolCardProps) {
  const identity = (
    <>
      {mark}
      <span className={styles.name} data-type='T060'>
        {name}
      </span>
    </>
  )
  return (
    <div
      className={styles.card}
      data-draggable={drag.draggable || undefined}
      data-dragging={drag.dragging || undefined}
      data-drop-target={drag.dropTarget || undefined}
      draggable={drag.draggable}
      onDragStart={drag.onDragStart}
      onDragEnd={drag.onDragEnd}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
    >
      <div
        role='presentation'
        className={styles.header}
        data-interactive={onActivate ? true : undefined}
        data-muted={muted || undefined}
        onClick={onActivate}
      >
        {onActivate ? (
          <button
            type='button'
            className={styles.identity}
            aria-expanded={expandable ? expanded : undefined}
            aria-label={expandable ? title : `Edit ${title}`}
            onClick={(event) => {
              event.stopPropagation()
              onActivate()
            }}
          >
            {identity}
          </button>
        ) : (
          <span className={styles.identity}>{identity}</span>
        )}
        {badges}
        <span className={styles.fill} />
        <span role='presentation' className={styles.headerActions} onClick={stopHeaderToggle}>
          {actions}
        </span>
      </div>
      {expanded && <div className={styles.body}>{children}</div>}
    </div>
  )
}
