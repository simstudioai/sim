'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getUserColor, withAlpha } from '@/lib/workspaces/colors'
import {
  isCellInSelection,
  type NormalizedSelection,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/utils'
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
  /** Viewport-space top/left of the selection, for the body-portaled name label. */
  viewportTop: number
  viewportLeft: number
  /** Resolved anchor/focus cell indices (undefined when off-window). Coverage by the local
   *  selection is derived from these in render (see {@link isSelectionCovered}) — no DOM
   *  re-measure when only the local caret moves. */
  anchorRow: number | undefined
  anchorCol: number | undefined
  focusRow: number | undefined
  focusCol: number | undefined
}

interface RemoteSelectionOverlayProps {
  remoteSelections: RemoteTableSelection[]
  /** Column id → its rendered column index (matches the cells' `data-col`). */
  columnIndexById: Map<string, number>
  /** Row id → its index in the current row list, to test local-selection coverage. */
  rowIndexById: Map<string, number>
  /** The local user's own normalized selection, so a co-selected remote cell defers to it. */
  localSelection: NormalizedSelection | null
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
  // `rowId` is a remote peer's value — escape it so a hostile id can't break the
  // selector and throw (`columnIndex` is a local numeric index, already safe).
  const cell = scrollEl.querySelector(
    `[data-row-id="${CSS.escape(rowId)}"][data-col="${columnIndex}"]`
  )
  return cell?.getBoundingClientRect()
}

/**
 * Whether a remote selection defers to the local one: true only when the local selection
 * fully contains it (both corners inside), so a partial overlap still shows.
 */
function isSelectionCovered(
  anchorRow: number | undefined,
  anchorCol: number | undefined,
  focusRow: number | undefined,
  focusCol: number | undefined,
  bounds: NormalizedSelection | null
): boolean {
  return (
    bounds !== null &&
    isCellInSelection(anchorRow, anchorCol, bounds) &&
    isCellInSelection(focusRow, focusCol, bounds)
  )
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
  rowIndexById,
  localSelection,
  scrollElement,
}: RemoteSelectionOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [boxes, setBoxes] = useState<SelectionBox[]>([])
  const [hoveredSocketId, setHoveredSocketId] = useState<string | null>(null)

  // Latest data read by the subscribe-once effect + the pointer hit-test, so neither
  // re-subscribes on every incoming selection delta.
  const boxesRef = useRef<SelectionBox[]>([])
  boxesRef.current = boxes
  const remoteSelectionsRef = useRef(remoteSelections)
  remoteSelectionsRef.current = remoteSelections
  const columnIndexByIdRef = useRef(columnIndexById)
  columnIndexByIdRef.current = columnIndexById
  const rowIndexByIdRef = useRef(rowIndexById)
  rowIndexByIdRef.current = rowIndexById
  // Cached content-wrapper origin, refreshed on each measure (scroll/resize/data change),
  // so the pointer hit-test never forces a layout read per mouse move.
  const originRef = useRef({ top: 0, left: 0 })

  const measure = useCallback(() => {
    const scrollEl = scrollElement
    const root = rootRef.current
    if (!scrollEl || !root) return
    const origin = root.getBoundingClientRect()
    originRef.current = { top: origin.top, left: origin.left }
    const next: SelectionBox[] = []
    for (const selection of remoteSelectionsRef.current) {
      const { anchor, focus, editing } = selection.cell
      const anchorCol = columnIndexByIdRef.current.get(anchor.columnId)
      const focusCol = columnIndexByIdRef.current.get(focus.columnId)
      const anchorRow = rowIndexByIdRef.current.get(anchor.rowId)
      const focusRow = rowIndexByIdRef.current.get(focus.rowId)
      const rects = [
        cellRect(scrollEl, anchor.rowId, anchorCol),
        cellRect(scrollEl, focus.rowId, focusCol),
      ].filter((rect): rect is DOMRect => rect !== undefined)
      if (rects.length === 0) continue

      const viewportTop = Math.min(...rects.map((r) => r.top))
      const viewportLeft = Math.min(...rects.map((r) => r.left))
      const top = viewportTop - origin.top
      const left = viewportLeft - origin.left
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
        viewportTop,
        viewportLeft,
        anchorRow,
        anchorCol,
        focusRow,
        focusCol,
      })
    }
    setBoxes(next)
  }, [scrollElement])

  // Subscribe once per scroll element: re-measure on scroll/resize, and hit-test pointer
  // moves against the cached boxes/origin — no layout read per move, stays pointer-events-none.
  useEffect(() => {
    const scrollEl = scrollElement
    if (!scrollEl) return

    let raf = 0
    const schedule = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          measure()
        })
    }
    const handleMove = (event: PointerEvent) => {
      const { top, left } = originRef.current
      const x = event.clientX - left
      const y = event.clientY - top
      const hit = boxesRef.current.find(
        (b) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height
      )
      setHoveredSocketId((prev) =>
        prev === (hit?.socketId ?? null) ? prev : (hit?.socketId ?? null)
      )
    }
    const handleLeave = () => setHoveredSocketId(null)

    // No measure() here — the re-measure layout effect below runs on mount and whenever
    // `measure` changes (it depends on `scrollElement`), so it already covers the initial
    // and scroll-element-changed measures without a redundant pass.
    scrollEl.addEventListener('scroll', schedule, { passive: true })
    scrollEl.addEventListener('pointermove', handleMove, { passive: true })
    scrollEl.addEventListener('pointerleave', handleLeave)
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(scrollEl)
    // Also observe the content layer (this overlay fills it): a column resize or a
    // row-count change grows/shrinks the content without resizing the scroll container,
    // yet moves cell rects — so measure off the content, not just the viewport.
    if (rootRef.current) resizeObserver.observe(rootRef.current)
    // Re-measure when rows are added/removed/reordered/virtualized (a live refetch moves
    // cells without a scroll/resize) — childList only, so a cell-content edit doesn't fire.
    const tbody = scrollEl.querySelector('tbody')
    const rowObserver = new MutationObserver(schedule)
    if (tbody) rowObserver.observe(tbody, { childList: true })

    return () => {
      scrollEl.removeEventListener('scroll', schedule)
      scrollEl.removeEventListener('pointermove', handleMove)
      scrollEl.removeEventListener('pointerleave', handleLeave)
      resizeObserver.disconnect()
      rowObserver.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollElement, measure])

  // Re-measure when the remote selections or column layout change (listeners stay
  // subscribed). Layout effect so positions update before paint — no one-frame lag as a
  // peer moves. NOT keyed on `localSelection`: moving the local caret changes only which
  // boxes are `covered`, which the cheap in-memory pass below handles without a reflow.
  useLayoutEffect(() => {
    measure()
  }, [remoteSelections, columnIndexById, measure])

  const hoveredBox = hoveredSocketId
    ? boxes.find((box) => box.socketId === hoveredSocketId)
    : undefined

  return (
    <>
      <div ref={rootRef} className='pointer-events-none absolute inset-0 z-[8] overflow-hidden'>
        {boxes.map((box) =>
          // A cell the local user also has selected shows only the local selection — the
          // remote box isn't drawn (its `boxes` entry still drives the hover name). The
          // border is an inset box-shadow (no layout width, so it never stacks with an
          // adjacent cell's border) plus a subtle fill, darker while the peer is editing.
          isSelectionCovered(
            box.anchorRow,
            box.anchorCol,
            box.focusRow,
            box.focusCol,
            localSelection
          ) ? null : (
            <div
              key={box.socketId}
              className='absolute rounded-xs'
              style={{
                top: box.top,
                left: box.left,
                width: box.width,
                height: box.height,
                boxShadow: `inset 0 0 0 2px ${box.color}`,
                backgroundColor: withAlpha(box.color, box.editing ? 0.22 : 0.08),
              }}
            />
          )
        )}
      </div>
      {/* The name label portals to the body so it floats on top of the grid (and its
          sticky header) instead of being clipped by the overlay's overflow-hidden; it's
          placed in viewport space, its bottom-left tabbed onto the selection's top-left. */}
      {hoveredBox &&
        createPortal(
          // Same chrome as the workflow-canvas presence label (see cursors.tsx): the
          // identity color is the only per-user value; text color, font, radius, and
          // padding all reuse the canvas tokens so tables + canvas presence look identical.
          // `rounded-bl-none` tabs the label's bottom-left corner onto the selection's
          // top-left, the one deviation from the free-floating canvas cursor tag.
          <div
            className='pointer-events-none fixed z-[60] max-w-[160px] truncate whitespace-nowrap rounded-xs rounded-bl-none px-1.5 py-0.5 font-medium text-[var(--surface-1)] text-xs'
            style={{
              top: hoveredBox.viewportTop,
              left: hoveredBox.viewportLeft,
              backgroundColor: hoveredBox.color,
              transform: 'translateY(calc(-100% - 2px))',
            }}
          >
            {hoveredBox.userName}
          </div>,
          document.body
        )}
    </>
  )
}
