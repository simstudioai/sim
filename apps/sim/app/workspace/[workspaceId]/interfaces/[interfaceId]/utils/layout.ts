/**
 * Pure grid math for the 2x2 interface canvas.
 *
 * Every function here is synchronous, side-effect free, and never mutates its
 * input — the canvas renders from these, and `use-interface-layout` builds the
 * next persisted layout from them. Unit-tested in `layout.test.ts`.
 *
 * Not to be confused with `apps/sim/app/(interfaces)/`, the pre-existing route
 * group for the public deployed-chat surface — unrelated to this feature.
 */

import type { InterfaceCell, InterfaceLayout, InterfaceModule } from '@/lib/interfaces'

const GRID_ROWS = [0, 1] as const
const GRID_COLS = [0, 1] as const

/** Every cell of the 2x2 grid in reading order: (0,0) (0,1) (1,0) (1,1). */
export const INTERFACE_GRID_CELLS: readonly InterfaceCell[] = GRID_ROWS.flatMap((row) =>
  GRID_COLS.map((col) => ({ row, col }))
)

/** Stable `${row},${col}` key — matches the contract's duplicate-cell check. */
export function cellKey(cell: InterfaceCell): string {
  return `${cell.row},${cell.col}`
}

/** The module occupying `cell`, or `null` when the cell is empty. */
export function findModuleAt(layout: InterfaceLayout, cell: InterfaceCell): InterfaceModule | null {
  return (
    layout.modules.find((module) => module.cell.row === cell.row && module.cell.col === cell.col) ??
    null
  )
}

export interface PreviewPlacement {
  /** The placed module itself, so the canvas never re-scans `layout.modules`. */
  module: InterfaceModule
  /** CSS `grid-row` value, e.g. '1' or '1 / -1'. */
  gridRow: string
  /** CSS `grid-column` value. */
  gridColumn: string
}

export interface PreviewLayout {
  /** Number of grid tracks after empty ones are dropped. */
  rows: 1 | 2
  cols: 1 | 2
  placements: PreviewPlacement[]
}

/**
 * Collapses the authored 2x2 grid into the tightest layout that still preserves
 * reading order, so preview mode never shows dead space:
 *
 * 1. Empty rows and columns are dropped; a module's track index becomes its
 *    position among the *occupied* tracks.
 * 2. A row holding a single module spans both columns when the collapsed grid
 *    is still two columns wide.
 *
 * So a lone module fills the page, a filled top row becomes two full-height
 * panes, and a diagonal pair stacks as two full-width rows.
 */
export function computePreviewLayout(layout: InterfaceLayout): PreviewLayout {
  const ordered = [...layout.modules].sort(
    (a, b) => a.cell.row - b.cell.row || a.cell.col - b.cell.col
  )

  const occupiedRows = [...new Set(ordered.map((module) => module.cell.row))].sort((a, b) => a - b)
  const occupiedCols = [...new Set(ordered.map((module) => module.cell.col))].sort((a, b) => a - b)

  const rows = occupiedRows.length === 2 ? 2 : 1
  const cols = occupiedCols.length === 2 ? 2 : 1

  const modulesInRow = new Map<number, number>()
  for (const module of ordered) {
    modulesInRow.set(module.cell.row, (modulesInRow.get(module.cell.row) ?? 0) + 1)
  }

  const placements = ordered.map((module) => {
    const collapsedRow = occupiedRows.indexOf(module.cell.row)
    const collapsedCol = occupiedCols.indexOf(module.cell.col)
    const isRowSingleton = modulesInRow.get(module.cell.row) === 1
    return {
      module,
      gridRow: String(collapsedRow + 1),
      gridColumn: isRowSingleton && cols === 2 ? '1 / -1' : String(collapsedCol + 1),
    }
  })

  return { rows, cols, placements }
}

/**
 * Client mirror of `moveModule` in `@/lib/interfaces` — moves `moduleId` to
 * `cell`; any module already at `cell` takes the mover's old cell (swap).
 * Returns a NEW layout; never mutates. Module order is preserved so the
 * optimistic layout is byte-identical to what the server would produce.
 *
 * Returns the input unchanged when the move is a no-op (unknown module, or the
 * module is already at `cell`), letting callers skip the write.
 */
export function swapModuleCells(
  layout: InterfaceLayout,
  moduleId: string,
  cell: InterfaceCell
): InterfaceLayout {
  const target = layout.modules.find((module) => module.id === moduleId)
  if (!target) return layout
  if (target.cell.row === cell.row && target.cell.col === cell.col) return layout

  return {
    ...layout,
    modules: layout.modules.map((module) => {
      if (module.id === moduleId) {
        return { ...module, cell }
      }
      if (module.cell.row === cell.row && module.cell.col === cell.col) {
        return { ...module, cell: target.cell }
      }
      return module
    }),
  }
}
