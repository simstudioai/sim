/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableViewWire } from '@/lib/api/contracts/tables'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@sim/emcn', () => ({
  ChipChevronDown: () => null,
  chipContentLabelClass: '',
  chipVariants: () => '',
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  POPOVER_ANIMATION_CLASSES: '',
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverAnchor: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  PopoverSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import { ViewsMenu } from './views-menu'

function view(id: string, name: string): TableViewWire {
  return {
    id,
    tableId: 'tbl_1',
    name,
    config: {},
    isDefault: false,
    createdBy: 'user_1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  }
}

let container: HTMLDivElement
let root: Root

describe('ViewsMenu', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders the implicit Default view first and selects saved Views', async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <ViewsMenu
          views={[view('view_a', 'Alpha'), view('view_z', 'Zulu')]}
          activeViewId={null}
          onSelect={onSelect}
          onRename={vi.fn()}
          onDelete={vi.fn()}
          onNewView={vi.fn()}
          canEdit
        />
      )
    })

    const labels = Array.from(container.querySelectorAll('button'))
      .map((button) => button.textContent?.trim())
      .filter(Boolean)
    expect(labels.slice(1, 4)).toEqual(['Default view', 'Alpha', 'Zulu'])

    const alpha = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Alpha'
    )
    await act(async () => alpha?.click())
    expect(onSelect).toHaveBeenCalledWith('view_a')
  })

  it('exposes rename and delete actions only for saved Views', async () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()
    await act(async () => {
      root.render(
        <ViewsMenu
          views={[view('view_a', 'Alpha')]}
          activeViewId='view_a'
          onSelect={vi.fn()}
          onRename={onRename}
          onDelete={onDelete}
          onNewView={vi.fn()}
          canEdit
        />
      )
    })

    const rename = container.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')
    expect(rename).not.toBeNull()
    expect(remove).not.toBeNull()

    await act(async () => rename?.click())
    await act(async () => remove?.click())
    expect(onRename).toHaveBeenCalledWith('view_a')
    expect(onDelete).toHaveBeenCalledWith('view_a')
  })
})
