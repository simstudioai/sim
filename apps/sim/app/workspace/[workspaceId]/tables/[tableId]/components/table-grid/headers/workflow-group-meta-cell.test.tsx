/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDefinition } from '@/lib/table'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  DropdownMenu: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type='button' onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@sim/emcn/icons', () => ({
  ArrowDown: () => null,
  ArrowLeft: () => null,
  ArrowRight: () => null,
  ArrowUp: () => null,
  Eye: () => null,
  EyeOff: () => null,
  Fingerprint: () => null,
  Pencil: () => null,
  Pin: () => null,
  PinOff: () => null,
  PlayOutline: () => null,
  Settings: () => null,
  SquareArrowUpRight: () => null,
  Trash: () => null,
  Workflow: () => null,
  X: () => null,
}))

vi.mock('@/lib/table/column-types', () => ({
  columnTypeOf: (column: ColumnDefinition) => ({
    icon: () => null,
    label: column.type === 'reference' ? 'Reference' : 'Text',
    hasConfiguration: column.type === 'reference',
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/tables/[tableId]/components/column-config-sidebar', () => ({
  PLAIN_COLUMN_TYPE_OPTIONS: [],
}))

vi.mock('@/enrichments/registry', () => ({ getEnrichment: () => undefined }))

import { ColumnOptionsMenu } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/headers/workflow-group-meta-cell'

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

function renderMenu(column: ColumnDefinition, onGoToReferenceTable: (tableId: string) => void) {
  act(() => {
    root.render(
      <ColumnOptionsMenu
        open
        onOpenChange={vi.fn()}
        position={{ x: 0, y: 0 }}
        column={{
          ...column,
          key: column.id ?? column.name,
          groupSize: 1,
          groupStartColIndex: 0,
          headerLabel: column.name,
          isGroupStart: true,
        }}
        onInsertLeft={vi.fn()}
        onInsertRight={vi.fn()}
        onDeleteColumn={vi.fn()}
        onGoToReferenceTable={onGoToReferenceTable}
      />
    )
  })
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label
  )
}

describe('ColumnOptionsMenu Reference navigation', () => {
  it('opens the table targeted by a Reference column', () => {
    const onGoToReferenceTable = vi.fn()
    renderMenu(
      {
        id: 'col-account',
        name: 'Account',
        type: 'reference',
        referenceTableId: 'table-accounts',
      },
      onGoToReferenceTable
    )

    act(() => findButton('Go to Reference Table')?.click())

    expect(onGoToReferenceTable).toHaveBeenCalledWith('table-accounts')
  })

  it('does not show the action for a non-Reference column', () => {
    renderMenu({ id: 'col-name', name: 'Name', type: 'string' }, vi.fn())

    expect(findButton('Go to Reference Table')).toBeUndefined()
  })

  it('does not show the action when Reference metadata has no target table', () => {
    renderMenu({ id: 'col-account', name: 'Account', type: 'reference' }, vi.fn())

    expect(findButton('Go to Reference Table')).toBeUndefined()
  })
})
