/**
 * Grid arithmetic for interface layouts — the single home for every rule about
 * where a module sits and what that means.
 *
 * Everything here is pure, synchronous, and never mutates its input. The
 * schema validates with it, the service mutates with it, the canvas renders
 * from it, and the copilot tool reports with it, so an occupancy or bounds
 * rule cannot be stated twice and drift. In particular
 * {@link moveModuleToCell} is the *one* definition of what a move does; the
 * editor applies it optimistically and the service applies it under the row
 * lock, from the same function, so the optimistic layout is byte-identical to
 * what gets persisted.
 *
 * Nothing here is written against a fixed grid size, and every function treats
 * a module as a rectangle rather than a point. A layout carries its own
 * {@link InterfaceGrid}, so widening the page, narrowing it to one full-bleed
 * pane, or letting modules span tracks needs no change in this file.
 *
 * Database-free by construction (types only), so it is safe on both sides of
 * the client boundary — see the module note in `constants.ts`.
 */

import type {
  InterfaceCell,
  InterfaceGrid,
  InterfaceLayout,
  InterfaceModule,
  InterfacePlacement,
} from '@/lib/interfaces/types'

/** Stable `${row},${col}` key for a cell — React keys and drag-target identity. */
export function cellKey(cell: InterfaceCell): string {
  return `${cell.row},${cell.col}`
}

/** The exclusive end row of `placement` — the first row *below* it. */
function rowEnd(placement: InterfacePlacement): number {
  return placement.row + placement.rowSpan
}

/** The exclusive end column of `placement` — the first column *right* of it. */
function colEnd(placement: InterfacePlacement): number {
  return placement.col + placement.colSpan
}

/** Whether `placement` covers `cell`. A `1x1` placement covers only its own cell. */
export function placementCovers(placement: InterfacePlacement, cell: InterfaceCell): boolean {
  return (
    cell.row >= placement.row &&
    cell.row < rowEnd(placement) &&
    cell.col >= placement.col &&
    cell.col < colEnd(placement)
  )
}

/** Whether two placements share at least one cell (standard rectangle intersection). */
export function placementsOverlap(a: InterfacePlacement, b: InterfacePlacement): boolean {
  return a.row < rowEnd(b) && b.row < rowEnd(a) && a.col < colEnd(b) && b.col < colEnd(a)
}

/** Whether two placements describe the same rectangle. */
export function placementsEqual(a: InterfacePlacement, b: InterfacePlacement): boolean {
  return a.row === b.row && a.col === b.col && a.rowSpan === b.rowSpan && a.colSpan === b.colSpan
}

/**
 * Whether `placement` lies wholly inside `grid`. Spans below 1 are rejected
 * here rather than assumed away, so a hand-written payload cannot smuggle in a
 * zero-area or inverted rectangle that would then overlap nothing.
 */
export function placementFitsGrid(placement: InterfacePlacement, grid: InterfaceGrid): boolean {
  return (
    placement.rowSpan >= 1 &&
    placement.colSpan >= 1 &&
    placement.row >= 0 &&
    placement.col >= 0 &&
    rowEnd(placement) <= grid.rows &&
    colEnd(placement) <= grid.cols
  )
}

/** Every cell of `grid` in reading order: (0,0) (0,1) … (1,0) … */
export function gridCells(grid: InterfaceGrid): InterfaceCell[] {
  const cells: InterfaceCell[] = []
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      cells.push({ row, col })
    }
  }
  return cells
}

/** The module covering `cell`, or `null` when no module does. */
export function moduleAt(layout: InterfaceLayout, cell: InterfaceCell): InterfaceModule | null {
  return layout.modules.find((module) => placementCovers(module.placement, cell)) ?? null
}

/**
 * Every module whose placement intersects `placement`, in layout order.
 *
 * @param exceptModuleId the module being moved or replaced, which must not
 * count as blocking its own target area.
 */
export function overlappingModules(
  layout: InterfaceLayout,
  placement: InterfacePlacement,
  exceptModuleId?: string
): InterfaceModule[] {
  return layout.modules.filter(
    (module) => module.id !== exceptModuleId && placementsOverlap(module.placement, placement)
  )
}

/** Cells of the layout's own grid that no module covers, in reading order. */
export function freeCells(layout: InterfaceLayout): InterfaceCell[] {
  const covered = new Set<string>()
  for (const module of layout.modules) {
    const { placement } = module
    for (let row = placement.row; row < rowEnd(placement); row++) {
      for (let col = placement.col; col < colEnd(placement); col++) {
        covered.add(cellKey({ row, col }))
      }
    }
  }
  return gridCells(layout.grid).filter((cell) => !covered.has(cellKey(cell)))
}

/**
 * Outcome of {@link moveModuleToCell}.
 *
 * `unchanged` folds together "no such module" and "already there" because both
 * mean the caller should skip the write; the failure cases are distinct so the
 * service can raise a message that names the actual problem.
 */
export type MoveModuleOutcome =
  | { status: 'moved'; layout: InterfaceLayout }
  | { status: 'unchanged' }
  | { status: 'out-of-bounds'; placement: InterfacePlacement }
  | { status: 'blocked'; blockedBy: InterfaceModule[] }

/**
 * Moves `moduleId` so its top-left corner lands on `cell`, keeping its span.
 *
 * When the target area is free the module simply moves. When it is filled by
 * exactly one module occupying precisely that rectangle, the two swap — which
 * is what a drag onto an occupied cell means, and which is only well-defined
 * when both modules are the same size, since the displaced module has to fit
 * in the area the mover vacated. Any other collision is reported rather than
 * resolved: with modules of differing spans there is no single sensible answer,
 * and silently picking one would corrupt the layout.
 *
 * Returns a new layout and never mutates the input. Module array order is
 * preserved so the editor's optimistic layout matches the server's byte for
 * byte.
 */
export function moveModuleToCell(
  layout: InterfaceLayout,
  moduleId: string,
  cell: InterfaceCell
): MoveModuleOutcome {
  const mover = layout.modules.find((module) => module.id === moduleId)
  if (!mover) return { status: 'unchanged' }

  const from = mover.placement
  if (from.row === cell.row && from.col === cell.col) return { status: 'unchanged' }

  const to: InterfacePlacement = {
    row: cell.row,
    col: cell.col,
    rowSpan: from.rowSpan,
    colSpan: from.colSpan,
  }
  if (!placementFitsGrid(to, layout.grid)) return { status: 'out-of-bounds', placement: to }

  const blocking = overlappingModules(layout, to, moduleId)

  if (blocking.length === 0) {
    return {
      status: 'moved',
      layout: {
        ...layout,
        modules: layout.modules.map((module) =>
          module.id === moduleId ? { ...module, placement: to } : module
        ),
      },
    }
  }

  /**
   * A swap is only sound when one module occupies exactly the target
   * rectangle: it is then the same size as the mover, so `from` — an area the
   * mover is vacating, already in bounds and by the layout invariant not
   * overlapped by anything else — is guaranteed to hold it.
   */
  const [displaced] = blocking
  if (blocking.length > 1 || !placementsEqual(displaced.placement, to)) {
    return { status: 'blocked', blockedBy: blocking }
  }

  return {
    status: 'moved',
    layout: {
      ...layout,
      modules: layout.modules.map((module) => {
        if (module.id === moduleId) return { ...module, placement: to }
        if (module.id === displaced.id) return { ...module, placement: from }
        return module
      }),
    },
  }
}

/** One module and where it lands on the collapsed grid. */
export interface CollapsedModule {
  module: InterfaceModule
  placement: InterfacePlacement
}

/** The authored layout reduced to the tightest grid that still renders it. */
export interface CollapsedLayout {
  grid: InterfaceGrid
  /** In reading order, independent of `layout.modules` order. */
  modules: CollapsedModule[]
}

/** Track indices of `grid` that at least one module covers, ascending. */
function occupiedTracks(
  modules: readonly InterfaceModule[],
  total: number,
  covers: (placement: InterfacePlacement, track: number) => boolean
): number[] {
  const tracks: number[] = []
  for (let track = 0; track < total; track++) {
    if (modules.some((module) => covers(module.placement, track))) tracks.push(track)
  }
  return tracks
}

const coversRow = (placement: InterfacePlacement, row: number) =>
  row >= placement.row && row < rowEnd(placement)

const coversCol = (placement: InterfacePlacement, col: number) =>
  col >= placement.col && col < colEnd(placement)

/**
 * Collapses an authored layout into the tightest one that preserves reading
 * order, so a page never renders dead space:
 *
 * 1. Rows and columns no module covers are dropped, and each module's track
 *    index becomes its position among the *occupied* tracks. A span shrinks to
 *    the number of occupied tracks it still covers.
 * 2. A module that shares none of its rows with another module stretches across
 *    the full collapsed width, since nothing would ever sit beside it.
 *
 * So a lone module fills the page, a filled top row becomes two full-height
 * panes, and a diagonal pair stacks as two full-width rows.
 *
 * An empty layout collapses to a 1x1 grid with no modules — a valid, if
 * unpopulated, thing to render.
 */
export function collapseLayout(layout: InterfaceLayout): CollapsedLayout {
  const ordered = [...layout.modules].sort(
    (a, b) => a.placement.row - b.placement.row || a.placement.col - b.placement.col
  )

  const rows = occupiedTracks(ordered, layout.grid.rows, coversRow)
  const cols = occupiedTracks(ordered, layout.grid.cols, coversCol)
  const grid: InterfaceGrid = { rows: Math.max(rows.length, 1), cols: Math.max(cols.length, 1) }

  const rowIndex = new Map(rows.map((row, index) => [row, index]))
  const colIndex = new Map(cols.map((col, index) => [col, index]))

  const modules = ordered.map((module) => {
    const source = module.placement
    const spansRow = (row: number) => coversRow(source, row)
    const isAloneInBand = !ordered.some(
      (other) =>
        other.id !== module.id &&
        rows.some((row) => spansRow(row) && coversRow(other.placement, row))
    )

    const row = rowIndex.get(source.row) ?? 0
    const rowSpan = rows.filter(spansRow).length || 1
    const col = isAloneInBand ? 0 : (colIndex.get(source.col) ?? 0)
    const colSpan = isAloneInBand ? grid.cols : cols.filter((c) => coversCol(source, c)).length || 1

    return { module, placement: { row, col, rowSpan, colSpan } }
  })

  return { grid, modules }
}
