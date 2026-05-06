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
import { useDeleteTable } from '@/hooks/queries/tables'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import { ImportCsvDialog } from '@/app/workspace/[workspaceId]/tables/components/import-csv-dialog'
import {
  type ColumnConfig,
  ColumnConfigSidebar,
  ExecutionDetailsSidebar,
  Table,
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

  /**
   * Sink populated by the grid: invoked from sidebar `onColumnRename` so the
   * grid can rewrite its local `columnWidths` / `columnOrder` keys after a
   * rename. The grid's render assigns to `current`; the wrapper forwards calls.
   */
  const columnRenameSinkRef = useRef<((oldName: string, newName: string) => void) | null>(null)
  const onColumnRename = useCallback((oldName: string, newName: string) => {
    columnRenameSinkRef.current?.(oldName, newName)
  }, [])

  // Query data needed for the slideouts and modal copy. The grid also calls
  // `useTable`; React Query dedupes the request so this is one network call.
  // A future phase lifts the call entirely to the wrapper.
  const { tableData, columns, tableWorkflowGroups, workflows } = useTable({
    workspaceId,
    tableId,
    queryOptions: { filter: null, sort: null },
  })

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
        columnRenameSinkRef={columnRenameSinkRef}
      />
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
