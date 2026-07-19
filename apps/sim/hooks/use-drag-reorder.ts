'use client'

import { type DragEvent, useCallback, useState } from 'react'

/** Props spread onto one reorderable row. */
export interface DragReorderItemProps {
  draggable: boolean
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}

export interface DragReorder {
  /** Index being dragged, or `null` when idle — for dimming the source row. */
  draggingIndex: number | null
  /** Index currently hovered by the drag, or `null` — for the drop indicator. */
  overIndex: number | null
  itemProps: (index: number) => DragReorderItemProps
}

/**
 * Reorder a list by dragging its rows, using native HTML5 drag-and-drop.
 *
 * Native DnD rather than a pointer-event implementation for one concrete
 * reason: the browser auto-scrolls the nearest scrollable ancestor while a
 * drag is near its edge. A hand-rolled version has to reimplement that, and a
 * form long enough to need reordering is exactly the one that needs to scroll
 * while doing it.
 *
 * Shared by both surfaces that reorder form fields — the module on the canvas
 * and the inspector panel — so the two behave identically rather than each
 * growing its own drag state.
 *
 * @param onReorder receives source and destination indices. Called only for a
 * real move, so a drop on the row being dragged is already filtered out.
 * @param enabled `false` leaves every row inert — a read-only viewer gets no
 * drag affordance at all rather than one that silently does nothing.
 */
export function useDragReorder(
  onReorder: (from: number, to: number) => void,
  enabled = true
): DragReorder {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const itemProps = useCallback(
    (index: number): DragReorderItemProps => ({
      draggable: enabled,
      onDragStart: (event) => {
        if (!enabled) {
          event.preventDefault()
          return
        }
        /**
         * A reorderable row can sit inside another draggable — a form field
         * inside an interface module's cell. Without this the native event
         * bubbles, the cell overwrites the drag payload with its own module id,
         * and dropping the field relocates the whole module instead.
         */
        event.stopPropagation()
        event.dataTransfer.effectAllowed = 'move'
        /** Firefox refuses to start a drag with an empty data transfer. */
        event.dataTransfer.setData('text/plain', String(index))
        setDraggingIndex(index)
      },
      /** Fires for both a completed and a cancelled drag — the only teardown needed. */
      onDragEnd: () => {
        setDraggingIndex(null)
        setOverIndex(null)
      },
      onDragOver: (event) => {
        if (draggingIndex === null) return
        event.stopPropagation()
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setOverIndex((previous) => (previous === index ? previous : index))
      },
      onDrop: (event) => {
        event.stopPropagation()
        event.preventDefault()
        const from = draggingIndex
        setDraggingIndex(null)
        setOverIndex(null)
        if (from === null || from === index) return
        onReorder(from, index)
      },
    }),
    [enabled, draggingIndex, onReorder]
  )

  return { draggingIndex, overIndex, itemProps }
}

/**
 * Moves `from` to `to`, returning a new array. The one definition of what a
 * reorder does, so the canvas and the inspector cannot disagree about where a
 * dropped field lands.
 */
export function reorderList<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
