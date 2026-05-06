'use client'

import { useCallback, useReducer, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { useCancelTableRuns, useDeleteTable, useRunGroup } from '@/hooks/queries/tables'
import type { DeletedRowSnapshot } from '@/stores/table/types'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import { ImportCsvDialog } from '@/app/workspace/[workspaceId]/tables/components/import-csv-dialog'
import type { TableRow as TableRowType } from '@/lib/table'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { QueryOptions } from './types'
import {
  type ColumnConfig,
  ColumnConfigSidebar,
  ExecutionDetailsSidebar,
  RowModal,
  type SelectionSnapshot,
  Table,
  TableActionBar,
  type WorkflowConfig,
  WorkflowSidebar,
} from './components'
import { COLUMN_SIDEBAR_WIDTH } from './components/table/constants'
import { useTable } from './hooks'

interface TablesDetailProps {
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
 * `logs/logs.tsx`: a thin orchestrator that composes the data grid (`<Table>`)
 * and the page-level surface (sidebars, modals, action bar, breadcrumbs).
 *
 * Owns the at-most-one-open invariant for the three slideout panels (column
 * config, workflow config, execution details) via a single reducer. The grid
 * emits open requests via callbacks; the wrapper renders the panels.
 *
 * Embedded mode skips the page header but otherwise renders the same surface.
 */
export function TablesDetail({
  embedded,
  workspaceId: propWorkspaceId,
  tableId: propTableId,
}: TablesDetailProps = {}) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = propWorkspaceId || (params.workspaceId as string)
  const tableId = propTableId || (params.tableId as string)

  const [slideout, dispatch] = useReducer(slideoutReducer, { kind: 'none' })
  const [showDeleteTableConfirm, setShowDeleteTableConfirm] = useState(false)
  const [isImportCsvOpen, setIsImportCsvOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<TableRowType | null>(null)
  const [deletingRows, setDeletingRows] = useState<DeletedRowSnapshot[]>([])
  const [deletingColumns, setDeletingColumns] = useState<string[] | null>(null)
  const [selection, setSelection] = useState<SelectionSnapshot>({
    actionBarRowIds: [],
    runningInActionBarSelection: 0,
    hasWorkflowColumns: false,
  })
  const [queryOptions, setQueryOptions] = useState<QueryOptions>({ filter: null, sort: null })

  const userPermissions = useUserPermissionsContext()

  /**
   * Sink populated by the grid: invoked from sidebar `onColumnRename` so the
   * grid can rewrite its local `columnWidths` / `columnOrder` keys after a
   * rename. The grid's render assigns to `current`; the wrapper forwards calls.
   */
  const columnRenameSinkRef = useRef<((oldName: string, newName: string) => void) | null>(null)
  const onColumnRename = useCallback((oldName: string, newName: string) => {
    columnRenameSinkRef.current?.(oldName, newName)
  }, [])

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

  // Single source of truth for `useTable` — drives both the grid render and
  // the wrapper's slideouts/modals. The grid receives the bundle as props.
  const { tableData, columns, tableWorkflowGroups, workflows } = useTable({
    workspaceId,
    tableId,
    queryOptions,
  })
  const tableWorkflowGroupsRef = useRef(tableWorkflowGroups)
  tableWorkflowGroupsRef.current = tableWorkflowGroups

  const runGroupMutation = useRunGroup({ workspaceId, tableId })
  const cancelRunsMutation = useCancelTableRuns({ workspaceId, tableId })
  const runGroupMutate = runGroupMutation.mutate
  const cancelRunsMutate = cancelRunsMutation.mutate

  const onRunGroup = useCallback(
    (
      groupId: string,
      workflowId: string,
      runMode: 'all' | 'incomplete',
      rowIds?: string[]
    ) => {
      runGroupMutate({ groupId, workflowId, runMode, rowIds })
    },
    [runGroupMutate]
  )

  const onRunRows = useCallback(
    (rowIds: string[], runMode: 'all' | 'incomplete') => {
      const groups = tableWorkflowGroupsRef.current
      if (groups.length === 0 || rowIds.length === 0) return
      for (const group of groups) {
        runGroupMutate({
          groupId: group.id,
          workflowId: group.workflowId,
          runMode,
          rowIds,
        })
      }
    },
    [runGroupMutate]
  )

  const onStopRow = useCallback(
    (rowId: string) => {
      cancelRunsMutate({ scope: 'row', rowId })
    },
    [cancelRunsMutate]
  )

  const onStopRows = useCallback(
    (rowIds: string[]) => {
      if (rowIds.length === 0) return
      for (const rowId of rowIds) {
        cancelRunsMutate({ scope: 'row', rowId })
      }
    },
    [cancelRunsMutate]
  )

  const onStopAll = useCallback(() => {
    cancelRunsMutate({ scope: 'all' })
  }, [cancelRunsMutate])

  const onSelectionChange = useCallback((next: SelectionSnapshot) => {
    setSelection(next)
  }, [])

  const onQueryOptionsChange = useCallback(
    (next: QueryOptions | ((prev: QueryOptions) => QueryOptions)) => {
      setQueryOptions(next)
    },
    []
  )

  const logPanelWidth = useLogDetailsUIStore((state) => state.panelWidth)
  const sidebarReservedPx =
    slideout.kind === 'column' || slideout.kind === 'workflow'
      ? COLUMN_SIDEBAR_WIDTH
      : slideout.kind === 'execution'
        ? logPanelWidth
        : 0

  const onOpenColumnConfig = useCallback((config: ColumnConfig) => {
    dispatch({ type: 'OPEN_COLUMN', config })
  }, [])
  const onOpenWorkflowConfig = useCallback((config: WorkflowConfig) => {
    dispatch({ type: 'OPEN_WORKFLOW', config })
  }, [])
  const onOpenExecutionDetails = useCallback((executionId: string) => {
    dispatch({ type: 'OPEN_EXECUTION', executionId })
  }, [])
  const onCloseSlideout = useCallback(() => dispatch({ type: 'CLOSE' }), [])

  const onRequestDeleteTable = useCallback(() => setShowDeleteTableConfirm(true), [])
  const onRequestImportCsv = useCallback(() => setIsImportCsvOpen(true), [])
  const onOpenRowModal = useCallback((row: TableRowType) => setEditingRow(row), [])
  const onRequestDeleteRows = useCallback((snapshots: DeletedRowSnapshot[]) => {
    setDeletingRows(snapshots)
  }, [])
  const onRequestDeleteColumns = useCallback((names: string[]) => {
    setDeletingColumns(names)
  }, [])

  const deleteTableMutation = useDeleteTable(workspaceId)
  const handleDeleteTable = useCallback(async () => {
    try {
      await deleteTableMutation.mutateAsync(tableId)
      setShowDeleteTableConfirm(false)
      router.push(`/workspace/${workspaceId}/tables`)
    } catch {
      setShowDeleteTableConfirm(false)
    }
    // mutateAsync identity is stable in TanStack v5
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, router, workspaceId])

  const columnConfig = slideout.kind === 'column' ? slideout.config : null
  const workflowConfig = slideout.kind === 'workflow' ? slideout.config : null
  const executionId = slideout.kind === 'execution' ? slideout.executionId : null

  return (
    <>
      <Table
        workspaceId={workspaceId}
        tableId={tableId}
        embedded={embedded}
        sidebarReservedPx={sidebarReservedPx}
        onOpenColumnConfig={onOpenColumnConfig}
        onOpenWorkflowConfig={onOpenWorkflowConfig}
        onOpenExecutionDetails={onOpenExecutionDetails}
        onRequestDeleteTable={onRequestDeleteTable}
        onRequestImportCsv={onRequestImportCsv}
        onOpenRowModal={onOpenRowModal}
        onRequestDeleteRows={onRequestDeleteRows}
        onRequestDeleteColumns={onRequestDeleteColumns}
        onRunGroup={onRunGroup}
        onRunRows={onRunRows}
        onStopRows={onStopRows}
        onStopRow={onStopRow}
        onStopAll={onStopAll}
        cancelRunsPending={cancelRunsMutation.isPending}
        onSelectionChange={onSelectionChange}
        queryOptions={queryOptions}
        onQueryOptionsChange={onQueryOptionsChange}
        columnRenameSinkRef={columnRenameSinkRef}
        afterDeleteRowsSinkRef={afterDeleteRowsSinkRef}
        confirmDeleteColumnsSinkRef={confirmDeleteColumnsSinkRef}
      />
      {userPermissions.canEdit && (
        <TableActionBar
          selectedCount={selection.actionBarRowIds.length}
          runningCount={selection.runningInActionBarSelection}
          hasWorkflowColumns={selection.hasWorkflowColumns}
          onRun={() => onRunRows(selection.actionBarRowIds, 'incomplete')}
          onRerun={() => onRunRows(selection.actionBarRowIds, 'all')}
          onStopWorkflows={() => onStopRows(selection.actionBarRowIds)}
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
      <ExecutionDetailsSidebar
        workspaceId={workspaceId}
        executionId={executionId}
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
            <p className='text-[var(--text-secondary)]'>
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
            </p>
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
              <p className='text-[var(--text-secondary)]'>
                Are you sure you want to delete{' '}
                <span className='font-medium text-[var(--text-primary)]'>{tableData?.name}</span>?{' '}
                <span className='text-[var(--text-error)]'>
                  All {tableData?.rowCount ?? 0} rows will be removed.
                </span>{' '}
                You can restore it from Recently Deleted in Settings.
              </p>
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
    </>
  )
}
