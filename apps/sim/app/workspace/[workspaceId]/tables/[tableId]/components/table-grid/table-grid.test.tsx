/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBlockedAction, mockToastError, mockUseTable } = vi.hoisted(() => ({
  mockBlockedAction: vi.fn(),
  mockToastError: vi.fn(),
  mockUseTable: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useParams: () => ({}) }))
vi.mock('posthog-js/react', () => ({ usePostHog: () => null }))
vi.mock('@sim/emcn', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  toast: { error: mockToastError },
  useToast: () => ({ dismiss: vi.fn() }),
}))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    options: { scrollMargin: 0 },
    getVirtualItems: () => [{ index: 0, key: 'row-1', start: 0, end: 35, size: 35 }],
    getTotalSize: () => 35,
    measure: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: true }),
}))
vi.mock('@/hooks/queries/general-settings', () => ({ useTimezone: () => 'UTC' }))
vi.mock('@/hooks/use-inline-rename', () => ({ useInlineRename: () => ({}) }))
vi.mock('@/hooks/use-table-undo', () => ({
  extractCreatedRowId: vi.fn(),
  useTableUndo: () => ({ pushUndo: vi.fn() }),
}))
vi.mock('@/hooks/queries/tables', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    useAddTableColumn: mutation,
    useBatchCreateTableRows: mutation,
    useBatchUpdateTableRows: mutation,
    useCreateTableRow: mutation,
    useDeleteColumn: mutation,
    useDeleteWorkflowGroup: mutation,
    useFindTableRows: () => ({ data: undefined, isFetching: false }),
    useTableRunState: () => ({ data: undefined }),
    useUpdateColumn: mutation,
    useUpdateTableMetadata: mutation,
    useUpdateTableRow: mutation,
    useUpdateWorkflowGroup: mutation,
  }
})
vi.mock('../../hooks', () => ({
  useContextMenu: () => ({
    contextMenu: {
      isOpen: false,
      position: { x: 0, y: 0 },
      row: null,
      rowIndex: null,
      columnName: null,
    },
    handleRowContextMenu: vi.fn(),
    handleEmptyCellContextMenu: vi.fn(),
    closeContextMenu: vi.fn(),
  }),
  useTable: mockUseTable,
}))
vi.mock('../context-menu', () => ({ ContextMenu: () => null }))
vi.mock('../new-column-dropdown', () => ({
  NewColumnDropdown: () => <th data-testid='new-column' />,
}))
vi.mock('./headers', () => ({ ColumnHeaderMenu: () => null, WorkflowGroupMetaCell: () => null }))
vi.mock('./table-find', () => ({ TableFind: () => null }))
vi.mock('./table-primitives', () => ({
  AddRowButton: () => null,
  SelectAllCheckbox: () => null,
  TableColGroup: () => null,
}))
vi.mock('./data-row', () => ({
  DataRow: ({
    onDoubleClick,
  }: {
    onDoubleClick: (rowId: string, name: string, key: string) => void
  }) => (
    <tr>
      <td data-testid='cell' onDoubleClick={() => onDoubleClick('row-1', 'value', 'value')}>
        Cell
      </td>
    </tr>
  ),
}))
vi.mock('./cells', () => ({
  ExpandedCellPopover: ({ expandedCell }: { expandedCell: { rowId: string } | null }) =>
    expandedCell ? <div data-testid='expanded-cell'>{expandedCell.rowId}</div> : null,
}))

import { TableGrid } from './table-grid'

function createUseTableResult(rowsError: Error | null = null) {
  return {
    tableData: {
      id: 'virtual-table',
      workspaceId: 'workspace-1',
      isVirtual: true,
      rowCount: 1,
      schema: { columns: [{ id: 'column-1', key: 'value', name: 'Value', type: 'text' }] },
      metadata: {},
    },
    isLoadingTable: false,
    rows: rowsError ? [] : [{ id: 'row-1', data: { value: 'Visible contents' } }],
    rowsError,
    rowTotal: 1,
    isLoadingRows: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    workflows: [],
    columns: [{ id: 'column-1', key: 'value', name: 'Value', type: 'text' }],
    tableWorkflowGroups: [],
    workflowStates: new Map(),
    columnSourceInfo: new Map(),
    ensureAllRowsLoaded: vi.fn(),
    ensureRowsLoadedUpTo: vi.fn(),
    refetchRows: vi.fn(),
    filter: null,
  }
}

describe('TableGrid virtual cells', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    mockUseTable.mockReturnValue(createUseTableResult())
  })

  it('opens the read-only viewer instead of showing a lock warning', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <TableGrid
          workspaceId='workspace-1'
          tableId='virtual-table'
          remoteSelections={[]}
          emitCellSelection={vi.fn()}
          locks={{
            schemaLocked: true,
            insertLocked: true,
            updateLocked: true,
            deleteLocked: true,
          }}
          onBlockedAction={mockBlockedAction}
          sidebarReservedPx={0}
          onOpenColumnConfig={vi.fn()}
          onOpenWorkflowConfig={vi.fn()}
          onOpenEnrichments={vi.fn()}
          onOpenEnrichmentConfig={vi.fn()}
          onOpenExecutionDetails={vi.fn()}
          onOpenEnrichmentDetails={vi.fn()}
          onOpenRowModal={vi.fn()}
          onRequestDeleteRows={vi.fn()}
          onRequestDeleteAllByFilter={vi.fn()}
          onRequestDeleteColumns={vi.fn()}
          onRunColumn={vi.fn()}
          onRunRow={vi.fn()}
          onRunRows={vi.fn()}
          onStopRows={vi.fn()}
          onStopAllRows={vi.fn()}
          onStopRow={vi.fn()}
          onSelectionChange={vi.fn()}
          queryOptions={{}}
          columnRenameSinkRef={{ current: null }}
          afterDeleteRowsSinkRef={{ current: null }}
          afterDeleteAllSinkRef={{ current: null }}
          confirmDeleteColumnsSinkRef={{ current: null }}
          pushTableRenameUndoSinkRef={{ current: null }}
        />
      )
    })

    const cell = container.querySelector<HTMLElement>('[data-testid="cell"]')
    expect(cell).not.toBeNull()
    expect(container.querySelector('[data-testid="new-column"]')).toBeNull()
    act(() => {
      cell?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    expect(container.querySelector('[data-testid="expanded-cell"]')?.textContent).toBe('row-1')
    expect(mockBlockedAction).not.toHaveBeenCalled()

    act(() => root.unmount())
    container.remove()
  })

  it('shows row-query failures instead of presenting an empty result', () => {
    const rowsError = new Error('Transcript filtering and sorting are not supported for this table')
    mockUseTable.mockReturnValue(createUseTableResult(rowsError))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <TableGrid
          workspaceId='workspace-1'
          tableId='virtual-table'
          remoteSelections={[]}
          emitCellSelection={vi.fn()}
          locks={{
            schemaLocked: true,
            insertLocked: true,
            updateLocked: true,
            deleteLocked: true,
          }}
          onBlockedAction={mockBlockedAction}
          sidebarReservedPx={0}
          onOpenColumnConfig={vi.fn()}
          onOpenWorkflowConfig={vi.fn()}
          onOpenEnrichments={vi.fn()}
          onOpenEnrichmentConfig={vi.fn()}
          onOpenExecutionDetails={vi.fn()}
          onOpenEnrichmentDetails={vi.fn()}
          onOpenRowModal={vi.fn()}
          onRequestDeleteRows={vi.fn()}
          onRequestDeleteAllByFilter={vi.fn()}
          onRequestDeleteColumns={vi.fn()}
          onRunColumn={vi.fn()}
          onRunRow={vi.fn()}
          onRunRows={vi.fn()}
          onStopRows={vi.fn()}
          onStopAllRows={vi.fn()}
          onStopRow={vi.fn()}
          onSelectionChange={vi.fn()}
          queryOptions={{}}
          columnRenameSinkRef={{ current: null }}
          afterDeleteRowsSinkRef={{ current: null }}
          afterDeleteAllSinkRef={{ current: null }}
          confirmDeleteColumnsSinkRef={{ current: null }}
          pushTableRenameUndoSinkRef={{ current: null }}
        />
      )
    })

    expect(mockToastError).toHaveBeenCalledWith(rowsError.message, { duration: 5000 })

    act(() => root.unmount())
    container.remove()
  })
})
