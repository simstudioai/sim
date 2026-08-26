/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  DropdownMenu: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode
    disabled?: boolean
    onSelect?: () => void
  }) => (
    <button type='button' disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@sim/emcn/icons', () => ({
  ArrowDown: () => null,
  ArrowUp: () => null,
  Blimp: () => null,
  Duplicate: () => null,
  Eye: () => null,
  ListFilter: () => null,
  Pencil: () => null,
  PlayOutline: () => null,
  RefreshCw: () => null,
  Square: () => null,
  Trash: () => null,
}))

import { ContextMenu } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/context-menu/context-menu'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label
  )
}

describe('table row ContextMenu', () => {
  it('places Copy Row Id directly below Duplicate row and invokes its handler', () => {
    const onCopyRowId = vi.fn()

    act(() => {
      root.render(
        <ContextMenu
          contextMenu={{
            isOpen: true,
            position: { x: 0, y: 0 },
            row: { id: 'row-1', data: {}, position: 'a0' },
            rowIndex: 0,
            columnName: null,
          }}
          onClose={vi.fn()}
          onEditCell={vi.fn()}
          onDelete={vi.fn()}
          onInsertAbove={vi.fn()}
          onInsertBelow={vi.fn()}
          onDuplicate={vi.fn()}
          onCopyRowId={onCopyRowId}
        />
      )
    })

    const labels = Array.from(container.querySelectorAll('button')).map((button) =>
      button.textContent?.trim()
    )
    expect(labels.indexOf('Copy Row Id')).toBe(labels.indexOf('Duplicate row') + 1)

    act(() => findButton('Copy Row Id')?.click())
    expect(onCopyRowId).toHaveBeenCalledOnce()
  })
})
