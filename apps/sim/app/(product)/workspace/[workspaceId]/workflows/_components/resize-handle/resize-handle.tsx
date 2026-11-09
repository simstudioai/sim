import type { PointerEvent } from 'react'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/resize-handle/resize-handle.module.css'

interface ResizeHandleProps {
  /** The edge the handle straddles: a side panel's leading edge, or the terminal's top. */
  edge: 'inline-start' | 'block-start'
  label: string
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
}

/**
 * The editor's drag handle for a docked surface: a separator straddling one edge without taking
 * layout space. Its owner measures the drag and commits the size.
 */
export function ResizeHandle({ edge, label, onPointerDown }: ResizeHandleProps) {
  return (
    <div
      className={styles.handle}
      data-edge={edge}
      role='separator'
      aria-orientation={edge === 'inline-start' ? 'vertical' : 'horizontal'}
      aria-label={label}
      onPointerDown={onPointerDown}
    />
  )
}
