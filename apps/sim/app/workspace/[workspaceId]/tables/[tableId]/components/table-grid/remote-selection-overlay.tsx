'use client'

import { useEffect, useRef, useState } from 'react'
import { getUserColor, withAlpha } from '@/lib/workspaces/colors'
import type { RemoteTableSelection } from '@/app/workspace/[workspaceId]/tables/[tableId]/hooks/use-table-room'

/** A measured remote selection, positioned in the grid content wrapper's space. */
interface SelectionBox {
  socketId: string
  userName: string
  color: string
  editing: boolean
  top: number
  left: number
  width: number
  height: number
}

interface RemoteSelectionOverlayProps {
  remoteSelections: RemoteTableSelection[]
  /** Column id → its rendered column index (matches the cells' `data-col`). */
  columnIndexById: Map<string, number>
  /** The grid's scroll container (`data-table-scroll`), queried for cell rects. */
  scrollElement: HTMLElement | null
}

/** The cell `<td>` for a (rowId, columnIndex), or undefined when virtualized off-window. */
function cellRect(
  scrollEl: HTMLElement,
  rowId: string,
  columnIndex: number | undefined
): DOMRect | undefined {
  if (columnIndex === undefined) return undefined
  const cell = scrollEl.querySelector(`[data-row-id="${rowId}"][data-col="${columnIndex}"]`)
  return cell?.getBoundingClientRect()
}

/**
 * Renders remote collaborators' cell selections over the table grid — a colored
 * border per user (Google-Sheets style), a darker fill while they are editing, and
 * their name on hover. Mounted inside the grid's `relative` content wrapper, so
 * content-space coordinates scroll with the grid automatically.
 *
 * Positions are measured from the live cell rects (the same `[data-row-id][data-col]`
 * idiom the reveal effect uses), keyed by stable ids so each client renders under its
 * own sort/scroll. A selection whose rows are virtualized off-window is simply not
 * drawn. The layer is `pointer-events-none` so it never intercepts cell clicks; the
 * name-on-hover is driven by hit-testing pointer moves against the measured boxes.
 */
export function RemoteSelectionOverlay({
  remoteSelections,
  columnIndexById,
  scrollElement,
}: RemoteSelectionOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [boxes, setBoxes] = useState<SelectionBox[]>([])
  const [hoveredSocketId, setHoveredSocketId] = useState<string | null>(null)
  const boxesRef = useRef<SelectionBox[]>([])
  boxesRef.current = boxes

  useEffect(() => {
    const scrollEl = scrollElement
    const root = rootRef.current
    if (!scrollEl || !root) return

    let raf = 0
    const measure = () => {
      raf = 0
      const origin = root.getBoundingClientRect()
      const next: SelectionBox[] = []
      for (const selection of remoteSelections) {
        const { anchor, focus, editing } = selection.cell
        const rects = [
          cellRect(scrollEl, anchor.rowId, columnIndexById.get(anchor.columnId)),
          cellRect(scrollEl, focus.rowId, columnIndexById.get(focus.columnId)),
        ].filter((rect): rect is DOMRect => rect !== undefined)
        if (rects.length === 0) continue

        const top = Math.min(...rects.map((r) => r.top)) - origin.top
        const left = Math.min(...rects.map((r) => r.left)) - origin.left
        const bottom = Math.max(...rects.map((r) => r.bottom)) - origin.top
        const right = Math.max(...rects.map((r) => r.right)) - origin.left
        next.push({
          socketId: selection.socketId,
          userName: selection.userName,
          color: getUserColor(selection.userId),
          editing: editing === true,
          top,
          left,
          width: right - left,
          height: bottom - top,
        })
      }
      setBoxes(next)
    }

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }

    measure()
    scrollEl.addEventListener('scroll', schedule, { passive: true })
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(scrollEl)

    return () => {
      scrollEl.removeEventListener('scroll', schedule)
      resizeObserver.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [remoteSelections, columnIndexById, scrollElement])

  // Name-on-hover without blocking cell clicks: hit-test pointer moves against the
  // measured boxes (the overlay stays pointer-events-none).
  useEffect(() => {
    const scrollEl = scrollElement
    const root = rootRef.current
    if (!scrollEl || !root) return

    const handleMove = (event: PointerEvent) => {
      const origin = root.getBoundingClientRect()
      const x = event.clientX - origin.left
      const y = event.clientY - origin.top
      const hit = boxesRef.current.find(
        (b) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height
      )
      setHoveredSocketId((prev) =>
        prev === (hit?.socketId ?? null) ? prev : (hit?.socketId ?? null)
      )
    }
    const handleLeave = () => setHoveredSocketId(null)

    scrollEl.addEventListener('pointermove', handleMove, { passive: true })
    scrollEl.addEventListener('pointerleave', handleLeave)
    return () => {
      scrollEl.removeEventListener('pointermove', handleMove)
      scrollEl.removeEventListener('pointerleave', handleLeave)
    }
  }, [scrollElement])

  return (
    <div ref={rootRef} className='pointer-events-none absolute inset-0 z-[8] overflow-hidden'>
      {boxes.map((box) => (
        <div
          key={box.socketId}
          className='absolute rounded-[2px]'
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            border: `2px solid ${box.color}`,
            backgroundColor: withAlpha(box.color, box.editing ? 0.22 : 0.08),
          }}
        >
          {hoveredSocketId === box.socketId && (
            <span
              className='-top-[1.4em] absolute left-[-2px] whitespace-nowrap rounded-[3px] rounded-bl-none px-[5px] py-[1px] font-medium text-[11px] text-white leading-[1.4]'
              style={{ backgroundColor: box.color }}
            >
              {box.userName}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
