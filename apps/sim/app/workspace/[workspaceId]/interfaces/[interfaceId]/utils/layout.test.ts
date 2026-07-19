/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { InterfaceCell, InterfaceLayout, InterfaceModule } from '@/lib/interfaces'
import {
  cellKey,
  computePreviewLayout,
  findModuleAt,
  INTERFACE_GRID_CELLS,
  swapModuleCells,
} from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/utils/layout'

function moduleAt(id: string, row: 0 | 1, col: 0 | 1): InterfaceModule {
  return {
    id,
    type: 'chat',
    cell: { row, col },
    config: { workflowId: null, outputConfigs: [], showThinking: false, welcomeMessage: '' },
  }
}

function layoutOf(...modules: InterfaceModule[]): InterfaceLayout {
  return { version: 1, modules }
}

/** `${moduleId}@${gridRow}|${gridColumn}` — compact assertion shape. */
function describePlacements(layout: InterfaceLayout): string[] {
  return computePreviewLayout(layout).placements.map(
    (placement) => `${placement.module.id}@${placement.gridRow}|${placement.gridColumn}`
  )
}

describe('INTERFACE_GRID_CELLS', () => {
  it('lists all four cells in reading order', () => {
    expect(INTERFACE_GRID_CELLS).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ])
  })
})

describe('cellKey', () => {
  it('serializes as `row,col`', () => {
    expect(cellKey({ row: 0, col: 0 })).toBe('0,0')
    expect(cellKey({ row: 1, col: 0 })).toBe('1,0')
    expect(cellKey({ row: 0, col: 1 })).toBe('0,1')
  })
})

describe('findModuleAt', () => {
  const layout = layoutOf(moduleAt('a', 0, 1), moduleAt('b', 1, 0))

  it('returns the module occupying the cell', () => {
    expect(findModuleAt(layout, { row: 0, col: 1 })?.id).toBe('a')
    expect(findModuleAt(layout, { row: 1, col: 0 })?.id).toBe('b')
  })

  it('returns null for an empty cell', () => {
    expect(findModuleAt(layout, { row: 0, col: 0 })).toBeNull()
    expect(findModuleAt(layout, { row: 1, col: 1 })).toBeNull()
  })
})

describe('computePreviewLayout', () => {
  it('collapses to a 1x1 grid for an empty layout', () => {
    expect(computePreviewLayout(layoutOf())).toEqual({ rows: 1, cols: 1, placements: [] })
  })

  it('lets a single top-left module fill the page', () => {
    const module = moduleAt('a', 0, 0)
    const preview = computePreviewLayout(layoutOf(module))
    expect(preview.rows).toBe(1)
    expect(preview.cols).toBe(1)
    expect(preview.placements).toEqual([{ module, gridRow: '1', gridColumn: '1' }])
  })

  it('lets a single bottom-right module fill the page', () => {
    const module = moduleAt('a', 1, 1)
    const preview = computePreviewLayout(layoutOf(module))
    expect(preview.rows).toBe(1)
    expect(preview.cols).toBe(1)
    expect(preview.placements).toEqual([{ module, gridRow: '1', gridColumn: '1' }])
  })

  it('renders a filled top row as two full-height columns', () => {
    const layout = layoutOf(moduleAt('a', 0, 0), moduleAt('b', 0, 1))
    const preview = computePreviewLayout(layout)
    expect(preview.rows).toBe(1)
    expect(preview.cols).toBe(2)
    expect(describePlacements(layout)).toEqual(['a@1|1', 'b@1|2'])
  })

  it('renders a filled left column as two full-width rows', () => {
    const layout = layoutOf(moduleAt('a', 0, 0), moduleAt('b', 1, 0))
    const preview = computePreviewLayout(layout)
    expect(preview.rows).toBe(2)
    expect(preview.cols).toBe(1)
    expect(describePlacements(layout)).toEqual(['a@1|1', 'b@2|1'])
  })

  it('stacks a diagonal pair as two full-width rows', () => {
    const layout = layoutOf(moduleAt('a', 0, 0), moduleAt('b', 1, 1))
    const preview = computePreviewLayout(layout)
    expect(preview.rows).toBe(2)
    expect(preview.cols).toBe(2)
    expect(describePlacements(layout)).toEqual(['a@1|1 / -1', 'b@2|1 / -1'])
  })

  it('spans the lone module of a row across both columns', () => {
    const layout = layoutOf(moduleAt('a', 0, 0), moduleAt('b', 0, 1), moduleAt('c', 1, 0))
    const preview = computePreviewLayout(layout)
    expect(preview.rows).toBe(2)
    expect(preview.cols).toBe(2)
    expect(describePlacements(layout)).toEqual(['a@1|1', 'b@1|2', 'c@2|1 / -1'])
  })

  it('keeps a full grid as an authored 2x2', () => {
    const layout = layoutOf(
      moduleAt('a', 0, 0),
      moduleAt('b', 0, 1),
      moduleAt('c', 1, 0),
      moduleAt('d', 1, 1)
    )
    const preview = computePreviewLayout(layout)
    expect(preview.rows).toBe(2)
    expect(preview.cols).toBe(2)
    expect(describePlacements(layout)).toEqual(['a@1|1', 'b@1|2', 'c@2|1', 'd@2|2'])
  })

  it('emits placements in reading order regardless of module array order', () => {
    const layout = layoutOf(moduleAt('d', 1, 1), moduleAt('b', 0, 1), moduleAt('a', 0, 0))
    expect(computePreviewLayout(layout).placements.map((p) => p.module.id)).toEqual(['a', 'b', 'd'])
  })

  it('does not reorder the source layout', () => {
    const layout = layoutOf(moduleAt('d', 1, 1), moduleAt('a', 0, 0))
    computePreviewLayout(layout)
    expect(layout.modules.map((module) => module.id)).toEqual(['d', 'a'])
  })
})

describe('swapModuleCells', () => {
  it('moves a module into an empty cell', () => {
    const layout = layoutOf(moduleAt('a', 0, 0), moduleAt('b', 0, 1))
    const next = swapModuleCells(layout, 'a', { row: 1, col: 1 })
    expect(next.modules.map((module) => [module.id, module.cell])).toEqual([
      ['a', { row: 1, col: 1 }],
      ['b', { row: 0, col: 1 }],
    ])
  })

  it('swaps with the module already in the target cell', () => {
    const layout = layoutOf(moduleAt('a', 0, 0), moduleAt('b', 1, 1))
    const next = swapModuleCells(layout, 'a', { row: 1, col: 1 })
    expect(next.modules.map((module) => [module.id, module.cell])).toEqual([
      ['a', { row: 1, col: 1 }],
      ['b', { row: 0, col: 0 }],
    ])
  })

  it('preserves module array order so the optimistic layout matches the server', () => {
    const layout = layoutOf(moduleAt('a', 0, 0), moduleAt('b', 0, 1), moduleAt('c', 1, 0))
    const next = swapModuleCells(layout, 'c', { row: 0, col: 1 })
    expect(next.modules.map((module) => module.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns the same layout when the module is already in the target cell', () => {
    const layout = layoutOf(moduleAt('a', 0, 0))
    expect(swapModuleCells(layout, 'a', { row: 0, col: 0 })).toBe(layout)
  })

  it('returns the same layout for an unknown module id', () => {
    const layout = layoutOf(moduleAt('a', 0, 0))
    expect(swapModuleCells(layout, 'missing', { row: 1, col: 1 })).toBe(layout)
  })

  it('never mutates the source layout or its modules', () => {
    const source = moduleAt('a', 0, 0)
    const layout = layoutOf(source, moduleAt('b', 1, 1))
    const target: InterfaceCell = { row: 1, col: 1 }
    const next = swapModuleCells(layout, 'a', target)
    expect(source.cell).toEqual({ row: 0, col: 0 })
    expect(layout.modules[1].cell).toEqual({ row: 1, col: 1 })
    expect(next).not.toBe(layout)
    expect(next.version).toBe(1)
  })
})
