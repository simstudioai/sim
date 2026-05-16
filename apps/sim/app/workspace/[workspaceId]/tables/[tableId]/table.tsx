'use client'

import { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  toast,
} from '@/components/emcn'
import { Download, Pencil, Table as TableIcon, Trash, Upload } from '@/components/emcn/icons'
import type { RunMode } from '@/lib/api/contracts/tables'
import type { ColumnDefinition, Filter, TableRow as TableRowType } from '@/lib/table'
import {
  type ColumnOption,
  ResourceHeader,
  ResourceOptionsBar,
  type SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import { LogDetails } from '@/app/workspace/[workspaceId]/logs/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ImportCsvDialog } from '@/app/workspace/[workspaceId]/tables/components/import-csv-dialog'
import { useLogByExecutionId } from '@/hooks/queries/logs'
import {
  downloadTableExport,
  useCancelTableRuns,
  useDeleteTable,
  useRenameTable,
  useRunColumn,
} from '@/hooks/queries/tables'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import type { DeletedRowSnapshot } from '@/stores/table/types'
import {
  type ColumnConfig,
  ColumnConfigSidebar,
  NewColumnDropdown,
  RowModal,
  RunStatusControl,
  type SelectionSnapshot,
  TableActionBar,
  TableFilter,
  TableGrid,
  type WorkflowConfig,
  WorkflowSidebar,
} from './components'
import { COLUMN_SIDEBAR_WIDTH } from './components/table-grid/constants'
import { COLUMN_TYPE_ICONS } from './components/table-grid/headers'
import { useTable, useTableEventStream } from './hooks'
import type { QueryOptions } from './types'
import { generateColumnName } from './utils'

const logger = createLogger('Table')

interface TableProps {
  /** When set, the table renders without its page header / breadcrumbs / page-level
   *  options bar. Used by the mothership chat panel to embed a table inline. */
  embedded?: boolean
  /** Identifiers — only set in embedded mode. Page mode reads from `useParams()`. */
  workspaceId?: string
  tableId?: string
}

/**
 * Discriminated union encoding the at-most-one-open invariant for the three
 * right-edge slideout panels. Driven by a `useReducer` so every transition
 * goes through one place — opening a column config can't accidentally leave a
 * workflow config open.
 */
type SlideoutState =
  | { kind: 'none' }
  | { kind: 'column'; config: ColumnConfig }
  | { kind: 'workflow'; config: WorkflowConfig }
  | { kind: 'execution'; executionId: string }

type SlideoutAction =
  | { type: 'OPEN_COLUMN'; config: ColumnConfig }
  | { type: 'OPEN_WORKFLOW'; config: WorkflowConfig }
  | { type: 'OPEN_EXECUTION'; executionId: string }
  | { type: 'CLOSE' }

function slideoutReducer(_state: SlideoutState, action: SlideoutAction): SlideoutState {
  switch (action.type) {
    case 'OPEN_COLUMN':
      return { kind: 'column', config: action.config }
    case 'OPEN_WORKFLOW':
      return { kind: 'workflow', config: action.config }
    case 'OPEN_EXECUTION':
      return { kind: 'execution', executionId: action.executionId }
    case 'CLOSE':
      return { kind: 'none' }
  }
}

/**
 * Page-level wrapper for the table detail view. Mirrors the shape of
 * `logs/logs.tsx`: a thin orchestrator that composes the data grid (`<TableGrid>`)
 * and the page-level surface (sidebars, modals, action bar, breadcrumbs).
 *
 * Owns the at-most-one-open invariant for the three slideout panels (column
 * config, workflow config, execution details) via a single reducer. The grid
 * emits open requests via callbacks; the wrapper renders the panels.
 *
 * Embedded mode skips the page header but otherwise renders the same surface.
 */
export function Table({
  embedded,
  workspaceId: propWorkspaceId,
  tableId: propTableId,
}: TableProps = {}) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = propWorkspaceId || (params.workspaceId as string)
  const tableId = propTableId || (params.tableId as string)

  useTableEventStream({ tableId, workspaceId })

  const [slideout, dispatch] = useReducer(slideoutReducer, { kind: 'none' })
  const [showDeleteTableConfirm, setShowDeleteTableConfirm] = useState(false)
  const [isImportCsvOpen, setIsImportCsvOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<TableRowType | null>(null)
  const [deletingRows, setDeletingRows] = useState<DeletedRowSnapshot[]>([])
  const [deletingColumns, setDeletingColumns] = useState<string[] | null>(null)
  const [selection, setSelection] = useState<SelectionSnapshot>({
    actionBarRowIds: [],
    runningInActionBarSelection: 0,
    totalRunning: 0,
    hasWorkflowColumns: false,
    selectedRunScope: null,
    selectionStats: { hasIncompleteOrFailed: false, hasCompleted: false, hasInFlight: false },
    singleWorkflowCell: null,
  })
  const [queryOptions, setQueryOptions] = useState<QueryOptions>({ filter: null, sort: null })
  const [filterOpen, setFilterOpen] = useState(false)

  const userPermissions = useUserPermissionsContext()

  const onOpenColumnConfig = useCallback((config: ColumnConfig) => {
    dispatch({ type: 'OPEN_COLUMN', config })
  }, [])
  const onOpenWorkflowConfig = useCallback((config: WorkflowConfig) => {
    dispatch({ type: 'OPEN_WORKFLOW', config })
  }, [])
  const onOpenExecutionDetails = useCallback((executionId: string) => {
    dispatch({ type: 'OPEN_EXECUTION', executionId })
  }, [])
  const onCloseSlideout = () => dispatch({ type: 'CLOSE' })
  const onOpenRowModal = (row: TableRowType) => setEditingRow(row)
  // useCallback because <ResourceHeader> is memo-wrapped — these flow into
  // the breadcrumbs / headerActions memos, whose identity drives that re-render.
  const onRequestDeleteTable = useCallback(() => setShowDeleteTableConfirm(true), [])
  const onRequestImportCsv = useCallback(() => setIsImportCsvOpen(true), [])
  // Used inside grid's `useCallback` deps — identity stability prevents the
  // grid's `useCallback` from re-creating on every wrapper re-render.
  const onRequestDeleteRows = useCallback((snapshots: DeletedRowSnapshot[]) => {
    setDeletingRows(snapshots)
  }, [])
  const onRequestDeleteColumns = useCallback((names: string[]) => {
    setDeletingColumns(names)
  }, [])

  /**
   * Sink populated by the grid: invoked from sidebar `onColumnRename` so the
   * grid can rewrite its local `columnWidths` / `columnOrder` keys after a
   * rename. The grid's render assigns to `current`; the wrapper forwards calls.
   */
  const columnRenameSinkRef = useRef<((oldName: string, newName: string) => void) | null>(null)
  const onColumnRename = (oldName: string, newName: string) => {
    columnRenameSinkRef.current?.(oldName, newName)
  }

  /**
   * Sink the grid populates with its post-row-delete cleanup (push undo,
   * clear selection). The wrapper invokes after the row-delete modal's
   * mutation succeeds.
   */
  const afterDeleteRowsSinkRef = useRef<((snapshots: DeletedRowSnapshot[]) => void) | null>(null)

  /**
   * Sink the grid populates with its full delete-columns cascade (per-column
   * mutation, undo push, columnOrder + columnWidths cleanup). The wrapper's
   * delete-columns confirmation modal invokes this on confirm.
   */
  const confirmDeleteColumnsSinkRef = useRef<((names: string[]) => void) | null>(null)

  /**
   * Sink the grid populates with its `pushUndo({ type: 'rename-table', ... })`
   * call so the wrapper's breadcrumb rename can register an undo entry on the
   * grid's undo stack.
   */
  const pushTableRenameUndoSinkRef = useRef<
    ((previousName: string, newName: string) => void) | null
  >(null)

  // Single source of truth for `useTable` — drives both the grid render and
  // the wrapper's slideouts/modals. The grid receives the bundle as props.
  const { tableData, columns, tableWorkflowGroups, workflows } = useTable({
    workspaceId,
    tableId,
    queryOptions,
  })

  const runColumnMutation = useRunColumn({ workspaceId, tableId })
  const cancelRunsMutation = useCancelTableRuns({ workspaceId, tableId })
  const runColumnMutate = runColumnMutation.mutate
  const cancelRunsMutate = cancelRunsMutation.mutate

  // Canonical run dispatcher. Every UI gesture (column-header menu, per-row
  // gutter, action-bar Play/Refresh, right-click context menu) reduces to a
  // (groupIds, rowIds?, runMode) triple. Empty groupIds = no-op.
  const runScope = useCallback(
    (args: { groupIds: string[]; rowIds?: string[]; runMode: RunMode }) => {
      if (args.groupIds.length === 0) return
      if (args.rowIds && args.rowIds.length === 0) return
      runColumnMutate(args)
    },
    [runColumnMutate]
  )

  const onRunColumn = useCallback(
    (groupId: string, runMode: RunMode, rowIds?: string[]) => {
      runScope({ groupIds: [groupId], rowIds, runMode })
    },
    [runScope]
  )

  const onRunRows = useCallback(
    (rowIds: string[], runMode: RunMode) => {
      runScope({ groupIds: tableWorkflowGroups.map((g) => g.id), rowIds, runMode })
    },
    [runScope, tableWorkflowGroups]
  )

  const onRunRow = useCallback(
    (rowId: string) => {
      runScope({
        groupIds: tableWorkflowGroups.map((g) => g.id),
        rowIds: [rowId],
        runMode: 'incomplete',
      })
    },
    [runScope, tableWorkflowGroups]
  )

  // useCallback because <DataRow> is React.memo-wrapped — identity stability
  // matters for per-row gutter Stop button.
  const onStopRow = useCallback(
    (rowId: string) => {
      cancelRunsMutate({ scope: 'row', rowId })
    },
    [cancelRunsMutate]
  )

  const onStopRows = (rowIds: string[]) => {
    if (rowIds.length === 0) return
    for (const rowId of rowIds) {
      cancelRunsMutate({ scope: 'row', rowId })
    }
  }

  // useCallback because <RunStatusControl> is memo-wrapped.
  const onStopAll = useCallback(() => {
    cancelRunsMutate({ scope: 'all' })
  }, [cancelRunsMutate])

  const onSelectionChange = (next: SelectionSnapshot) => {
    setSelection(next)
  }

  const renameTableMutation = useRenameTable(workspaceId)
  const tableDataRef = useRef(tableData)
  tableDataRef.current = tableData
  const tableHeaderRename = useInlineRename({
    onSave: (_id, name) => {
      const data = tableDataRef.current
      if (data) pushTableRenameUndoSinkRef.current?.(data.name, name)
      renameTableMutation.mutate({ tableId, name })
    },
  })

  const handleNavigateBack = useCallback(() => {
    router.push(`/workspace/${workspaceId}/tables`)
  }, [router, workspaceId])

  const handleStartTableRename = useCallback(() => {
    const data = tableDataRef.current
    if (data) tableHeaderRename.startRename(tableId, data.name)
  }, [tableHeaderRename.startRename, tableId])

  const handleAddColumnOfType = (type: ColumnDefinition['type']) => {
    onOpenColumnConfig({ mode: 'create', proposedName: generateColumnName(columns), type })
  }

  const handleAddWorkflowColumn = () => {
    onOpenWorkflowConfig({ mode: 'create', proposedName: generateColumnName(columns) })
  }

  const handleExportCsv = useCallback(async () => {
    if (!tableData) return
    try {
      await downloadTableExport(tableData.id, tableData.name)
    } catch (err) {
      logger.error('Failed to export table:', err)
      toast.error('Failed to export table')
    }
  }, [tableData])

  const columnOptions = useMemo<ColumnOption[]>(
    () =>
      columns.map((col) => ({
        id: col.name,
        label: col.name,
        type: col.type,
        icon: COLUMN_TYPE_ICONS[col.type],
      })),
    [columns]
  )

  const sortConfig = useMemo<SortConfig>(() => {
    let active: SortConfig['active'] = null
    if (queryOptions.sort) {
      const entries = Object.entries(queryOptions.sort)
      if (entries.length > 0) {
        const [column, direction] = entries[0]
        active = { column, direction }
      }
    }
    return {
      options: columnOptions,
      active,
      onSort: (column, direction) =>
        setQueryOptions((prev) => ({ ...prev, sort: { [column]: direction } })),
      onClear: () => setQueryOptions((prev) => ({ ...prev, sort: null })),
    }
  }, [columnOptions, queryOptions.sort])

  const handleFilterApply = (filter: Filter | null) => {
    setQueryOptions((prev) => ({ ...prev, filter }))
  }

  const breadcrumbs = useMemo(
    () => [
      { label: 'Tables', onClick: handleNavigateBack },
      {
        label: tableData?.name ?? '',
        editing: tableHeaderRename.editingId
          ? {
              isEditing: true,
              value: tableHeaderRename.editValue,
              onChange: tableHeaderRename.setEditValue,
              onSubmit: tableHeaderRename.submitRename,
              onCancel: tableHeaderRename.cancelRename,
            }
          : undefined,
        dropdownItems: [
          {
            label: 'Rename',
            icon: Pencil,
            disabled: !tableData,
            onClick: handleStartTableRename,
          },
          {
            label: 'Delete',
            icon: Trash,
            disabled: !tableData,
            onClick: onRequestDeleteTable,
          },
        ],
      },
    ],
    [
      handleNavigateBack,
      tableData,
      tableHeaderRename.editingId,
      tableHeaderRename.editValue,
      tableHeaderRename.setEditValue,
      tableHeaderRename.submitRename,
      tableHeaderRename.cancelRename,
      handleStartTableRename,
      onRequestDeleteTable,
    ]
  )

  const headerActions = useMemo(
    () =>
      tableData
        ? [
            {
              label: 'Import CSV',
              icon: Upload,
              onClick: onRequestImportCsv,
              disabled: userPermissions.canEdit !== true,
            },
            {
              label: 'Export CSV',
              icon: Download,
              onClick: () => void handleExportCsv(),
              disabled: tableData.rowCount === 0,
            },
          ]
        : undefined,
    [tableData, userPermissions.canEdit, handleExportCsv, onRequestImportCsv]
  )

  const createTrigger = userPermissions.canEdit ? (
    <NewColumnDropdown
      trigger='header'
      disabled={false}
      onPickType={handleAddColumnOfType}
      onPickWorkflow={handleAddWorkflowColumn}
    />
  ) : null

  const logPanelWidth = useLogDetailsUIStore((state) => state.panelWidth)
  const sidebarReservedPx =
    slideout.kind === 'column' || slideout.kind === 'workflow'
      ? COLUMN_SIDEBAR_WIDTH
      : slideout.kind === 'execution'
        ? logPanelWidth
        : 0

  const deleteTableMutation = useDeleteTable(workspaceId)
  const handleDeleteTable = async () => {
    try {
      await deleteTableMutation.mutateAsync(tableId)
      setShowDeleteTableConfirm(false)
      router.push(`/workspace/${workspaceId}/tables`)
    } catch {
      setShowDeleteTableConfirm(false)
    }
  }

  const columnConfig = slideout.kind === 'column' ? slideout.config : null
  const workflowConfig = slideout.kind === 'workflow' ? slideout.config : null
  const executionId = slideout.kind === 'execution' ? slideout.executionId : null
  // Fetch the workflow log when the execution-details slideout is open. Reuses
  // the logs page's <LogDetails> directly — no intermediate wrapper needed for
  // a one-line query forward.
  const { data: executionLog } = useLogByExecutionId(workspaceId, executionId)

  return (
    <div className='relative flex h-full flex-col overflow-hidden'>
      {!embedded && (
        <>
          <ResourceHeader
            icon={TableIcon}
            breadcrumbs={breadcrumbs}
            createTrigger={createTrigger}
            actions={headerActions}
            leadingActions={
              selection.totalRunning > 0 ? (
                <RunStatusControl
                  running={selection.totalRunning}
                  onStopAll={onStopAll}
                  isStopping={cancelRunsMutation.isPending}
                />
              ) : null
            }
          />
          <ResourceOptionsBar
            sort={sortConfig}
            onFilterToggle={() => setFilterOpen((prev) => !prev)}
            filterActive={filterOpen || !!queryOptions.filter}
          />
          {filterOpen && (
            <TableFilter
              columns={columns}
              filter={queryOptions.filter}
              onApply={handleFilterApply}
              onClose={() => setFilterOpen(false)}
            />
          )}
        </>
      )}
      <TableGrid
        workspaceId={workspaceId}
        tableId={tableId}
        embedded={embedded}
        sidebarReservedPx={sidebarReservedPx}
        onOpenColumnConfig={onOpenColumnConfig}
        onOpenWorkflowConfig={onOpenWorkflowConfig}
        onOpenExecutionDetails={onOpenExecutionDetails}
        onOpenRowModal={onOpenRowModal}
        onRequestDeleteRows={onRequestDeleteRows}
        onRequestDeleteColumns={onRequestDeleteColumns}
        onRunColumn={onRunColumn}
        onRunRow={onRunRow}
        onRunRows={onRunRows}
        onStopRows={onStopRows}
        onStopRow={onStopRow}
        onStopAll={onStopAll}
        cancelRunsPending={cancelRunsMutation.isPending}
        onSelectionChange={onSelectionChange}
        queryOptions={queryOptions}
        columnRenameSinkRef={columnRenameSinkRef}
        afterDeleteRowsSinkRef={afterDeleteRowsSinkRef}
        confirmDeleteColumnsSinkRef={confirmDeleteColumnsSinkRef}
        pushTableRenameUndoSinkRef={pushTableRenameUndoSinkRef}
      />
      {userPermissions.canEdit && (
        <TableActionBar
          selectedCellCount={
            selection.selectedRunScope
              ? selection.selectedRunScope.groupIds.length *
                selection.selectedRunScope.rowIds.length
              : 0
          }
          runningCount={selection.runningInActionBarSelection}
          hasWorkflowColumns={selection.hasWorkflowColumns}
          showPlay={selection.selectionStats.hasIncompleteOrFailed}
          showRefresh={selection.selectionStats.hasCompleted}
          onPlay={() => {
            const scope = selection.selectedRunScope
            if (!scope) return
            runScope({
              groupIds: scope.groupIds,
              rowIds: scope.allRows ? undefined : scope.rowIds,
              runMode: 'incomplete',
            })
          }}
          onRefresh={() => {
            const scope = selection.selectedRunScope
            if (!scope) return
            runScope({
              groupIds: scope.groupIds,
              rowIds: scope.allRows ? undefined : scope.rowIds,
              runMode: 'all',
            })
          }}
          onStopWorkflows={() => {
            const scope = selection.selectedRunScope
            if (!scope) return
            scope.allRows ? onStopAll() : onStopRows(scope.rowIds)
          }}
          onViewExecution={
            selection.singleWorkflowCell?.canViewExecution &&
            selection.singleWorkflowCell.executionId
              ? () => {
                  const id = selection.singleWorkflowCell?.executionId
                  if (id) onOpenExecutionDetails(id)
                }
              : undefined
          }
        />
      )}
      <ColumnConfigSidebar
        config={columnConfig}
        onClose={onCloseSlideout}
        existingColumn={
          columnConfig?.mode === 'edit'
            ? (columns.find((c) => c.name === columnConfig.columnName) ?? null)
            : null
        }
        workspaceId={workspaceId}
        tableId={tableId}
        onColumnRename={onColumnRename}
      />
      <WorkflowSidebar
        config={workflowConfig}
        onClose={onCloseSlideout}
        allColumns={columns}
        workflowGroups={tableWorkflowGroups}
        workflows={workflows}
        workspaceId={workspaceId}
        tableId={tableId}
        onColumnRename={onColumnRename}
      />
      <LogDetails
        log={executionLog ?? null}
        isOpen={Boolean(executionId)}
        onClose={onCloseSlideout}
      />
      {tableData && (
        <ImportCsvDialog
          open={isImportCsvOpen}
          onOpenChange={setIsImportCsvOpen}
          workspaceId={workspaceId}
          table={tableData}
        />
      )}
      {editingRow && tableData && (
        <RowModal
          mode='edit'
          isOpen={true}
          onClose={() => setEditingRow(null)}
          table={tableData}
          row={editingRow}
          onSuccess={() => setEditingRow(null)}
        />
      )}
      {deletingRows.length > 0 && tableData && (
        <RowModal
          mode='delete'
          isOpen={true}
          onClose={() => setDeletingRows([])}
          table={tableData}
          rowIds={deletingRows.map((r) => r.rowId)}
          onSuccess={() => {
            afterDeleteRowsSinkRef.current?.(deletingRows)
            setDeletingRows([])
          }}
        />
      )}
      <Modal
        open={deletingColumns !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingColumns(null)
        }}
      >
        <ModalContent size='sm'>
          <ModalHeader>
            {deletingColumns && deletingColumns.length > 1
              ? `Delete ${deletingColumns.length} Columns`
              : 'Delete Column'}
          </ModalHeader>
          <ModalBody>
            <ModalDescription className='text-[var(--text-secondary)]'>
              {deletingColumns && deletingColumns.length > 1 ? (
                <>
                  Are you sure you want to delete{' '}
                  <span className='font-medium text-[var(--text-primary)]'>
                    {deletingColumns.length} columns
                  </span>
                  ?{' '}
                </>
              ) : (
                <>
                  Are you sure you want to delete{' '}
                  <span className='font-medium text-[var(--text-primary)]'>
                    {deletingColumns?.[0]}
                  </span>
                  ?{' '}
                </>
              )}
              <span className='text-[var(--text-error)]'>
                This will remove all data in{' '}
                {deletingColumns && deletingColumns.length > 1 ? 'these columns' : 'this column'}.
              </span>{' '}
              You can undo this action.
            </ModalDescription>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setDeletingColumns(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                if (!deletingColumns) return
                const names = deletingColumns
                setDeletingColumns(null)
                confirmDeleteColumnsSinkRef.current?.(names)
              }}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {!embedded && (
        <Modal open={showDeleteTableConfirm} onOpenChange={setShowDeleteTableConfirm}>
          <ModalContent size='sm'>
            <ModalHeader>Delete Table</ModalHeader>
            <ModalBody>
              <ModalDescription className='text-[var(--text-secondary)]'>
                Are you sure you want to delete{' '}
                <span className='font-medium text-[var(--text-primary)]'>{tableData?.name}</span>?{' '}
                <span className='text-[var(--text-error)]'>
                  All {tableData?.rowCount ?? 0} rows will be removed.
                </span>{' '}
                You can restore it from Recently Deleted in Settings.
              </ModalDescription>
            </ModalBody>
            <ModalFooter>
              <Button
                variant='default'
                onClick={() => setShowDeleteTableConfirm(false)}
                disabled={deleteTableMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={handleDeleteTable}
                disabled={deleteTableMutation.isPending}
              >
                {deleteTableMutation.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </div>
  )
}
