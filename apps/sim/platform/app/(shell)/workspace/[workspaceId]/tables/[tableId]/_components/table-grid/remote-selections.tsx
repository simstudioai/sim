'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { inlineStyles } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/inline-style'
import { presenceColor } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/presence-color'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/table-grid.module.css'
import {
  isCellInSelection,
  type NormalizedSelection,
  type RemoteTableSelection,
} from '@/platform/lib/data/tables'

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
  /** Every cell is pinned, so the box renders above the frozen left zone rather than behind it. */
  pinned: boolean
  /** Viewport position for the name label; `left` is clamped to clear the frozen zone. */
  viewportTop: number
  viewportLeft: number
  anchorRow: number | undefined
  anchorCol: number | undefined
  focusRow: number | undefined
  focusCol: number | undefined
}

interface RemoteSelectionsProps {
  remoteSelections: RemoteTableSelection[]
  /** Column id → its rendered column index (matches the cells' `data-col`). */
  columnIndexById: Map<string, number>
  /** Row id → its index in the current row list, to test local-selection coverage. */
  rowIndexById: Map<string, number>
  /** The local selection, so a co-selected remote cell defers to it. */
  localSelection: NormalizedSelection | null
  /** Width of the frozen left zone (row gutter and pinned columns). */
  stickyLeftWidth: number
  /** The grid's scroll container, queried for cell rects. */
  scrollElement: HTMLElement | null
}

/** Whether a selection endpoint lands in the frozen zone; an off-window row reads any rendered cell of its column. */
function endpointIsPinned(
  scrollEl: HTMLElement,
  cell: HTMLElement | null,
  columnIndex: number | undefined
): boolean {
  if (cell !== null) return cell.hasAttribute('data-pinned')
  if (columnIndex === undefined) return false
  return scrollEl.querySelector(`[data-col="${columnIndex}"][data-pinned]`) !== null
}

/** The cell for a (rowId, columnIndex), or null when virtualized off-window. */
function cellElement(
  scrollEl: HTMLElement,
  rowId: string,
  columnIndex: number | undefined
): HTMLElement | null {
  if (columnIndex === undefined) return null
  // A peer's row id is escaped so a hostile id can't break the selector.
  return scrollEl.querySelector<HTMLElement>(
    `[data-row-id="${CSS.escape(rowId)}"][data-col="${columnIndex}"]`
  )
}

/** A remote selection defers only when the local selection contains both of its corners. */
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

/** One peer's rectangle: an inset border in their color and a fill, darker while they edit. */
function SelectionRect({ box }: { box: SelectionBox }) {
  return (
    <div
      className={styles.remoteBox}
      ref={inlineStyles({
        top: `${box.top}px`,
        left: `${box.left}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        'box-shadow': `inset 0 0 0 2px ${box.color}`,
        'background-color': `color-mix(in srgb, ${box.color} ${box.editing ? 22 : 8}%, transparent)`,
      })}
    />
  )
}

/**
 * Collaborators' cell selections over the grid: a colored border per person, a darker fill while
 * they edit, and their name on hover. Positions are measured from live cell rects keyed by stable
 * ids, so each client draws them under its own sort and scroll; a selection whose rows are
 * virtualized away is not drawn. The layer never takes pointer events; hovering hit-tests the
 * measured boxes instead.
 */
export function RemoteSelections({
  remoteSelections,
  columnIndexById,
  rowIndexById,
  localSelection,
  stickyLeftWidth,
  scrollElement,
}: RemoteSelectionsProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [boxes, setBoxes] = useState<SelectionBox[]>([])
  const [hoveredSocketId, setHoveredSocketId] = useState<string | null>(null)

  const boxesRef = useRef<SelectionBox[]>([])
  boxesRef.current = boxes
  const remoteSelectionsRef = useRef(remoteSelections)
  remoteSelectionsRef.current = remoteSelections
  const columnIndexByIdRef = useRef(columnIndexById)
  columnIndexByIdRef.current = columnIndexById
  const rowIndexByIdRef = useRef(rowIndexById)
  rowIndexByIdRef.current = rowIndexById
  const localSelectionRef = useRef(localSelection)
  localSelectionRef.current = localSelection
  const stickyLeftWidthRef = useRef(stickyLeftWidth)
  stickyLeftWidthRef.current = stickyLeftWidth
  const originRef = useRef({ top: 0, left: 0 })
  /** Content-space x of the frozen zone's right edge, refreshed on every scroll for the hit-test. */
  const frozenEdgeXRef = useRef(0)

  const measure = useCallback(() => {
    const scrollEl = scrollElement
    const root = rootRef.current
    if (!scrollEl || !root) return
    frozenEdgeXRef.current = scrollEl.scrollLeft + stickyLeftWidthRef.current
    const origin = root.getBoundingClientRect()
    originRef.current = { top: origin.top, left: origin.left }
    const stickyViewportX = origin.left + frozenEdgeXRef.current
    const next: SelectionBox[] = []
    for (const selection of remoteSelectionsRef.current) {
      const { anchor, focus, editing } = selection.cell
      const anchorCol = columnIndexByIdRef.current.get(anchor.columnId)
      const focusCol = columnIndexByIdRef.current.get(focus.columnId)
      const anchorRow = rowIndexByIdRef.current.get(anchor.rowId)
      const focusRow = rowIndexByIdRef.current.get(focus.rowId)
      const anchorCell = cellElement(scrollEl, anchor.rowId, anchorCol)
      const focusCell = cellElement(scrollEl, focus.rowId, focusCol)
      const cells = [anchorCell, focusCell].filter((cell): cell is HTMLElement => cell !== null)
      if (cells.length === 0) continue
      const rects = cells.map((cell) => cell.getBoundingClientRect())
      // Only a selection pinned at both ends renders above the frozen zone.
      const pinned =
        endpointIsPinned(scrollEl, anchorCell, anchorCol) &&
        endpointIsPinned(scrollEl, focusCell, focusCol)
      const viewportTop = Math.min(...rects.map((r) => r.top))
      const viewportLeft = Math.min(...rects.map((r) => r.left))
      const top = viewportTop - origin.top
      const left = viewportLeft - origin.left
      const bottom = Math.max(...rects.map((r) => r.bottom)) - origin.top
      const right = Math.max(...rects.map((r) => r.right)) - origin.left
      next.push({
        socketId: selection.socketId,
        userName: selection.userName,
        color: presenceColor(selection.userId),
        editing: editing === true,
        top,
        left,
        width: right - left,
        height: bottom - top,
        pinned,
        viewportTop,
        viewportLeft: pinned ? viewportLeft : Math.max(viewportLeft, stickyViewportX),
        anchorRow,
        anchorCol,
        focusRow,
        focusCol,
      })
    }
    setBoxes(next)
  }, [scrollElement])

  useEffect(() => {
    const scrollEl = scrollElement
    if (!scrollEl) return
    let raf = 0
    const schedule = () => {
      frozenEdgeXRef.current = scrollEl.scrollLeft + stickyLeftWidthRef.current
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
        (b) =>
          (b.pinned || x >= frozenEdgeXRef.current) &&
          x >= b.left &&
          x <= b.left + b.width &&
          y >= b.top &&
          y <= b.top + b.height &&
          !isSelectionCovered(
            b.anchorRow,
            b.anchorCol,
            b.focusRow,
            b.focusCol,
            localSelectionRef.current
          )
      )
      setHoveredSocketId((prev) =>
        prev === (hit?.socketId ?? null) ? prev : (hit?.socketId ?? null)
      )
    }
    const handleLeave = () => setHoveredSocketId(null)
    scrollEl.addEventListener('scroll', schedule, { passive: true })
    scrollEl.addEventListener('pointermove', handleMove, { passive: true })
    scrollEl.addEventListener('pointerleave', handleLeave)
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(scrollEl)
    if (rootRef.current) resizeObserver.observe(rootRef.current)
    // Rows added, removed, reordered or virtualized move cells without a scroll or resize.
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

  useLayoutEffect(() => {
    measure()
  }, [remoteSelections, columnIndexById, stickyLeftWidth, measure])

  const scrollingBoxes: SelectionBox[] = []
  const frozenBoxes: SelectionBox[] = []
  let hoveredBox: SelectionBox | undefined
  for (const box of boxes) {
    if (
      isSelectionCovered(box.anchorRow, box.anchorCol, box.focusRow, box.focusCol, localSelection)
    ) {
      continue
    }
    ;(box.pinned ? frozenBoxes : scrollingBoxes).push(box)
    if (box.socketId === hoveredSocketId) hoveredBox = box
  }
  const labelHost = scrollElement?.closest<HTMLElement>('[data-emcn]') ?? null

  return (
    <>
      <div ref={rootRef} className={styles.remoteLayer}>
        {/* Ordinary selections sit below the frozen zone, so one scrolled behind the gutter hides
            by paint order; pinned ones sit above it or the pinned cell's background hides them. */}
        <div className={styles.remoteScrolling}>
          {scrollingBoxes.map((box) => (
            <SelectionRect key={box.socketId} box={box} />
          ))}
        </div>
        <div className={styles.remoteFrozen}>
          {frozenBoxes.map((box) => (
            <SelectionRect key={box.socketId} box={box} />
          ))}
        </div>
      </div>
      {hoveredBox &&
        labelHost &&
        createPortal(
          <div
            className={styles.remoteName}
            data-type='T050'
            ref={inlineStyles({
              top: `${hoveredBox.viewportTop}px`,
              left: `${hoveredBox.viewportLeft}px`,
              'background-color': hoveredBox.color,
            })}
          >
            {hoveredBox.userName}
          </div>,
          labelHost
        )}
    </>
  )
}
