/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  cellKey,
  collapseLayout,
  freeCells,
  gridCells,
  moduleAt,
  moveModuleToCell,
  overlappingModules,
  placementCovers,
  placementFitsGrid,
  placementsEqual,
  placementsOverlap,
} from '@/lib/interfaces/geometry'
import type {
  InterfaceCell,
  InterfaceGrid,
  InterfaceLayout,
  InterfaceModule,
  InterfacePlacement,
} from '@/lib/interfaces/types'

const GRID_2X2: InterfaceGrid = { rows: 2, cols: 2 }

function placement(row: number, col: number, rowSpan = 1, colSpan = 1): InterfacePlacement {
  return { row, col, rowSpan, colSpan }
}

function moduleAtPlacement(id: string, place: InterfacePlacement): InterfaceModule {
  return {
    id,
    type: 'chat',
    placement: place,
    config: { workflowId: null, outputConfigs: [], showThinking: false, welcomeMessage: '' },
  }
}

/** A 1x1 module at (row, col) — the only shape the authoring UI mints today. */
function mod(id: string, row: number, col: number): InterfaceModule {
  return moduleAtPlacement(id, placement(row, col))
}

function layoutOf(...modules: InterfaceModule[]): InterfaceLayout {
  return { version: 1, grid: GRID_2X2, modules }
}

function layoutIn(grid: InterfaceGrid, ...modules: InterfaceModule[]): InterfaceLayout {
  return { version: 1, grid, modules }
}

/** `${moduleId}@${row},${col}+${rowSpan}x${colSpan}` — compact assertion shape. */
function describeCollapsed(layout: InterfaceLayout): string[] {
  return collapseLayout(layout).modules.map(
    ({ module, placement: p }) => `${module.id}@${p.row},${p.col}+${p.rowSpan}x${p.colSpan}`
  )
}

describe('cellKey', () => {
  it('serializes as `row,col`', () => {
    expect(cellKey({ row: 0, col: 0 })).toBe('0,0')
    expect(cellKey({ row: 1, col: 0 })).toBe('1,0')
    expect(cellKey({ row: 0, col: 1 })).toBe('0,1')
  })
})

describe('gridCells', () => {
  it('lists a 2x2 grid in reading order', () => {
    expect(gridCells(GRID_2X2)).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ])
  })

  it('enumerates a non-square grid', () => {
    expect(gridCells({ rows: 1, cols: 3 })).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
    ])
  })
})

describe('placementCovers', () => {
  it('covers only its own cell when 1x1', () => {
    const p = placement(1, 1)
    expect(placementCovers(p, { row: 1, col: 1 })).toBe(true)
    expect(placementCovers(p, { row: 0, col: 1 })).toBe(false)
    expect(placementCovers(p, { row: 1, col: 0 })).toBe(false)
  })

  it('covers every cell of a span', () => {
    const p = placement(0, 0, 2, 2)
    for (const cell of gridCells(GRID_2X2)) {
      expect(placementCovers(p, cell)).toBe(true)
    }
  })

  it('excludes the cell just past its end', () => {
    const p = placement(0, 0, 1, 2)
    expect(placementCovers(p, { row: 0, col: 1 })).toBe(true)
    expect(placementCovers(p, { row: 0, col: 2 })).toBe(false)
    expect(placementCovers(p, { row: 1, col: 0 })).toBe(false)
  })
})

describe('placementsOverlap', () => {
  it('is false for disjoint cells', () => {
    expect(placementsOverlap(placement(0, 0), placement(1, 1))).toBe(false)
    expect(placementsOverlap(placement(0, 0), placement(0, 1))).toBe(false)
  })

  it('is true for the same cell', () => {
    expect(placementsOverlap(placement(0, 1), placement(0, 1))).toBe(true)
  })

  it('detects a span swallowing a cell', () => {
    expect(placementsOverlap(placement(0, 0, 2, 2), placement(1, 1))).toBe(true)
  })

  it('is false for spans that merely touch', () => {
    expect(placementsOverlap(placement(0, 0, 1, 2), placement(1, 0, 1, 2))).toBe(false)
  })

  it('is symmetric', () => {
    const a = placement(0, 0, 2, 1)
    const b = placement(1, 0, 1, 2)
    expect(placementsOverlap(a, b)).toBe(placementsOverlap(b, a))
  })
})

describe('placementsEqual', () => {
  it('compares all four fields', () => {
    expect(placementsEqual(placement(0, 1), placement(0, 1))).toBe(true)
    expect(placementsEqual(placement(0, 1), placement(0, 1, 2, 1))).toBe(false)
    expect(placementsEqual(placement(0, 1), placement(1, 0))).toBe(false)
  })
})

describe('placementFitsGrid', () => {
  it('accepts a placement inside the grid', () => {
    expect(placementFitsGrid(placement(1, 1), GRID_2X2)).toBe(true)
    expect(placementFitsGrid(placement(0, 0, 2, 2), GRID_2X2)).toBe(true)
  })

  it('rejects a placement past the last track', () => {
    expect(placementFitsGrid(placement(2, 0), GRID_2X2)).toBe(false)
    expect(placementFitsGrid(placement(0, 2), GRID_2X2)).toBe(false)
  })

  it('rejects a span that runs off the grid', () => {
    expect(placementFitsGrid(placement(1, 0, 2, 1), GRID_2X2)).toBe(false)
    expect(placementFitsGrid(placement(0, 1, 1, 2), GRID_2X2)).toBe(false)
  })

  it('rejects negative coordinates and non-positive spans', () => {
    expect(placementFitsGrid(placement(-1, 0), GRID_2X2)).toBe(false)
    expect(placementFitsGrid(placement(0, -1), GRID_2X2)).toBe(false)
    expect(placementFitsGrid(placement(0, 0, 0, 1), GRID_2X2)).toBe(false)
    expect(placementFitsGrid(placement(0, 0, 1, 0), GRID_2X2)).toBe(false)
  })

  it('accepts coordinates a larger grid makes legal', () => {
    expect(placementFitsGrid(placement(2, 3), { rows: 4, cols: 4 })).toBe(true)
  })
})

describe('moduleAt', () => {
  const layout = layoutOf(mod('a', 0, 1), mod('b', 1, 0))

  it('returns the module occupying the cell', () => {
    expect(moduleAt(layout, { row: 0, col: 1 })?.id).toBe('a')
    expect(moduleAt(layout, { row: 1, col: 0 })?.id).toBe('b')
  })

  it('returns null for an empty cell', () => {
    expect(moduleAt(layout, { row: 0, col: 0 })).toBeNull()
    expect(moduleAt(layout, { row: 1, col: 1 })).toBeNull()
  })

  it('returns a spanning module from any cell it covers', () => {
    const spanning = layoutOf(moduleAtPlacement('wide', placement(0, 0, 1, 2)))
    expect(moduleAt(spanning, { row: 0, col: 0 })?.id).toBe('wide')
    expect(moduleAt(spanning, { row: 0, col: 1 })?.id).toBe('wide')
    expect(moduleAt(spanning, { row: 1, col: 0 })).toBeNull()
  })
})

describe('overlappingModules', () => {
  const layout = layoutOf(mod('a', 0, 0), mod('b', 1, 1))

  it('returns modules whose area intersects', () => {
    expect(overlappingModules(layout, placement(0, 0)).map((m) => m.id)).toEqual(['a'])
    expect(overlappingModules(layout, placement(0, 0, 2, 2)).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('returns nothing for free space', () => {
    expect(overlappingModules(layout, placement(0, 1))).toEqual([])
  })

  it('excludes the module being moved', () => {
    expect(overlappingModules(layout, placement(0, 0), 'a')).toEqual([])
  })
})

describe('freeCells', () => {
  it('returns every cell of an empty layout', () => {
    expect(freeCells(layoutOf())).toHaveLength(4)
  })

  it('omits occupied cells, in reading order', () => {
    expect(freeCells(layoutOf(mod('a', 0, 1)))).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ])
  })

  it('omits every cell a spanning module covers', () => {
    const layout = layoutOf(moduleAtPlacement('wide', placement(0, 0, 1, 2)))
    expect(freeCells(layout)).toEqual([
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ])
  })

  it('returns nothing when one module fills the grid', () => {
    expect(freeCells(layoutOf(moduleAtPlacement('all', placement(0, 0, 2, 2))))).toEqual([])
  })

  it('follows the layout grid rather than a fixed size', () => {
    expect(freeCells(layoutIn({ rows: 1, cols: 3 }, mod('a', 0, 1)))).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 2 },
    ])
  })
})

describe('moveModuleToCell', () => {
  function placements(layout: InterfaceLayout): [string, InterfacePlacement][] {
    return layout.modules.map((module) => [module.id, module.placement])
  }

  it('moves a module into free space', () => {
    const layout = layoutOf(mod('a', 0, 0), mod('b', 0, 1))
    const outcome = moveModuleToCell(layout, 'a', { row: 1, col: 1 })
    expect(outcome.status).toBe('moved')
    if (outcome.status !== 'moved') return
    expect(placements(outcome.layout)).toEqual([
      ['a', placement(1, 1)],
      ['b', placement(0, 1)],
    ])
  })

  it('swaps with the module already in the target cell', () => {
    const layout = layoutOf(mod('a', 0, 0), mod('b', 1, 1))
    const outcome = moveModuleToCell(layout, 'a', { row: 1, col: 1 })
    expect(outcome.status).toBe('moved')
    if (outcome.status !== 'moved') return
    expect(placements(outcome.layout)).toEqual([
      ['a', placement(1, 1)],
      ['b', placement(0, 0)],
    ])
  })

  it('preserves module array order so the optimistic layout matches the server', () => {
    const layout = layoutOf(mod('a', 0, 0), mod('b', 0, 1), mod('c', 1, 0))
    const outcome = moveModuleToCell(layout, 'c', { row: 0, col: 1 })
    expect(outcome.status).toBe('moved')
    if (outcome.status !== 'moved') return
    expect(outcome.layout.modules.map((module) => module.id)).toEqual(['a', 'b', 'c'])
  })

  it('carries the mover span to the target', () => {
    const layout = layoutIn({ rows: 2, cols: 3 }, moduleAtPlacement('wide', placement(0, 0, 1, 2)))
    const outcome = moveModuleToCell(layout, 'wide', { row: 1, col: 1 })
    expect(outcome.status).toBe('moved')
    if (outcome.status !== 'moved') return
    expect(outcome.layout.modules[0].placement).toEqual(placement(1, 1, 1, 2))
  })

  it('swaps two modules of equal span', () => {
    const layout = layoutIn(
      { rows: 2, cols: 2 },
      moduleAtPlacement('a', placement(0, 0, 1, 2)),
      moduleAtPlacement('b', placement(1, 0, 1, 2))
    )
    const outcome = moveModuleToCell(layout, 'a', { row: 1, col: 0 })
    expect(outcome.status).toBe('moved')
    if (outcome.status !== 'moved') return
    expect(placements(outcome.layout)).toEqual([
      ['a', placement(1, 0, 1, 2)],
      ['b', placement(0, 0, 1, 2)],
    ])
  })

  it('reports the target as unchanged when the module is already there', () => {
    const layout = layoutOf(mod('a', 0, 0))
    expect(moveModuleToCell(layout, 'a', { row: 0, col: 0 })).toEqual({ status: 'unchanged' })
  })

  it('reports unchanged for an unknown module id', () => {
    const layout = layoutOf(mod('a', 0, 0))
    expect(moveModuleToCell(layout, 'missing', { row: 1, col: 1 })).toEqual({
      status: 'unchanged',
    })
  })

  it('rejects a target outside the grid', () => {
    const layout = layoutOf(mod('a', 0, 0))
    expect(moveModuleToCell(layout, 'a', { row: 2, col: 0 }).status).toBe('out-of-bounds')
  })

  it('rejects a span that would run off the grid', () => {
    const layout = layoutIn({ rows: 2, cols: 2 }, moduleAtPlacement('a', placement(0, 0, 1, 2)))
    expect(moveModuleToCell(layout, 'a', { row: 0, col: 1 }).status).toBe('out-of-bounds')
  })

  it('refuses a swap between modules of different spans', () => {
    const layout = layoutIn(
      { rows: 2, cols: 2 },
      mod('small', 0, 0),
      moduleAtPlacement('wide', placement(1, 0, 1, 2))
    )
    const outcome = moveModuleToCell(layout, 'small', { row: 1, col: 0 })
    expect(outcome.status).toBe('blocked')
    if (outcome.status !== 'blocked') return
    expect(outcome.blockedBy.map((m) => m.id)).toEqual(['wide'])
  })

  it('refuses a move that would land on more than one module', () => {
    const layout = layoutIn(
      { rows: 2, cols: 2 },
      moduleAtPlacement('wide', placement(0, 0, 1, 2)),
      mod('x', 1, 0),
      mod('y', 1, 1)
    )
    const outcome = moveModuleToCell(layout, 'wide', { row: 1, col: 0 })
    expect(outcome.status).toBe('blocked')
    if (outcome.status !== 'blocked') return
    expect(outcome.blockedBy.map((m) => m.id)).toEqual(['x', 'y'])
  })

  it('never mutates the source layout or its modules', () => {
    const source = mod('a', 0, 0)
    const layout = layoutOf(source, mod('b', 1, 1))
    const target: InterfaceCell = { row: 1, col: 1 }
    const outcome = moveModuleToCell(layout, 'a', target)
    expect(source.placement).toEqual(placement(0, 0))
    expect(layout.modules[1].placement).toEqual(placement(1, 1))
    expect(outcome.status).toBe('moved')
    if (outcome.status !== 'moved') return
    expect(outcome.layout).not.toBe(layout)
    expect(outcome.layout.version).toBe(1)
    expect(outcome.layout.grid).toEqual(GRID_2X2)
  })
})

describe('collapseLayout', () => {
  it('collapses to a 1x1 grid for an empty layout', () => {
    expect(collapseLayout(layoutOf())).toEqual({ grid: { rows: 1, cols: 1 }, modules: [] })
  })

  it('lets a single top-left module fill the page', () => {
    const module = mod('a', 0, 0)
    const preview = collapseLayout(layoutOf(module))
    expect(preview.grid).toEqual({ rows: 1, cols: 1 })
    expect(preview.modules).toEqual([{ module, placement: placement(0, 0) }])
  })

  it('lets a single bottom-right module fill the page', () => {
    const module = mod('a', 1, 1)
    const preview = collapseLayout(layoutOf(module))
    expect(preview.grid).toEqual({ rows: 1, cols: 1 })
    expect(preview.modules).toEqual([{ module, placement: placement(0, 0) }])
  })

  it('renders a filled top row as two full-height columns', () => {
    const layout = layoutOf(mod('a', 0, 0), mod('b', 0, 1))
    expect(collapseLayout(layout).grid).toEqual({ rows: 1, cols: 2 })
    expect(describeCollapsed(layout)).toEqual(['a@0,0+1x1', 'b@0,1+1x1'])
  })

  it('renders a filled left column as two full-width rows', () => {
    const layout = layoutOf(mod('a', 0, 0), mod('b', 1, 0))
    expect(collapseLayout(layout).grid).toEqual({ rows: 2, cols: 1 })
    expect(describeCollapsed(layout)).toEqual(['a@0,0+1x1', 'b@1,0+1x1'])
  })

  it('stacks a diagonal pair as two full-width rows', () => {
    const layout = layoutOf(mod('a', 0, 0), mod('b', 1, 1))
    expect(collapseLayout(layout).grid).toEqual({ rows: 2, cols: 2 })
    expect(describeCollapsed(layout)).toEqual(['a@0,0+1x2', 'b@1,0+1x2'])
  })

  it('spans the lone module of a row across both columns', () => {
    const layout = layoutOf(mod('a', 0, 0), mod('b', 0, 1), mod('c', 1, 0))
    expect(collapseLayout(layout).grid).toEqual({ rows: 2, cols: 2 })
    expect(describeCollapsed(layout)).toEqual(['a@0,0+1x1', 'b@0,1+1x1', 'c@1,0+1x2'])
  })

  it('keeps a full grid as an authored 2x2', () => {
    const layout = layoutOf(mod('a', 0, 0), mod('b', 0, 1), mod('c', 1, 0), mod('d', 1, 1))
    expect(collapseLayout(layout).grid).toEqual({ rows: 2, cols: 2 })
    expect(describeCollapsed(layout)).toEqual(['a@0,0+1x1', 'b@0,1+1x1', 'c@1,0+1x1', 'd@1,1+1x1'])
  })

  it('emits modules in reading order regardless of array order', () => {
    const layout = layoutOf(mod('d', 1, 1), mod('b', 0, 1), mod('a', 0, 0))
    expect(collapseLayout(layout).modules.map((entry) => entry.module.id)).toEqual(['a', 'b', 'd'])
  })

  it('does not reorder the source layout', () => {
    const layout = layoutOf(mod('d', 1, 1), mod('a', 0, 0))
    collapseLayout(layout)
    expect(layout.modules.map((module) => module.id)).toEqual(['d', 'a'])
  })

  it('drops the empty tracks of a sparse larger grid', () => {
    const layout = layoutIn({ rows: 4, cols: 4 }, mod('a', 1, 1), mod('b', 3, 3))
    expect(collapseLayout(layout).grid).toEqual({ rows: 2, cols: 2 })
    expect(describeCollapsed(layout)).toEqual(['a@0,0+1x2', 'b@1,0+1x2'])
  })

  it('shrinks a span to the tracks that survive the collapse', () => {
    const layout = layoutIn(
      { rows: 3, cols: 3 },
      moduleAtPlacement('tall', placement(0, 0, 3, 1)),
      mod('x', 0, 2)
    )
    expect(collapseLayout(layout).grid).toEqual({ rows: 3, cols: 2 })
    expect(describeCollapsed(layout)).toEqual(['tall@0,0+3x1', 'x@0,1+1x1'])
  })

  it('keeps a module sharing a row with a spanning neighbour in its own column', () => {
    const layout = layoutIn(
      { rows: 2, cols: 2 },
      moduleAtPlacement('tall', placement(0, 0, 2, 1)),
      mod('x', 0, 1)
    )
    expect(describeCollapsed(layout)).toEqual(['tall@0,0+2x1', 'x@0,1+1x1'])
  })
})
