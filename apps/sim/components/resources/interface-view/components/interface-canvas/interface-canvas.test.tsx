/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The frame is what these tests are about — which chrome each mode paints
 * around a module — so the renderer is stubbed to keep the chat, table, and
 * file dependency trees out of the run.
 */
vi.mock('@/components/resources/interface-view/components/module-renderer', () => ({
  ModuleRenderer: ({ module, mode }: { module: { id: string }; mode: string }) => (
    <div data-testid='module' data-module-id={module.id} data-mode={mode} />
  ),
}))

import { InterfaceCanvas } from '@/components/resources/interface-view/components/interface-canvas'
import type { InterfaceLayout, InterfaceMode, InterfaceModule } from '@/lib/interfaces/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function moduleAt(id: string, row: 0 | 1, col: 0 | 1): InterfaceModule {
  return {
    id,
    type: 'table',
    placement: { row, col, rowSpan: 1, colSpan: 1 },
    config: { tableId: null },
  }
}

function layoutOf(...modules: InterfaceModule[]): InterfaceLayout {
  return { version: 1, grid: { rows: 2, cols: 2 }, modules }
}

function render(layout: InterfaceLayout, mode: InterfaceMode, canEdit = true) {
  act(() => {
    root.render(
      <InterfaceCanvas
        layout={layout}
        mode={mode}
        selectedModuleId='a'
        onSelectModule={vi.fn()}
        onAddModule={vi.fn()}
        onMoveModule={vi.fn()}
        onRemoveModule={vi.fn()}
        canEdit={canEdit}
        canRun={canEdit}
      />
    )
  })
}

/**
 * `${moduleId}@${row}|${col}` — the placement each pane actually got.
 *
 * Read off the `--pane-row` / `--pane-col` custom properties rather than
 * `style.gridRow` / `style.gridColumn`: an inline `style` outranks every media
 * query, so the placement has to travel as variables for the phone layout to be
 * able to drop it.
 */
function placements(): string[] {
  return [...container.querySelectorAll('[data-testid="module"]')].map((node) => {
    const pane = node.parentElement?.parentElement as HTMLElement
    const row = pane.style.getPropertyValue('--pane-row')
    const col = pane.style.getPropertyValue('--pane-col')
    return `${node.getAttribute('data-module-id')}@${row}|${col}`
  })
}

/** The preview grid element, found by the geometry variables it carries. */
function previewGrid(): HTMLElement {
  const grid = container.querySelector('[style*="--interface-cols"]') as HTMLElement | null
  if (!grid) throw new Error('Preview grid not found')
  return grid
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('InterfaceCanvas — preview mode', () => {
  const layout = layoutOf(moduleAt('a', 0, 0), moduleAt('b', 0, 1))

  it('renders one live module per placement and nothing else', () => {
    render(layout, 'preview')

    const modules = [...container.querySelectorAll('[data-testid="module"]')]
    expect(modules.map((node) => node.getAttribute('data-module-id'))).toEqual(['a', 'b'])
    expect(modules.every((node) => node.getAttribute('data-mode') === 'preview')).toBe(true)
  })

  it('paints no editing affordances', () => {
    render(layout, 'preview')

    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[draggable="true"]')).toBeNull()
    expect(container.querySelector('.border-dashed')).toBeNull()
    /** The type bar is the module's select handle; it must not reach a visitor. */
    expect(container.textContent).not.toContain('Table')
  })

  it('never paints the selection ring, even on the selected module', () => {
    render(layout, 'preview')

    /**
     * Matched by class string rather than a CSS selector: the ring is a
     * Tailwind arbitrary value, and its brackets are not selector-safe.
     */
    const ringed = [...container.querySelectorAll('*')].some((node) =>
      node.className.toString().includes('border-[var(--text-muted)]')
    )
    expect(ringed).toBe(false)
  })

  it('drops empty tracks so a filled top row becomes two full-height columns', () => {
    render(layout, 'preview')

    const grid = previewGrid()
    expect(grid.style.getPropertyValue('--interface-rows')).toBe('1')
    expect(grid.style.getPropertyValue('--interface-cols')).toBe('2')
    expect(placements()).toEqual(['a@1 / span 1|1 / span 1', 'b@1 / span 1|2 / span 1'])
  })

  /**
   * The geometry must not be written as an inline `grid-template-*`: media
   * queries cannot outrank an inline style, so the phone layout could never
   * collapse the grid to one column.
   */
  it('carries the geometry in custom properties, not inline grid templates', () => {
    render(layout, 'preview')

    const grid = previewGrid()
    expect(grid.style.gridTemplateRows).toBe('')
    expect(grid.style.gridTemplateColumns).toBe('')

    const pane = container.querySelector('[style*="--pane-row"]') as HTMLElement
    expect(pane.style.gridRow).toBe('')
    expect(pane.style.gridColumn).toBe('')
  })

  it('stacks the panes below the sm breakpoint', () => {
    render(layout, 'preview')

    expect(previewGrid().className).toContain('max-sm:[grid-template-columns:minmax(0,1fr)]')
    const pane = container.querySelector('[style*="--pane-row"]') as HTMLElement
    expect(pane.className).toContain('max-sm:[grid-column:auto]')
    expect(pane.className).toContain('max-sm:[grid-row:auto]')
  })

  it('lets a lone module fill the page wherever it was authored', () => {
    render(layoutOf(moduleAt('a', 1, 1)), 'preview')
    expect(placements()).toEqual(['a@1 / span 1|1 / span 1'])
  })

  it('spans the lone module of a row across both columns', () => {
    render(layoutOf(moduleAt('a', 0, 0), moduleAt('b', 0, 1), moduleAt('c', 1, 0)), 'preview')
    expect(placements()).toEqual([
      'a@1 / span 1|1 / span 1',
      'b@1 / span 1|2 / span 1',
      'c@2 / span 1|1 / span 2',
    ])
  })

  it('shows a neutral empty state that names no editing surface', () => {
    render(layoutOf(), 'preview')

    expect(container.textContent).toContain('This interface has no modules yet.')
    expect(container.textContent).not.toContain('edit mode')
    expect(container.textContent).not.toContain('properties panel')
  })
})

describe('InterfaceCanvas — edit mode', () => {
  it('paints all four authoring cells with the module chrome', () => {
    render(layoutOf(moduleAt('a', 0, 0)), 'edit')

    expect(container.querySelectorAll('[data-testid="module"]')).toHaveLength(1)
    expect(container.querySelector('[data-testid="module"]')?.getAttribute('data-mode')).toBe(
      'edit'
    )
    expect(container.querySelector('[aria-label="Select Table module"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Remove Table module"]')).not.toBeNull()
    expect(container.querySelectorAll('.border-dashed')).toHaveLength(3)
    expect(container.querySelector('[draggable="true"]')).not.toBeNull()
  })

  it('withholds drag and the add affordance from a viewer', () => {
    render(layoutOf(moduleAt('a', 0, 0)), 'edit', false)

    expect(container.querySelector('[draggable="true"]')).toBeNull()
    expect(container.querySelector('[aria-label="Remove Table module"]')).toBeNull()
    expect(container.querySelector('[aria-label^="Add a module"]')).toBeNull()
  })
})
