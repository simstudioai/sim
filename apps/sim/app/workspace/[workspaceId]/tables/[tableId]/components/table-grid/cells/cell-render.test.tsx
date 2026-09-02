/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DisplayColumn } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/types'

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    size,
    variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string
    variant?: string
  }) => (
    <button data-size={size} data-variant={variant} {...props}>
      {children}
    </button>
  ),
  Checkbox: () => null,
  ChipTag: ({
    children,
    variant,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement> & { variant?: string }) => (
    <span data-chip-tag-variant={variant} {...props}>
      {children}
    </span>
  ),
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  Tooltip: {
    Root: ({ children }: { children: React.ReactNode }) => children,
    Trigger: ({ children }: { children: React.ReactNode }) => children,
    Content: ({ children }: { children: React.ReactNode }) => children,
  },
}))

vi.mock('@/app/workspace/[workspaceId]/logs/utils', () => ({
  StatusBadge: () => null,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/cells/sim-resource-cell',
  () => ({ SimResourceCell: () => null })
)

vi.mock('@/app/workspace/[workspaceId]/tables/[tableId]/components/select-field', () => ({
  resolveSelectOptions: () => [],
  SelectPill: () => null,
}))

import {
  CellRender,
  resolveCellRender,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/cells/cell-render'

const REFERENCE_COLUMN: DisplayColumn = {
  id: 'col-account',
  key: 'col-account',
  name: 'Account',
  type: 'reference',
  referenceTableId: 'table-accounts',
  referenceTableName: 'Accounts',
  groupSize: 1,
  groupStartColIndex: 0,
  headerLabel: 'Account',
  isGroupStart: true,
}

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

describe('reference cell rendering', () => {
  it('resolves a stored row ID to a chip labeled with the referenced table name', () => {
    expect(
      resolveCellRender({
        value: 'row-account-1',
        exec: undefined,
        column: REFERENCE_COLUMN,
        waitingOnLabels: undefined,
        referenceColumnsEnabled: true,
      })
    ).toEqual({ kind: 'reference-chip', label: 'Accounts' })
  })

  it('keeps an empty reference cell empty', () => {
    expect(
      resolveCellRender({
        value: '',
        exec: undefined,
        column: REFERENCE_COLUMN,
        waitingOnLabels: undefined,
        referenceColumnsEnabled: true,
      })
    ).toEqual({ kind: 'empty' })
  })

  it('uses a neutral label while the referenced table name is unavailable', () => {
    expect(
      resolveCellRender({
        value: 'row-account-1',
        exec: undefined,
        column: { ...REFERENCE_COLUMN, referenceTableName: undefined },
        waitingOnLabels: undefined,
        referenceColumnsEnabled: true,
      })
    ).toEqual({ kind: 'reference-chip', label: 'Referenced table' })
  })

  it('renders the stored row ID as plain text when the feature is disabled', () => {
    expect(
      resolveCellRender({
        value: 'row-account-1',
        exec: undefined,
        column: REFERENCE_COLUMN,
        waitingOnLabels: undefined,
        referenceColumnsEnabled: false,
      })
    ).toEqual({ kind: 'text', text: 'row-account-1' })
  })

  it('opens the referenced row from the chip without exposing its stored row ID', () => {
    const onReferenceClick = vi.fn()

    act(() => {
      root.render(
        <CellRender
          kind={resolveCellRender({
            value: 'row-account-1',
            exec: undefined,
            column: REFERENCE_COLUMN,
            waitingOnLabels: undefined,
            referenceColumnsEnabled: true,
          })}
          isEditing={false}
          referenceAction={{ expanded: false, onClick: onReferenceClick }}
        />
      )
    })

    const chip = container.querySelector('button')
    expect(chip?.textContent).toBe('Accounts')
    expect(chip?.dataset.variant).toBe('ghost')
    expect(chip?.dataset.size).toBe('sm')
    expect(chip).toHaveProperty('dataset.referenceCellTrigger', '')
    expect(chip?.className).toContain('max-w-full')
    expect(chip?.className).toContain('p-0')
    expect(chip?.querySelector('svg')).toBeNull()
    const tag = chip?.querySelector('[data-chip-tag-variant="field"]')
    expect(tag?.textContent).toBe('Accounts')
    expect(tag?.className).toContain('min-w-0')
    expect(tag?.className).toContain('max-w-full')

    act(() => chip?.click())

    expect(onReferenceClick).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain('row-account-1')
  })

  it('keeps a chip double-click from reaching the reference cell', () => {
    const onCellDoubleClick = vi.fn()
    const onReferenceClick = vi.fn()

    act(() => {
      root.render(
        <div onDoubleClick={onCellDoubleClick}>
          <CellRender
            kind={{ kind: 'reference-chip', label: 'Accounts' }}
            isEditing={false}
            referenceAction={{ expanded: false, onClick: onReferenceClick }}
          />
        </div>
      )
    })

    act(() => {
      const chip = container.querySelector('button')
      chip?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      chip?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
      chip?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))
    })

    expect(onReferenceClick).toHaveBeenCalledOnce()
    expect(onCellDoubleClick).not.toHaveBeenCalled()
  })
})
