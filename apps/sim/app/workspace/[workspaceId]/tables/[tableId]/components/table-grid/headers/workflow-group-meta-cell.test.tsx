/**
 * @vitest-environment jsdom
 */
import { act, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnDefinition } from '@/lib/table'

vi.mock('@sim/emcn', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  FloatingTooltip: () => null,
  isTextClipped: () => false,
  useFloatingTooltip: () => ({ state: {}, handlers: {} }),
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
  ChevronDown: () => null,
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
  WorkflowX: () => null,
  X: () => null,
}))

vi.mock('@/lib/table/column-types', () => ({
  columnTypeById: () => ({ icon: () => null }),
  columnTypeOf: (column: ColumnDefinition) => ({
    icon: () => null,
    label: column.type === 'reference' ? 'Reference' : 'Text',
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/tables/[tableId]/components/column-config-sidebar', () => ({
  PLAIN_COLUMN_TYPE_OPTIONS: [],
}))

vi.mock('@/enrichments/registry', () => ({ getEnrichment: () => undefined }))

import { ColumnHeaderMenu } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/headers/column-header-menu'
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

describe('ColumnHeaderMenu read-only Reference navigation', () => {
  it('keeps a direct navigation action available without exposing the options menu', () => {
    const onGoToReferenceTable = vi.fn()

    act(() => {
      root.render(
        <ColumnHeaderMenu
          column={{
            id: 'col-account',
            key: 'col-account',
            name: 'Account',
            type: 'reference',
            referenceTableId: 'table-accounts',
            groupSize: 1,
            groupStartColIndex: 0,
            headerLabel: 'Account',
            isGroupStart: true,
          }}
          colIndex={0}
          readOnly
          isRenaming={false}
          isColumnSelected={false}
          renameValue=''
          onRenameValueChange={vi.fn()}
          onRenameSubmit={vi.fn()}
          onRenameCancel={vi.fn()}
          onColumnSelect={vi.fn()}
          onInsertLeft={vi.fn()}
          onInsertRight={vi.fn()}
          onGoToReferenceTable={onGoToReferenceTable}
          onDeleteColumn={vi.fn()}
          onResizeStart={vi.fn()}
          onResize={vi.fn()}
          onResizeEnd={vi.fn()}
          onAutoResize={vi.fn()}
          onOpenConfig={vi.fn()}
        />
      )
    })

    const navigationButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Go to Reference Table"]'
    )
    expect(navigationButton).not.toBeNull()

    act(() => navigationButton?.click())

    expect(onGoToReferenceTable).toHaveBeenCalledWith('table-accounts')
    expect(container.querySelector('button[aria-label="Column options"]')).toBeNull()
  })
})
