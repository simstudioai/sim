/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableRow } from '@/lib/table'
import { ExpandedCellPopover } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/cells/expanded-cell-popover'
import type { DisplayColumn } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/types'

vi.mock('@/hooks/queries/general-settings', () => ({
  useTimezone: () => 'UTC',
}))

const BLOCKED_REASON = 'Updating rows is disabled in Table Security.'

const COLUMN: DisplayColumn = {
  name: 'notes',
  type: 'string',
  key: 'notes',
  groupSize: 1,
  groupStartColIndex: 0,
  headerLabel: 'notes',
  isGroupStart: true,
}

const ROW: TableRow = {
  id: 'row-1',
  data: { notes: 'Original text' },
  executions: {},
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

let container: HTMLDivElement
let grid: HTMLDivElement
let root: Root
const onSave = vi.fn()
const onClose = vi.fn()

function render(saveBlockedReason?: string) {
  act(() => {
    root.render(
      <ExpandedCellPopover
        expandedCell={{ rowId: ROW.id, columnName: COLUMN.key, columnKey: COLUMN.key }}
        onClose={onClose}
        rows={[ROW]}
        columns={[COLUMN]}
        onSave={onSave}
        canEdit
        saveBlockedReason={saveBlockedReason}
        scrollContainer={null}
      />
    )
  })
}

function getTextarea(): HTMLTextAreaElement {
  const textarea = document.querySelector('textarea')
  if (!textarea) throw new Error('Missing textarea')
  return textarea
}

function getSaveButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent === 'Save'
  )
  if (!button) throw new Error('Missing Save button')
  return button
}

function typeDraft(value: string) {
  const textarea = getTextarea()
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setValue?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function pressEnter() {
  act(() => {
    getTextarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

function hover(element: Element) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10 })
    )
  })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  grid = document.createElement('div')
  grid.setAttribute('data-table-scroll', '')
  const cell = document.createElement('div')
  cell.setAttribute('data-row-id', ROW.id)
  cell.setAttribute('data-col', '0')
  grid.appendChild(cell)
  container = document.createElement('div')
  document.body.append(grid, container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  grid.remove()
})

describe('ExpandedCellPopover', () => {
  it('opens read-only and explains the disabled Save on hover', () => {
    render(BLOCKED_REASON)
    expect(getTextarea().value).toBe('Original text')
    expect(getTextarea().readOnly).toBe(true)
    expect(getSaveButton().disabled).toBe(true)
    expect(document.body.textContent).not.toContain(BLOCKED_REASON)
    // The ↵ half of the shortcut hint would advertise a save that never happens.
    expect(document.body.textContent).toContain('esc close')
    expect(document.body.textContent).not.toContain('save ·')

    const trigger = getSaveButton().parentElement
    if (!trigger) throw new Error('Missing Save tooltip trigger')
    hover(trigger)
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(BLOCKED_REASON)

    pressEnter()
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('saves an edited value when saving is allowed', () => {
    render()
    expect(getTextarea().readOnly).toBe(false)
    expect(getSaveButton().disabled).toBe(false)
    expect(document.body.textContent).toContain('save ·')

    typeDraft('Changed text')
    pressEnter()
    expect(onSave).toHaveBeenCalledWith(ROW.id, COLUMN.key, 'Changed text', 'blur')
    expect(onClose).toHaveBeenCalled()
  })
})
