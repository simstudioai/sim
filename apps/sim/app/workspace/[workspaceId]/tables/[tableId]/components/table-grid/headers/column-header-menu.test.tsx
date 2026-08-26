/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowGroup } from '@/lib/table'
import type { DisplayColumn } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/types'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('@sim/emcn/icons', () => ({
  ChevronDown: () => null,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/headers/column-type-icon',
  () => ({ ColumnTypeIcon: () => null })
)

vi.mock(
  '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/headers/header-label',
  () => ({ HeaderLabel: ({ label }: { label: string }) => <span>{label}</span> })
)

vi.mock(
  '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/headers/workflow-group-meta-cell',
  () => ({ ColumnOptionsMenu: () => null })
)

import { ColumnHeaderMenu } from '@/app/workspace/[workspaceId]/tables/[tableId]/components/table-grid/headers/column-header-menu'

let container: HTMLDivElement
let root: Root

const DEFAULT_COLUMN: DisplayColumn = {
  id: 'col-name',
  key: 'col-name',
  name: 'Name',
  type: 'string',
  groupSize: 1,
  groupStartColIndex: 0,
  headerLabel: 'Name',
  isGroupStart: true,
}

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

function renderHeader({
  column = DEFAULT_COLUMN,
  workflowGroups,
  onColumnSelect = vi.fn(),
  onOpenConfig = vi.fn(),
  onRenameColumn = vi.fn(),
}: {
  column?: DisplayColumn
  workflowGroups?: WorkflowGroup[]
  onColumnSelect?: (colIndex: number, shiftKey: boolean) => void
  onOpenConfig?: (columnName: string) => void
  onRenameColumn?: (columnName: string) => void
} = {}) {
  act(() => {
    root.render(
      <table>
        <thead>
          <tr>
            <ColumnHeaderMenu
              column={column}
              colIndex={2}
              isRenaming={false}
              isColumnSelected={false}
              renameValue=''
              onRenameValueChange={vi.fn()}
              onRenameSubmit={vi.fn()}
              onRenameCancel={vi.fn()}
              onColumnSelect={onColumnSelect}
              onInsertLeft={vi.fn()}
              onInsertRight={vi.fn()}
              onRenameColumn={onRenameColumn}
              onDeleteColumn={vi.fn()}
              onResizeStart={vi.fn()}
              onResize={vi.fn()}
              onResizeEnd={vi.fn()}
              onAutoResize={vi.fn()}
              onOpenConfig={onOpenConfig}
              workflowGroups={workflowGroups}
            />
          </tr>
        </thead>
      </table>
    )
  })

  const headerButton = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(column.workflowGroupId ? column.headerLabel : column.name)
  )
  if (!headerButton) throw new Error('Column header button was not rendered')
  return headerButton
}

describe('ColumnHeaderMenu interactions', () => {
  it('selects the column without opening configuration on a single click', () => {
    const onColumnSelect = vi.fn()
    const onOpenConfig = vi.fn()
    const onRenameColumn = vi.fn()
    const headerButton = renderHeader({ onColumnSelect, onOpenConfig, onRenameColumn })

    act(() => headerButton.click())

    expect(onColumnSelect).toHaveBeenCalledWith(2, false)
    expect(onOpenConfig).not.toHaveBeenCalled()
    expect(onRenameColumn).not.toHaveBeenCalled()
  })

  it('selects before starting inline rename on a double click', () => {
    const onColumnSelect = vi.fn()
    const onRenameColumn = vi.fn()
    const headerButton = renderHeader({ onColumnSelect, onRenameColumn })

    act(() => {
      headerButton.click()
      headerButton.click()
      headerButton.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    expect(onColumnSelect).toHaveBeenCalledTimes(2)
    expect(onRenameColumn).toHaveBeenCalledWith('col-name')
  })

  it('does not rename a workflow-output column on double click', () => {
    const onRenameColumn = vi.fn()
    const headerButton = renderHeader({
      column: { ...DEFAULT_COLUMN, workflowGroupId: 'workflow-group' },
      workflowGroups: [
        {
          id: 'workflow-group',
          workflowId: 'workflow-1',
          type: 'manual',
          outputs: [{ blockId: 'block-1', path: 'result', columnName: 'col-name' }],
        },
      ],
      onRenameColumn,
    })

    act(() => {
      headerButton.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    expect(onRenameColumn).not.toHaveBeenCalled()
  })

  it('renames an enrichment column on double click', () => {
    const onRenameColumn = vi.fn()
    const headerButton = renderHeader({
      column: { ...DEFAULT_COLUMN, workflowGroupId: 'enrichment-group' },
      workflowGroups: [
        {
          id: 'enrichment-group',
          workflowId: '',
          enrichmentId: 'company-domain',
          type: 'enrichment',
          outputs: [{ blockId: '', path: '', outputId: 'domain', columnName: 'col-name' }],
        },
      ],
      onRenameColumn,
    })

    act(() => {
      headerButton.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    expect(onRenameColumn).toHaveBeenCalledWith('col-name')
  })
})
