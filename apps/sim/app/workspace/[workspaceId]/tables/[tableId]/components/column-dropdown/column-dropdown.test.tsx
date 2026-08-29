/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLUMN_TYPE_OPTIONS } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/column-config-sidebar'
import { ColumnDropdown } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/column-dropdown/column-dropdown'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ColumnDropdown', () => {
  it('lists Enrichments as a regular entry after the column options', () => {
    const onPickEnrichment = vi.fn()

    act(() => {
      root.render(
        <ColumnDropdown
          columns={[]}
          trigger='header'
          disabled={false}
          onPickType={vi.fn()}
          onPickWorkflow={vi.fn()}
          onPickEnrichment={onPickEnrichment}
          blocked={false}
          onBlocked={vi.fn()}
        />
      )
    })
    act(() => {
      container
        .querySelector<HTMLButtonElement>('button')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })

    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items.map((item) => item.textContent)).toEqual([
      ...COLUMN_TYPE_OPTIONS.map((option) => option.label),
      'Enrichments',
    ])
    expect(document.body.querySelector('[role="separator"]')).toBeNull()

    act(() => items.at(-1)?.click())
    expect(onPickEnrichment).toHaveBeenCalledOnce()
  })
})
