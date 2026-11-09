'use client'

import type { DragEvent, MouseEvent, ReactNode } from 'react'
import { Icon, type IconName } from '@sim/emcn/icon'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/item-card/item-card.module.css'

/** Native drag-and-drop wiring that lets a card move within its list. */
interface ItemCardDrag {
  draggable: boolean
  dragging: boolean
  dropTarget: boolean
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}

interface ItemCardProps {
  /** A quiet interface glyph before the name, for an item with no mark of its own. */
  icon?: IconName
  /** The item's own mark, such as a tool's brand tile, before its name. */
  mark?: ReactNode
  /** The item's name, possibly with the workflow-search match marked. */
  name: ReactNode
  /** The plain name, which names the header action for assistive technology. */
  title: string
  badges?: ReactNode
  actions?: ReactNode
  /** Whether the card has a body to open. */
  expandable: boolean
  expanded: boolean
  /** The header's action: toggles the body, or edits a custom tool that has none. */
  onActivate?: () => void
  /** The item is inactive, such as a tool set to None, which the model never calls. */
  muted?: boolean
  /** Moves the card within its list; a card in a fixed list leaves it out. */
  drag?: ItemCardDrag
  children?: ReactNode
}

/**
 * Keeps an action's click off the header. A portalled menu (Remove all from server) still bubbles
 * its clicks through React to the header, which would otherwise toggle the card it just changed.
 */
function stopHeaderToggle(event: MouseEvent) {
  event.stopPropagation()
}

/**
 * One chosen item in a field: a selected tool, skill, resource or uploaded file. Its identity row
 * carries status and actions, over the item's settings when it has any and is open.
 */
export function ItemCard({
  icon,
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
}: ItemCardProps) {
  const identity = (
    <>
      {icon && (
        <span className={styles.glyph}>
          <Icon name={icon} />
        </span>
      )}
      {mark}
      <span className={styles.name} data-type='T060'>
        {name}
      </span>
    </>
  )
  return (
    <div
      className={styles.card}
      data-draggable={drag?.draggable || undefined}
      data-dragging={drag?.dragging || undefined}
      data-drop-target={drag?.dropTarget || undefined}
      draggable={drag?.draggable}
      onDragStart={drag?.onDragStart}
      onDragEnd={drag?.onDragEnd}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
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
        {actions && (
          <span role='presentation' className={styles.headerActions} onClick={stopHeaderToggle}>
            {actions}
          </span>
        )}
      </div>
      {expanded && <div className={styles.body}>{children}</div>}
    </div>
  )
}

interface ItemListProps {
  /** Names the list for assistive technology, as "Selected channels". */
  label: string
  /** One `<li>` per chosen item, each holding an {@link ItemCard}. */
  children: ReactNode
}

/** The stack of a field's chosen items. */
export function ItemList({ label, children }: ItemListProps) {
  return (
    <ul className={styles.list} aria-label={label}>
      {children}
    </ul>
  )
}
