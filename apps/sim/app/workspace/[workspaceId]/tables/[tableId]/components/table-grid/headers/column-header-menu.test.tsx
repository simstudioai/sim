/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(' ') }))
vi.mock('@sim/emcn/icons', () => ({ ChevronDown: () => null }))
vi.mock(
  '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/headers/column-type-icon',
  () => ({
    ColumnTypeIcon: () => null,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/headers/workflow-group-meta-cell',
  () => ({
    ColumnOptionsMenu: () => null,
  })
)

import { ColumnHeaderMenu } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/headers/column-header-menu'

const COLUMN = {
  id: 'column-1',
  key: 'column-1',
  name: 'Value',
  type: 'string' as const,
  groupSize: 1,
  groupStartColIndex: 0,
  headerLabel: 'Value',
  isGroupStart: true,
}

const HANDLERS = {
  onRenameValueChange: vi.fn(),
  onRenameSubmit: vi.fn(),
  onRenameCancel: vi.fn(),
  onColumnSelect: vi.fn(),
  onInsertLeft: vi.fn(),
  onInsertRight: vi.fn(),
  onDeleteColumn: vi.fn(),
  onResizeStart: vi.fn(),
  onResize: vi.fn(),
  onResizeEnd: vi.fn(),
  onAutoResize: vi.fn(),
  onOpenConfig: vi.fn(),
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.replaceChildren()
})

describe('ColumnHeaderMenu resizing', () => {
  it('does not render a resize grip for a read-only virtual column', () => {
    const table = document.createElement('table')
    const row = document.createElement('tr')
    table.appendChild(row)
    document.body.appendChild(table)
    const root = createRoot(row)

    act(() => {
      root.render(
        <ColumnHeaderMenu
          column={COLUMN}
          colIndex={0}
          readOnly
          isRenaming={false}
          isColumnSelected={false}
          renameValue=''
          {...HANDLERS}
        />
      )
    })

    expect(row.querySelector('.cursor-col-resize')).toBeNull()
    act(() => root.unmount())
  })
})
