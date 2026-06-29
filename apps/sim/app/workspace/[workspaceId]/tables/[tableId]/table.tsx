'use client'

import { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQueryStates } from 'nuqs'
import { usePostHog } from 'posthog-js/react'
import { Chip, ChipConfirmModal, toast } from '@/components/emcn'
import { Download, Pencil, Table as TableIcon, Trash, Upload } from '@/components/emcn/icons'
import type { RunLimit, RunMode } from '@/lib/api/contracts/tables'
import { captureEvent } from '@/lib/posthog/client'
import type {
  ColumnDefinition,
  Filter,
  Sort,
  TableRow as TableRowType,
  WorkflowGroup,
} from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'
import { TABLE_LIMITS } from '@/lib/table/constants'
import {
  type BreadcrumbItem,
  type ColumnOption,
  Resource,
  type SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import { LogDetails } from '@/app/workspace/[workspaceId]/logs/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ImportCsvDialog } from '@/app/workspace/[workspaceId]/tables/components/import-csv-dialog'
import { ImportProgressMenu } from '@/app/workspace/[workspaceId]/tables/components/import-progress-menu'
import { useLogByExecutionId } from '@/hooks/queries/logs'
import {
  downloadTableExport,
  useCancelTableRuns,
  useDeleteTable,
  useDeleteTableRowsAsync,
  useExportTableAsync,
  useRenameTable,
  useRunColumn,
} from '@/hooks/queries/tables'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import type { DeletedRowSnapshot } from '@/stores/table/types'
import {
  type ColumnConfig,
  ColumnConfigSidebar,
  EnrichmentDetails,
  EnrichmentsSidebar,
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
import {
  DEFAULT_TABLE_DETAIL_SORT_DIRECTION,
  tableDetailParsers,
  tableDetailUrlKeys,
} from './search-params'
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
  | { kind: 'enrichments'; editGroup?: WorkflowGroup }
  | { kind: 'workflow'; config: WorkflowConfig }
  | { kind: 'execution'; executionId: string }
  | { kind: 'enrichment-details'; rowId: string; groupId: string }

type SlideoutAction =
  | { type: 'OPEN_COLUMN'; config: ColumnConfig }
  | { type: 'OPEN_ENRICHMENTS'; editGroup?: WorkflowGroup }
  | { type: 'OPEN_WORKFLOW'; config: WorkflowConfig }
  | { type: 'OPEN_EXECUTION'; executionId: string }
  | { type: 'OPEN_ENRICHMENT_DETAILS'; rowId: string; groupId: string }
  | { type: 'CLOSE' }

function slideoutReducer(_state: SlideoutState, action: SlideoutAction): SlideoutState {
  switch (action.type) {
    case 'OPEN_COLUMN':
      return { kind: 'column', config: action.config }
    case 'OPEN_ENRICHMENTS':
      return { kind: 'enrichments', editGroup: action.editGroup }
    case 'OPEN_WORKFLOW':
      return { kind: 'workflow', config: action.config }
    case 'OPEN_EXECUTION':
      return { kind: 'execution', executionId: action.executionId }
    case 'OPEN_ENRICHMENT_DETAILS':
      return { kind: 'enrichment-details', rowId: action.rowId, groupId: action.groupId }
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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const params = useParams()
  const router = useRouter()
  const workspaceId = propWorkspaceId || (params.workspaceId as string)
  const tableId = propTableId || (params.tableId as string)

  const posthog = usePostHog()
  const posthogRef = useRef(posthog)
  posthogRef.current = posthog

  const { navigateToSettings } = useSettingsNavigation()
  // Plain function: `useTableEventStream` keeps it in a ref (its effect doesn't
  // depend on the identity), so a stable reference buys nothing here.
  const onUsageLimitReached = ({ message }: { dispatchId?: string; message: string }) => {
    toast.error(message, {
      action: { label: 'Upgrade', onClick: () => navigateToSettings({ section: 'billing' }) },
    })
  }
  useTableEventStream({ tableId, workspaceId, onUsageLimitReached })

  const [slideout, dispatch] = useReducer(slideoutReducer, { kind: 'none' })
  const [showDeleteTableConfirm, setShowDeleteTableConfirm] = useState(false)
  const [isImportCsvOpen, setIsImportCsvOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<TableRowType | null>(null)
  const [deletingRows, setDeletingRows] = useState<DeletedRowSnapshot[]>([])
  const [deletingAll, setDeletingAll] = useState<{
    excludeRowIds: string[]
    estimatedCount: number
  } | null>(null)
  const [deletingColumns, setDeletingColumns] = useState<string[] | null>(null)
  const [selection, setSelection] = useState<SelectionSnapshot>({
    actionBarRowIds: [],
    runningInActionBarSelection: 0,
    totalRunning: 0,
    hasActiveDispatch: false,
    hasWorkflowColumns: false,
    selectedRunScope: null,
    selectionStats: { hasIncompleteOrFailed: false, hasCompleted: false, hasInFlight: false },
    singleWorkflowCell: null,
  })
  const [filter, setFilter] = useState<Filter | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)

  const [{ sort: sortColumn, dir: sortDirection }, setSortParams] = useQueryStates(
    tableDetailParsers,
    tableDetailUrlKeys
  )

  /** Resolved single-column sort, or `null` when no column is active. */
  const sortQuery = useMemo<Sort | null>(
    () => (sortColumn ? { [sortColumn]: sortDirection } : null),
    [sortColumn, sortDirection]
  )

  const queryOptions = useMemo<QueryOptions>(
    () => ({ filter, sort: sortQuery }),
    [filter, sortQuery]
  )

  const userPermissions = useUserPermissionsContext()

  const onOpenColumnConfig = useCallback((config: ColumnConfig) => {
    dispatch({ type: 'OPEN_COLUMN', config })
  }, [])
  const onOpenWorkflowConfig = useCallback((config: WorkflowConfig) => {
    dispatch({ type: 'OPEN_WORKFLOW', config })
  }, [])
  const onOpenEnrichments = useCallback(() => {
    dispatch({ type: 'OPEN_ENRICHMENTS' })
  }, [])
  const onOpenEnrichmentConfig = useCallback((editGroup: WorkflowGroup) => {
    dispatch({ type: 'OPEN_ENRICHMENTS', editGroup })
  }, [])
  const onOpenExecutionDetails = useCallback((executionId: string) => {
    dispatch({ type: 'OPEN_EXECUTION', executionId })
  }, [])
  const onOpenEnrichmentDetails = useCallback((rowId: string, groupId: string) => {
    dispatch({ type: 'OPEN_ENRICHMENT_DETAILS', rowId, groupId })
  }, [])
  const onCloseSlideout = () => dispatch({ type: 'CLOSE' })
  const onOpenRowModal = (row: TableRowType) => setEditingRow(row)
  // useCallback because <Resource.Header> is memo-wrapped — these flow into
  // the breadcrumbs / headerActions memos, whose identity drives that re-render.
  const onRequestDeleteTable = useCallback(() => setShowDeleteTableConfirm(true), [])
  const onRequestImportCsv = useCallback(() => setIsImportCsvOpen(true), [])
  // Used inside grid's `useCallback` deps — identity stability prevents the
  // grid's `useCallback` from re-creating on every wrapper re-render.
  const onRequestDeleteRows = useCallback((snapshots: DeletedRowSnapshot[]) => {
    setDeletingRows(snapshots)
  }, [])
  const onRequestDeleteAllByFilter = useCallback(
    (params: { excludeRowIds: string[]; estimatedCount: number }) => {
      setDeletingAll(params)
    },
    []
  )
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

  /** Sink the grid populates with its post-select-all-delete cleanup (clear selection). */
  const afterDeleteAllSinkRef = useRef<(() => void) | null>(null)

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
    (args: {
      groupIds: string[]
      rowIds?: string[]
      filter?: Filter
      excludeRowIds?: string[]
      runMode: RunMode
      limit?: RunLimit
      source: 'row' | 'rows' | 'column'
    }) => {
      const { source, ...mutateArgs } = args
      if (mutateArgs.groupIds.length === 0) return
      if (mutateArgs.rowIds && mutateArgs.rowIds.length === 0) return
      runColumnMutate(mutateArgs)
      // Derive the run's deployment mode from the targeted groups (default 'live' when unset).
      // 'mixed' when the targeted groups don't all agree.
      const targetGroupIds = new Set(mutateArgs.groupIds)
      const modes = new Set(
        tableWorkflowGroups
          .filter((g) => targetGroupIds.has(g.id))
          .map((g) => g.deploymentMode ?? 'live')
      )
      const deploymentMode = modes.size === 1 ? [...modes][0] : 'mixed'
      captureEvent(posthogRef.current, 'table_workflow_run', {
        table_id: tableId,
        workspace_id: workspaceId,
        source,
        run_mode: mutateArgs.runMode,
        group_count: mutateArgs.groupIds.length,
        row_count: mutateArgs.rowIds?.length ?? null,
        has_limit: mutateArgs.limit != null,
        deployment_mode: deploymentMode,
      })
    },
    [runColumnMutate, tableId, workspaceId, tableWorkflowGroups]
  )

  const onRunColumn = useCallback(
    (
      groupId: string,
      runMode: RunMode,
      rowIds?: string[],
      limit?: RunLimit,
      filter?: Filter,
      excludeRowIds?: string[]
    ) => {
      runScope({
        groupIds: [groupId],
        rowIds,
        filter,
        excludeRowIds,
        runMode,
        limit,
        source: 'column',
      })
    },
    [runScope]
  )

  const onRunRows = useCallback(
    (rowIds: string[] | undefined, runMode: RunMode, filter?: Filter, excludeRowIds?: string[]) => {
      runScope({
        groupIds: tableWorkflowGroups.map((g) => g.id),
        rowIds,
        filter,
        excludeRowIds,
        runMode,
        source: 'rows',
      })
    },
    [runScope, tableWorkflowGroups]
  )

  const onRunRow = useCallback(
    (rowId: string) => {
      runScope({
        groupIds: tableWorkflowGroups.map((g) => g.id),
        rowIds: [rowId],
        runMode: 'incomplete',
        source: 'row',
      })
    },
    [runScope, tableWorkflowGroups]
  )

  // useCallback because <DataRow> is React.memo-wrapped — identity stability
  // matters for per-row gutter Stop button.
  const onStopRow = useCallback(
    (rowId: string) => {
      cancelRunsMutate({ scope: 'row', rowId })
      captureEvent(posthogRef.current, 'table_workflow_stopped', {
        table_id: tableId,
        workspace_id: workspaceId,
        scope: 'row',
        row_count: 1,
      })
    },
    [cancelRunsMutate, tableId, workspaceId]
  )

  const onStopRows = (rowIds: string[]) => {
    if (rowIds.length === 0) return
    for (const rowId of rowIds) {
      cancelRunsMutate({ scope: 'row', rowId })
    }
    captureEvent(posthogRef.current, 'table_workflow_stopped', {
      table_id: tableId,
      workspace_id: workspaceId,
      scope: 'rows',
      row_count: rowIds.length,
    })
  }

  // useCallback because <RunStatusControl> is memo-wrapped. Zero-arg on
  // purpose — RunStatusControl passes it straight to onClick, which would
  // otherwise leak the MouseEvent into `filter`.
  const onStopAll = useCallback(() => {
    cancelRunsMutate({ scope: 'all' })
    captureEvent(posthogRef.current, 'table_workflow_stopped', {
      table_id: tableId,
      workspace_id: workspaceId,
      scope: 'all',
      row_count: null,
    })
  }, [cancelRunsMutate, tableId, workspaceId])

  /** Select-all Stop — filter-scoped when a filter is active; deselected rows keep running. */
  const onStopAllRows = useCallback(
    (filter?: Filter, excludeRowIds?: string[]) => {
      // `sort` scopes the optimistic flip to the active view's cache (filtered stops
      // only cancel matching rows server-side).
      cancelRunsMutate({ scope: 'all', filter, sort: queryOptions.sort, excludeRowIds })
      captureEvent(posthogRef.current, 'table_workflow_stopped', {
        table_id: tableId,
        workspace_id: workspaceId,
        scope: 'all',
        row_count: null,
      })
    },
    [cancelRunsMutate, tableId, workspaceId, queryOptions.sort]
  )

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
      return renameTableMutation.mutateAsync({ tableId, name })
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
    onOpenWorkflowConfig({
      mode: 'create',
      kind: 'manual',
      proposedName: generateColumnName(columns),
    })
  }

  const handleExportCsv = useCallback(async () => {
    if (!tableData) return
    try {
      // Big tables export as a background job (the file downloads when the job completes via the
      // SSE stream); small ones keep the instant synchronous stream. While a delete job runs,
      // rowCount is a doomed-estimate-adjusted number — not ground truth — so always take the
      // async path (safe at any size; exports bypass the one-job-per-table gate).
      const deleteRunning = tableData.jobType === 'delete' && tableData.jobStatus === 'running'
      if (deleteRunning || tableData.rowCount > TABLE_LIMITS.EXPORT_ASYNC_THRESHOLD_ROWS) {
        await exportTableAsync.mutateAsync({ format: 'csv' })
        toast.success('Export started — the download will begin when it finishes')
      } else {
        await downloadTableExport(tableData.id, tableData.name)
      }
      captureEvent(posthogRef.current, 'table_exported', {
        table_id: tableData.id,
        workspace_id: workspaceId,
      })
    } catch (err) {
      logger.error('Failed to export table:', err)
      toast.error('Failed to export table')
    }
  }, [tableData, workspaceId])

  const columnOptions = useMemo<ColumnOption[]>(
    () =>
      columns.map((col) => ({
        // `id` is the filter/sort field key (column id); `label` is what the user sees.
        id: getColumnId(col),
        label: col.name,
        type: col.type,
        icon: COLUMN_TYPE_ICONS[col.type],
      })),
    [columns]
  )

  const sortConfig = useMemo<SortConfig>(
    () => ({
      options: columnOptions,
      active: sortColumn ? { column: sortColumn, direction: sortDirection } : null,
      onSort: (column, direction) => setSortParams({ sort: column, dir: direction }),
      /**
       * Clearing writes the default direction (stripped by clearOnDefault) and
       * drops the column, leaving a clean URL with no active sort.
       */
      onClear: () => setSortParams({ sort: null, dir: DEFAULT_TABLE_DETAIL_SORT_DIRECTION }),
    }),
    [columnOptions, sortColumn, sortDirection, setSortParams]
  )

  const handleFilterApply = (next: Filter | null) => {
    setFilter(next)
  }

  const breadcrumbs = useMemo(
    (): BreadcrumbItem[] => [
      { label: 'Tables', onClick: handleNavigateBack },
      // While the table loads, mirror this route's loading.tsx (terminal "…" crumb)
      // so no empty-label / orphaned-chevron frame renders in between.
      tableData
        ? {
            label: tableData.name,
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
                onClick: handleStartTableRename,
              },
              {
                label: 'Delete',
                icon: Trash,
                onClick: onRequestDeleteTable,
              },
            ],
          }
        : { label: '…', terminal: true },
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
      onPickEnrichment={onOpenEnrichments}
    />
  ) : null

  const logPanelWidth = useLogDetailsUIStore((state) => state.panelWidth)
  const sidebarReservedPx =
    slideout.kind === 'column' || slideout.kind === 'workflow' || slideout.kind === 'enrichments'
      ? COLUMN_SIDEBAR_WIDTH
      : slideout.kind === 'execution' || slideout.kind === 'enrichment-details'
        ? logPanelWidth
        : 0

  const deleteTableMutation = useDeleteTable(workspaceId)
  const deleteRowsAsyncMutation = useDeleteTableRowsAsync({ workspaceId, tableId })
  const exportTableAsync = useExportTableAsync({ workspaceId, tableId })
  const handleDeleteTable = async () => {
    try {
      await deleteTableMutation.mutateAsync(tableId)
      setShowDeleteTableConfirm(false)
      router.push(`/workspace/${workspaceId}/tables`)
    } catch {
      setShowDeleteTableConfirm(false)
    }
  }

  const handleConfirmDeleteColumns = () => {
    if (!deletingColumns) return
    const names = deletingColumns
    setDeletingColumns(null)
    confirmDeleteColumnsSinkRef.current?.(names)
  }

  const columnConfig = slideout.kind === 'column' ? slideout.config : null
  const workflowConfig = slideout.kind === 'workflow' ? slideout.config : null
  const executionId = slideout.kind === 'execution' ? slideout.executionId : null
  const enrichmentDetailsTarget = slideout.kind === 'enrichment-details' ? slideout : null
  const enrichmentDetailsGroupName =
    enrichmentDetailsTarget &&
    tableWorkflowGroups.find((g) => g.id === enrichmentDetailsTarget.groupId)?.name
  // Fetch the workflow log when the execution-details slideout is open. Reuses
  // the logs page's <LogDetails> directly — no intermediate wrapper needed for
  // a one-line query forward.
  const { data: executionLog } = useLogByExecutionId(workspaceId, executionId)

  // Stable identity so the memoized Resource.Options can bail — an inline
  // object literal (with an inline arrow) would defeat its memo every render.
  const handleToggleFilter = useCallback(() => setFilterOpen((prev) => !prev), [])
  const filterConfig = useMemo(
    () => ({
      mode: 'toggle' as const,
      active: filterOpen || !!queryOptions.filter,
      onToggle: handleToggleFilter,
    }),
    [filterOpen, queryOptions.filter, handleToggleFilter]
  )

  return (
    <Resource>
      {!embedded && (
        <Resource.Header
          icon={TableIcon}
          breadcrumbs={breadcrumbs}
          aside={
            <div className='flex items-center gap-1.5'>
              <ImportProgressMenu workspaceId={workspaceId} tableId={tableId} />
              {selection.totalRunning > 0 || selection.hasActiveDispatch ? (
                <RunStatusControl
                  running={selection.totalRunning}
                  onStopAll={onStopAll}
                  isStopping={cancelRunsMutation.isPending}
                />
              ) : null}
              {headerActions?.map((action) => (
                <Chip
                  key={action.label}
                  leftIcon={action.icon}
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  {action.label}
                </Chip>
              ))}
              {createTrigger}
            </div>
          }
        />
      )}
      {/* Sort + filter render in both modes. In embedded (mothership) mode there's no
          Resource.Header, so the run/stop control rides in the options bar's `aside`
          slot, just left of filter/sort. */}
      <Resource.Options
        sort={sortConfig}
        filter={filterConfig}
        aside={
          embedded && (selection.totalRunning > 0 || selection.hasActiveDispatch) ? (
            <RunStatusControl
              running={selection.totalRunning}
              onStopAll={onStopAll}
              isStopping={cancelRunsMutation.isPending}
            />
          ) : undefined
        }
      />
      {filterOpen && (
        <TableFilter
          columns={columns}
          filter={queryOptions.filter}
          onApply={handleFilterApply}
          onClose={() => setFilterOpen(false)}
        />
      )}
      <TableGrid
        workspaceId={workspaceId}
        tableId={tableId}
        embedded={embedded}
        sidebarReservedPx={sidebarReservedPx}
        onOpenColumnConfig={onOpenColumnConfig}
        onOpenWorkflowConfig={onOpenWorkflowConfig}
        onOpenEnrichments={onOpenEnrichments}
        onOpenEnrichmentConfig={onOpenEnrichmentConfig}
        onOpenExecutionDetails={onOpenExecutionDetails}
        onOpenEnrichmentDetails={onOpenEnrichmentDetails}
        onOpenRowModal={onOpenRowModal}
        onRequestDeleteRows={onRequestDeleteRows}
        onRequestDeleteAllByFilter={onRequestDeleteAllByFilter}
        onRequestDeleteColumns={onRequestDeleteColumns}
        onRunColumn={onRunColumn}
        onRunRow={onRunRow}
        onRunRows={onRunRows}
        onStopRows={onStopRows}
        onStopAllRows={onStopAllRows}
        onStopRow={onStopRow}
        onSelectionChange={onSelectionChange}
        queryOptions={queryOptions}
        columnRenameSinkRef={columnRenameSinkRef}
        afterDeleteRowsSinkRef={afterDeleteRowsSinkRef}
        afterDeleteAllSinkRef={afterDeleteAllSinkRef}
        confirmDeleteColumnsSinkRef={confirmDeleteColumnsSinkRef}
        pushTableRenameUndoSinkRef={pushTableRenameUndoSinkRef}
      />
      {userPermissions.canEdit && (
        <TableActionBar
          selectedCellCount={
            selection.selectedRunScope
              ? selection.selectedRunScope.groupIds.length * selection.selectedRunScope.rowCount
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
              // `filter`/`excludeRowIds` are only populated on select-all.
              filter: scope.filter,
              excludeRowIds: scope.excludeRowIds,
              runMode: 'incomplete',
              source: 'rows',
            })
          }}
          onRefresh={() => {
            const scope = selection.selectedRunScope
            if (!scope) return
            runScope({
              groupIds: scope.groupIds,
              rowIds: scope.allRows ? undefined : scope.rowIds,
              filter: scope.filter,
              excludeRowIds: scope.excludeRowIds,
              runMode: 'all',
              source: 'rows',
            })
          }}
          onStopWorkflows={() => {
            const scope = selection.selectedRunScope
            if (!scope) return
            if (scope.allRows) {
              scope.filter || scope.excludeRowIds?.length
                ? onStopAllRows(scope.filter, scope.excludeRowIds)
                : onStopAll()
            } else {
              onStopRows(scope.rowIds)
            }
          }}
          onViewExecution={
            selection.singleWorkflowCell?.canViewExecution &&
            selection.singleWorkflowCell.executionId
              ? () => {
                  const id = selection.singleWorkflowCell?.executionId
                  if (id) onOpenExecutionDetails(id)
                }
              : selection.singleWorkflowCell?.canViewEnrichment
                ? () => {
                    const cell = selection.singleWorkflowCell
                    if (cell) onOpenEnrichmentDetails(cell.rowId, cell.groupId)
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
            ? (columns.find((c) => getColumnId(c) === columnConfig.columnName) ?? null)
            : null
        }
        workspaceId={workspaceId}
        tableId={tableId}
        onColumnRename={onColumnRename}
      />
      <EnrichmentsSidebar
        open={slideout.kind === 'enrichments'}
        onClose={onCloseSlideout}
        allColumns={columns}
        workspaceId={workspaceId}
        tableId={tableId}
        editGroup={slideout.kind === 'enrichments' ? slideout.editGroup : undefined}
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
      <EnrichmentDetails
        tableId={tableId}
        rowId={enrichmentDetailsTarget?.rowId ?? null}
        groupId={enrichmentDetailsTarget?.groupId ?? null}
        groupName={enrichmentDetailsGroupName ?? undefined}
        isOpen={Boolean(enrichmentDetailsTarget)}
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
      <ChipConfirmModal
        open={deletingAll !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingAll(null)
        }}
        srTitle={tI18n('delete_rows')}
        title={t('delete_rows')}
        text={`Delete ${deletingAll ? deletingAll.estimatedCount.toLocaleString() : 0} ${
          deletingAll?.estimatedCount === 1 ? 'row' : 'rows'
        }${queryOptions.filter ? ' matching the current filter' : ''}? This can't be undone.`}
        confirm={{
          label: 'Delete',
          pending: deleteRowsAsyncMutation.isPending,
          pendingLabel: 'Deleting...',
          onClick: () => {
            if (!deletingAll) return
            const { excludeRowIds, estimatedCount } = deletingAll
            deleteRowsAsyncMutation.mutate({
              filter: queryOptions.filter ?? undefined,
              sort: queryOptions.sort,
              excludeRowIds: excludeRowIds.length > 0 ? excludeRowIds : undefined,
              estimatedCount,
            })
            // Clear at click so the header checkbox doesn't linger in its
            // select-all state over the optimistically-emptied grid. If the
            // kickoff fails the rows visibly return with an error toast —
            // re-selecting is cheaper than a stale-looking selection.
            afterDeleteAllSinkRef.current?.()
            setDeletingAll(null)
          },
        }}
      />
      <ChipConfirmModal
        open={deletingColumns !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingColumns(null)
        }}
        srTitle={
          deletingColumns && deletingColumns.length > 1
            ? `Delete ${deletingColumns.length} Columns`
            : tI18n('delete_column')
        }
        title={
          deletingColumns && deletingColumns.length > 1
            ? `Delete ${deletingColumns.length} Columns`
            : tI18n('delete_column')
        }
        text={[
          'Are you sure you want to delete ',
          deletingColumns && deletingColumns.length > 1
            ? { text: `${deletingColumns.length} columns`, bold: true }
            : {
                text:
                  (deletingColumns &&
                    columns.find((c) => getColumnId(c) === deletingColumns[0])?.name) ??
                  deletingColumns?.[0] ??
                  'this column',
                bold: true,
              },
          '? ',
          {
            text: `This will remove all data in ${deletingColumns && deletingColumns.length > 1 ? 'these columns' : 'this column'}.`,
            error: true,
          },
          ' You can undo this action.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleConfirmDeleteColumns,
        }}
      />
      {!embedded && (
        <ChipConfirmModal
          open={showDeleteTableConfirm}
          onOpenChange={setShowDeleteTableConfirm}
          srTitle={tI18n('delete_table')}
          title={t('delete_table')}
          text={[
            'Are you sure you want to delete ',
            { text: tableData?.name ?? 'this table', bold: true },
            '? ',
            { text: `All ${tableData?.rowCount ?? 0} rows will be removed.`, error: true },
            ' You can restore it from Recently Deleted in Settings.',
          ]}
          confirm={{
            label: 'Delete',
            onClick: handleDeleteTable,
            pending: deleteTableMutation.isPending,
            pendingLabel: 'Deleting...',
          }}
        />
      )}
    </Resource>
  )
}
