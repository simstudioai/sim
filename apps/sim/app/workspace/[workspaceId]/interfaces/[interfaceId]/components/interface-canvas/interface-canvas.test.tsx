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
vi.mock(
  '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/module-renderer',
  () => ({
    ModuleRenderer: ({ module, mode }: { module: { id: string }; mode: string }) => (
      <div data-testid='module' data-module-id={module.id} data-mode={mode} />
    ),
  })
)

import type { InterfaceLayout, InterfaceModule } from '@/lib/interfaces'
import { InterfaceCanvas } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/interface-canvas'
import type { InterfaceMode } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/search-params'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function moduleAt(id: string, row: 0 | 1, col: 0 | 1): InterfaceModule {
  return { id, type: 'table', cell: { row, col }, config: { tableId: null } }
}

function layoutOf(...modules: InterfaceModule[]): InterfaceLayout {
  return { version: 1, modules }
}

function render(layout: InterfaceLayout, mode: InterfaceMode, canEdit = true) {
  act(() => {
    root.render(
      <InterfaceCanvas
        workspaceId='ws-1'
        interfaceId='if-1'
        layout={layout}
        mode={mode}
        selectedModuleId='a'
        onSelectModule={vi.fn()}
        onAddModule={vi.fn()}
        onMoveModule={vi.fn()}
        onRemoveModule={vi.fn()}
        canEdit={canEdit}
      />
    )
  })
}

/** `${moduleId}@${gridRow}|${gridColumn}` — the placement each pane actually got. */
function placements(): string[] {
  return [...container.querySelectorAll('[data-testid="module"]')].map((node) => {
    const pane = node.parentElement?.parentElement as HTMLElement
    return `${node.getAttribute('data-module-id')}@${pane.style.gridRow}|${pane.style.gridColumn}`
  })
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
    expect(container.querySelector('[class*="brand-secondary"]')).toBeNull()
  })

  it('drops empty tracks so a filled top row becomes two full-height columns', () => {
    render(layout, 'preview')

    const grid = container.querySelector('[style*="grid-template-rows"]') as HTMLElement
    expect(grid.style.gridTemplateRows).toBe('repeat(1, minmax(0, 1fr))')
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    expect(placements()).toEqual(['a@1|1', 'b@1|2'])
  })

  it('lets a lone module fill the page wherever it was authored', () => {
    render(layoutOf(moduleAt('a', 1, 1)), 'preview')
    expect(placements()).toEqual(['a@1|1'])
  })

  it('spans the lone module of a row across both columns', () => {
    render(layoutOf(moduleAt('a', 0, 0), moduleAt('b', 0, 1), moduleAt('c', 1, 0)), 'preview')
    expect(placements()).toEqual(['a@1|1', 'b@1|2', 'c@2|1 / -1'])
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
