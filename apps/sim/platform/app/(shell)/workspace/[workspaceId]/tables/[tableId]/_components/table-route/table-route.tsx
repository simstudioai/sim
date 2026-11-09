'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { AvatarGroup } from '@sim/emcn/avatar'
import { Breadcrumbs } from '@sim/emcn/breadcrumbs'
import { Button } from '@sim/emcn/button'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { usePageCommands } from '@/platform/app/(shell)/_components/command-menu/page-commands'
import { ControlBar } from '@/platform/app/(shell)/_components/control-bar/control-bar'
import { folderTrail } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/resource-table/list-menus'
import { RenameDialog } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/resource-table/rename-dialog'
import { LiveWorkspacePage } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import {
  type ColumnConfig,
  ColumnConfigPanel,
} from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/column-config/column-config'
import { columnTypeGlyph } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/column-types/column-types'
import { EnrichmentDetailsPanel } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/enrichment-details/enrichment-details'
import { EnrichmentsPanel } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/enrichments-panel/enrichments-panel'
import { ExecutionDetailsPanel } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/execution-details/execution-details'
import { LockSettingsModal } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/lock-settings/lock-settings'
import { RowModal } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/row-modal/row-modal'
import { TableFilter } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-filter/table-filter'
import { ColumnDropdown } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/column-dropdown'
import {
  type SelectionSnapshot,
  TableGrid,
} from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/table-grid'
import { useTable } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-grid/use-table'
import { TableActionBar } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-route/action-bar'
import { ColumnsMenu } from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-route/columns-menu'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-route/table-route.module.css'
import {
  DEFAULT_TABLE_SORT_DIRECTION,
  tableDetailParsers,
  tableDetailUrlKeys,
} from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/table-route/url-state'
import {
  type WorkflowConfig,
  WorkflowPanel,
} from '@/platform/app/(shell)/workspace/[workspaceId]/tables/[tableId]/_components/workflow-panel/workflow-panel'
import { useFolderMap } from '@/platform/lib/data/folders'
import { useSocket } from '@/platform/lib/data/realtime'
import {
  type BlockedTableAction,
  type ColumnDefinition,
  captureClientEvent,
  consumeInitiatedExport,
  type DeletedRowSnapshot,
  describeBlockedAction,
  downloadExportResult,
  generateColumnName,
  getColumnId,
  LOCK_TOOLTIPS,
  lockedNouns,
  type Predicate,
  type QueryOptions,
  type RowInsertTarget,
  type RunLimit,
  type RunMode,
  resolveWorkflowGroupDeploymentMode,
  type SortDirection,
  type SortSpec,
  type TableMetadata,
  type TablePredicate,
  type TableRow,
  useCancelTableRuns,
  useDeleteTable,
  useDeleteTableRowsAsync,
  useExportTable,
  useRenameTable,
  useRunColumn,
  useTableEventStream,
  useTableRoom,
  useUpdateTableMetadata,
  useWorkspaceExportJobs,
  useWorkspaceUserPermissions,
  type WorkflowGroup,
  withCellValueFilter,
} from '@/platform/lib/data/tables'
import { folderChain } from '@/platform/lib/folder-chain'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { toast } from '@/platform/shared/toast'

/** Blocked-action notices carry a button, so they linger past the default. */
const BLOCKED_TOAST_MS = 8000

/**
 * The right-hand panels, at most one open at a time. Every transition goes through one reducer, so
 * opening a column's settings can never leave a workflow's open.
 */
type PanelState =
  | { kind: 'none' }
  | { kind: 'column'; config: ColumnConfig }
  | { kind: 'enrichments'; editGroup?: WorkflowGroup }
  | { kind: 'workflow'; config: WorkflowConfig }
  | { kind: 'execution'; executionId: string }
  | { kind: 'enrichment-details'; rowId: string; groupId: string }

type PanelAction =
  | { type: 'OPEN_COLUMN'; config: ColumnConfig }
  | { type: 'OPEN_ENRICHMENTS'; editGroup?: WorkflowGroup }
  | { type: 'OPEN_WORKFLOW'; config: WorkflowConfig }
  | { type: 'OPEN_EXECUTION'; executionId: string }
  | { type: 'OPEN_ENRICHMENT_DETAILS'; rowId: string; groupId: string }
  | { type: 'CLOSE' }

function panelReducer(_state: PanelState, action: PanelAction): PanelState {
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

function panelKey(panel: PanelState): string {
  switch (panel.kind) {
    case 'column':
      return panel.config.mode === 'edit'
        ? `column:edit:${panel.config.columnName}`
        : `column:create:${panel.config.proposedName}:${panel.config.type}`
    case 'workflow':
      return `workflow:${JSON.stringify(panel.config)}`
    case 'enrichments':
      return `enrichments:${panel.editGroup?.id ?? 'catalog'}`
    case 'execution':
      return `execution:${panel.executionId}`
    case 'enrichment-details':
      return `enrichment:${panel.rowId}:${panel.groupId}`
    case 'none':
      return 'none'
  }
}

const EMPTY_SELECTION: SelectionSnapshot = {
  actionBarRowIds: [],
  runningInActionBarSelection: 0,
  totalRunning: 0,
  hasRunningCell: false,
  hasActiveDispatch: false,
  hasWorkflowColumns: false,
  selectedRunScope: null,
  selectionStats: { hasIncompleteOrFailed: false, hasCompleted: false, hasInFlight: false },
  singleWorkflowCell: null,
}

interface TableRouteProps {
  workspaceId: string
  tableId: string
}

/**
 * The table's page: the workspace heading and tabs, the control bar (trail, collaborators, runs,
 * filter, sort, columns, export, new column), and the grid on the canvas below, with its panels,
 * dialogs and floating action bar. Live data only; the workspace's shared socket carries presence.
 */
export function TableRoute({ workspaceId, tableId }: TableRouteProps) {
  const router = useRouter()
  const search = useSearchParams()
  const permissions = useWorkspaceUserPermissions(workspaceId)
  const canEdit = permissions.canEdit
  const canAdmin = permissions.canAdmin

  useTableEventStream({
    tableId,
    workspaceId,
    onUsageLimitReached: ({ message }) => {
      toast.error(message, {
        action: {
          label: 'Upgrade',
          onClick: () => router.push(platformHref('/settings/billing/plans?reason=tables', search)),
        },
      })
    },
  })

  const { socket, currentSocketId } = useSocket()
  const {
    otherUsers: presenceUsers,
    remoteSelections,
    emitCellSelection,
  } = useTableRoom({ tableId, socket, currentSocketId })

  const [panel, dispatch] = useReducer(panelReducer, { kind: 'none' })
  const [showDeleteTableConfirm, setShowDeleteTableConfirm] = useState(false)
  const [renamingTable, setRenamingTable] = useState(false)
  const [showLockSettings, setShowLockSettings] = useState(false)
  /** The last blocked-action notice, so repeated attempts replace one notice instead of stacking. */
  const blockedToastIdRef = useRef<string | null>(null)
  const [editingRow, setEditingRow] = useState<TableRow | null>(null)
  const [addRowTarget, setAddRowTarget] = useState<RowInsertTarget | null>(null)
  const [deletingRows, setDeletingRows] = useState<DeletedRowSnapshot[]>([])
  const [deletingAll, setDeletingAll] = useState<{
    excludeRowIds: string[]
    estimatedCount: number
  } | null>(null)
  const [deletingColumns, setDeletingColumns] = useState<string[] | null>(null)
  const [selection, setSelection] = useState<SelectionSnapshot>(EMPTY_SELECTION)
  const [filter, setFilter] = useState<TablePredicate | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  /** Bumped when the filter is replaced from outside the panel, so the panel re-seeds its rules. */
  const [filterSeed, setFilterSeed] = useState(0)
  /** A read-only member's hidden columns, which stay local instead of saving to the table. */
  const [localHiddenColumns, setLocalHiddenColumns] = useState<string[] | null>(null)
  /** An export running in the background; its job list is polled until it finishes. */
  const [exportPending, setExportPending] = useState(false)

  const [{ sort: sortColumn, dir: sortDirection }, setTableParams] = useQueryStates(
    tableDetailParsers,
    tableDetailUrlKeys
  )

  const sortQuery = useMemo<SortSpec | null>(
    () => (sortColumn ? [{ field: sortColumn, direction: sortDirection }] : null),
    [sortColumn, sortDirection]
  )
  const queryOptions = useMemo<QueryOptions>(
    () => ({ filter, sort: sortQuery }),
    [filter, sortQuery]
  )

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
  const onClosePanel = useCallback(() => dispatch({ type: 'CLOSE' }), [])
  const onOpenRowModal = useCallback((row: TableRow) => setEditingRow(row), [])
  const onOpenAddRowModal = useCallback(
    (insertAt: RowInsertTarget = {}) => setAddRowTarget(insertAt),
    []
  )
  const onRequestDeleteRows = useCallback((snapshots: DeletedRowSnapshot[]) => {
    setDeletingRows(snapshots)
  }, [])
  const onRequestDeleteAllByFilter = useCallback(
    (params: { excludeRowIds: string[]; estimatedCount: number }) => setDeletingAll(params),
    []
  )
  const onRequestDeleteColumns = useCallback((names: string[]) => setDeletingColumns(names), [])

  /** Sinks the grid fills, so the page's panels and dialogs can reach grid-owned state. */
  const columnRenameSinkRef = useRef<((oldName: string, newName: string) => void) | null>(null)
  const onColumnRename = (oldName: string, newName: string) => {
    columnRenameSinkRef.current?.(oldName, newName)
  }
  const afterDeleteRowsSinkRef = useRef<((snapshots: DeletedRowSnapshot[]) => void) | null>(null)
  const afterDeleteAllSinkRef = useRef<(() => void) | null>(null)
  const confirmDeleteColumnsSinkRef = useRef<((names: string[]) => void) | null>(null)
  const pushTableRenameUndoSinkRef = useRef<
    ((previousName: string, newName: string) => void) | null
  >(null)

  const {
    tableData,
    columns,
    tableWorkflowGroups,
    workflows,
    // Server-bound scopes use the filter actually sent: a condition the schema invalidated is
    // pruned from the rows query, so a select-all delete must target the same predicate.
    filter: effectiveFilter,
  } = useTable({ workspaceId, tableId, queryOptions })

  /** Replaces the filter from outside the panel, re-seeding the panel's rules to match. */
  const filterRef = useRef(filter)
  filterRef.current = filter
  const replaceFilter = useCallback((next: TablePredicate | null) => {
    if (JSON.stringify(next) === JSON.stringify(filterRef.current)) return
    setFilter(next)
    setFilterSeed((seed) => seed + 1)
  }, [])

  const updateMetadataMutation = useUpdateTableMetadata({ workspaceId, tableId })
  const updateMetadataMutate = updateMetadataMutation.mutate
  /** Layout (widths, order, pins) saves to the table's metadata; read-only members keep it local. */
  const handlePersistLayout = useCallback(
    (patch: TableMetadata, options?: { onSettled?: () => void }) => {
      if (!canEdit) {
        options?.onSettled?.()
        return
      }
      updateMetadataMutate(patch, options)
    },
    [canEdit, updateMetadataMutate]
  )

  /** Hidden column ids save to the table's metadata with the rest of its layout. */
  const savedHiddenColumns = tableData?.metadata?.hiddenColumns
  const hiddenColumns = useMemo(
    () => localHiddenColumns ?? savedHiddenColumns ?? [],
    [localHiddenColumns, savedHiddenColumns]
  )
  const handleHiddenColumnsChange = useCallback(
    (next: string[]) => {
      if (canEdit) handlePersistLayout({ hiddenColumns: next })
      else setLocalHiddenColumns(next)
    },
    [canEdit, handlePersistLayout]
  )

  /** Live hidden ids, pruned of deleted columns so the menu and grid agree with the schema. */
  const liveColumnIds = useMemo(() => new Set(columns.map(getColumnId)), [columns])
  const effectiveHiddenColumns = useMemo(
    () =>
      columns.length === 0 ? hiddenColumns : hiddenColumns.filter((id) => liveColumnIds.has(id)),
    [columns.length, hiddenColumns, liveColumnIds]
  )

  // A sort whose column was deleted leaves the URL.
  useEffect(() => {
    if (!sortColumn || columns.length === 0) return
    if (liveColumnIds.has(sortColumn)) return
    void setTableParams({ sort: null, dir: null })
  }, [sortColumn, columns.length, liveColumnIds, setTableParams])

  const runColumnMutation = useRunColumn({ workspaceId, tableId })
  const cancelRunsMutation = useCancelTableRuns({ workspaceId, tableId })
  const runColumnMutate = runColumnMutation.mutate
  const cancelRunsMutate = cancelRunsMutation.mutate

  /** Every run gesture reduces to (groups, rows?, mode); an empty group list does nothing. */
  const runScope = useCallback(
    (args: {
      groupIds: string[]
      rowIds?: string[]
      filter?: TablePredicate
      excludeRowIds?: string[]
      runMode: RunMode
      limit?: RunLimit
      source: 'row' | 'rows' | 'column'
    }) => {
      const { source, ...mutateArgs } = args
      if (mutateArgs.groupIds.length === 0) return
      if (mutateArgs.rowIds && mutateArgs.rowIds.length === 0) return
      runColumnMutate(mutateArgs)
      const targetGroupIds = new Set(mutateArgs.groupIds)
      const modes = new Set(
        tableWorkflowGroups
          .filter((g) => targetGroupIds.has(g.id))
          .map((g) => resolveWorkflowGroupDeploymentMode(g))
      )
      captureClientEvent('table_workflow_run', {
        table_id: tableId,
        workspace_id: workspaceId,
        source,
        run_mode: mutateArgs.runMode,
        group_count: mutateArgs.groupIds.length,
        row_count: mutateArgs.rowIds?.length ?? null,
        has_limit: mutateArgs.limit != null,
        deployment_mode: modes.size === 1 ? [...modes][0] : 'mixed',
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
      runFilter?: TablePredicate,
      excludeRowIds?: string[]
    ) => {
      runScope({
        groupIds: [groupId],
        rowIds,
        filter: runFilter,
        excludeRowIds,
        runMode,
        limit,
        source: 'column',
      })
    },
    [runScope]
  )

  const onRunRows = useCallback(
    (
      rowIds: string[] | undefined,
      runMode: RunMode,
      runFilter?: TablePredicate,
      excludeRowIds?: string[]
    ) => {
      runScope({
        groupIds: tableWorkflowGroups.map((g) => g.id),
        rowIds,
        filter: runFilter,
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

  const onStopRow = useCallback(
    (rowId: string) => {
      cancelRunsMutate({ scope: 'row', rowId })
      captureClientEvent('table_workflow_stopped', {
        table_id: tableId,
        workspace_id: workspaceId,
        scope: 'row',
        row_count: 1,
      })
    },
    [cancelRunsMutate, tableId, workspaceId]
  )

  const onStopRows = useCallback(
    (rowIds: string[]) => {
      if (rowIds.length === 0) return
      for (const rowId of rowIds) cancelRunsMutate({ scope: 'row', rowId })
      captureClientEvent('table_workflow_stopped', {
        table_id: tableId,
        workspace_id: workspaceId,
        scope: 'rows',
        row_count: rowIds.length,
      })
    },
    [cancelRunsMutate, tableId, workspaceId]
  )

  const onStopAll = useCallback(() => {
    cancelRunsMutate({ scope: 'all' })
    captureClientEvent('table_workflow_stopped', {
      table_id: tableId,
      workspace_id: workspaceId,
      scope: 'all',
      row_count: null,
    })
  }, [cancelRunsMutate, tableId, workspaceId])

  /** Select-all Stop: filter-scoped when a filter is active; deselected rows keep running. */
  const onStopAllRows = useCallback(
    (stopFilter?: TablePredicate, excludeRowIds?: string[]) => {
      cancelRunsMutate({ scope: 'all', filter: stopFilter, sort: queryOptions.sort, excludeRowIds })
      captureClientEvent('table_workflow_stopped', {
        table_id: tableId,
        workspace_id: workspaceId,
        scope: 'all',
        row_count: null,
      })
    },
    [cancelRunsMutate, tableId, workspaceId, queryOptions.sort]
  )

  const handleSortColumn = useCallback(
    (column: string, direction: SortDirection) => {
      void setTableParams({ sort: column, dir: direction })
    },
    [setTableParams]
  )

  /** Clearing writes the default direction (dropped by clearOnDefault) and drops the column. */
  const handleClearSort = useCallback(() => {
    void setTableParams({ sort: null, dir: DEFAULT_TABLE_SORT_DIRECTION })
  }, [setTableParams])

  /**
   * "Filter by cell value" narrows the pruned filter, so a condition the schema already invalidated
   * is not resurrected, and opens the panel so the reader sees what was applied.
   */
  const handleFilterByCellValue = (conditions: readonly Predicate[]) => {
    replaceFilter(withCellValueFilter(effectiveFilter, conditions))
    setFilterOpen(true)
  }

  const renameTableMutation = useRenameTable(workspaceId)
  const deleteTableMutation = useDeleteTable(workspaceId)
  const deleteRowsAsyncMutation = useDeleteTableRowsAsync({ workspaceId, tableId })
  const exportTableAsync = useExportTable({ workspaceId, tableId })

  const handleExportCsv = useCallback(async () => {
    if (!tableData) return
    try {
      const exported = await exportTableAsync.mutateAsync({ format: 'csv' })
      if (exported.status === 'completed') {
        await downloadExportResult(workspaceId, exported.id)
      } else {
        setExportPending(true)
        toast.success('Export started — the download will begin when it finishes')
      }
      captureClientEvent('table_exported', { table_id: tableData.id, workspace_id: workspaceId })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to export table'))
    }
  }, [tableData, workspaceId, exportTableAsync])

  // The event stream downloads a finished background export; while one runs this also polls the
  // workspace's export jobs, so a dropped stream still delivers the file.
  const { data: exportJobs } = useWorkspaceExportJobs(exportPending ? workspaceId : undefined)
  useEffect(() => {
    if (!exportPending || !exportJobs) return
    let running = false
    for (const job of exportJobs) {
      if (job.status === 'running') running = true
      if (job.status === 'ready' && consumeInitiatedExport(job.jobId)) {
        void downloadExportResult(workspaceId, job.jobId)
      }
    }
    if (!running) setExportPending(false)
  }, [exportJobs, exportPending, workspaceId])

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

  /** Explains a refused table mutation, with a way to the settings for admins. */
  const showBlockedToast = useCallback(
    (action: BlockedTableAction) => {
      if (!tableData) return
      if (blockedToastIdRef.current) toast.dismiss(blockedToastIdRef.current)
      const { title, text } = describeBlockedAction(action, tableData.locks)
      // The on-open announcement is information; nothing was refused.
      const notify = action === 'status' ? toast.info : toast.warning
      blockedToastIdRef.current = notify(title, {
        description: text,
        ...(canAdmin
          ? {
              action: { label: 'Table Security', onClick: () => setShowLockSettings(true) },
              duration: BLOCKED_TOAST_MS,
            }
          : {}),
      })
    },
    [tableData, canAdmin]
  )

  // Search's "This page" group, with the legacy palette's ids, labels and gates.
  usePageCommands([
    {
      id: 'table-export-csv',
      label: 'Export CSV',
      run: () => {
        if (!tableData?.rowCount) return
        void handleExportCsv()
      },
    },
    ...(canEdit
      ? [
          {
            id: 'table-new-column',
            label: 'New column',
            run: () => {
              if (tableData?.locks.schemaLocked) {
                showBlockedToast('add-column')
                return
              }
              handleAddColumnOfType('string')
            },
          },
        ]
      : []),
  ])

  // Announce the lock state once per table on open, once permissions have settled.
  const announcedLockTableIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!tableData || permissions.isLoading) return
    if (announcedLockTableIdRef.current === tableData.id) return
    announcedLockTableIdRef.current = tableData.id
    if (lockedNouns(tableData.locks).length === 0) return
    showBlockedToast('status')
  }, [tableData, permissions.isLoading, showBlockedToast])

  // A notice must not outlive the table it describes.
  useEffect(
    () => () => {
      announcedLockTableIdRef.current = null
      if (!blockedToastIdRef.current) return
      toast.dismiss(blockedToastIdRef.current)
      blockedToastIdRef.current = null
    },
    [tableId]
  )

  // A viewer who loses admin access mid-notice would keep a Table Security action that opens nothing.
  const couldOpenLockSettingsRef = useRef(canAdmin)
  useEffect(() => {
    const lostAccess = couldOpenLockSettingsRef.current && !canAdmin
    couldOpenLockSettingsRef.current = canAdmin
    if (!lostAccess || !blockedToastIdRef.current) return
    toast.dismiss(blockedToastIdRef.current)
    blockedToastIdRef.current = null
  }, [canAdmin])

  const tablesHref = (folderId: string | null) =>
    platformHref(
      folderId
        ? `${workspacePath(workspaceId, 'tables')}?folderId=${encodeURIComponent(folderId)}`
        : workspacePath(workspaceId, 'tables'),
      search
    )

  const { data: folderMap } = useFolderMap(workspaceId, 'table')
  const chain = folderChain(folderMap, tableData?.folderId)

  const tableActions: MenuAction[] = tableData
    ? [
        {
          id: 'rename',
          label: 'Rename',
          icon: 'I036',
          disabled: !canEdit,
          onSelect: () => setRenamingTable(true),
        },
        ...(canAdmin
          ? [
              {
                id: 'security',
                label: 'Table Security',
                icon: 'lock' as const,
                onSelect: () => setShowLockSettings(true),
              },
            ]
          : []),
        {
          id: 'delete',
          label: 'Delete',
          icon: 'trash',
          destructive: true,
          separatorBefore: true,
          disabled: !canEdit || tableData.locks.deleteLocked,
          disabledReason: tableData.locks.deleteLocked ? LOCK_TOOLTIPS.delete : undefined,
          onSelect: () => setShowDeleteTableConfirm(true),
        },
      ]
    : []

  const trail = (
    <Breadcrumbs
      label='Location'
      items={[
        ...folderTrail({ rootLabel: 'Tables', chain, hrefFor: tablesHref }),
        ...(tableData ? [{ id: tableData.id, label: tableData.name, actions: tableActions }] : []),
      ]}
    />
  )

  const canMutateSchema = canEdit && !tableData?.locks.schemaLocked
  const activeRuleCount = effectiveFilter ? countRules(effectiveFilter) : 0
  const running = selection.totalRunning > 0 || selection.hasActiveDispatch

  const sortActions = (): MenuAction[] => {
    const active = sortColumn ? { column: sortColumn, direction: sortDirection } : null
    return [
      ...columns.map(
        (column, index): MenuAction => ({
          id: getColumnId(column),
          label: column.name,
          icon: columnTypeGlyph(column.type),
          headingBefore: index === 0 ? 'Sort by' : undefined,
          checked: active?.column === getColumnId(column),
          trailingIcon:
            active?.column === getColumnId(column)
              ? active.direction === 'asc'
                ? 'I023'
                : 'I102'
              : undefined,
          // A new column starts descending; choosing the active one flips it.
          onSelect: () =>
            handleSortColumn(
              getColumnId(column),
              active?.column === getColumnId(column)
                ? active.direction === 'asc'
                  ? 'desc'
                  : 'asc'
                : 'desc'
            ),
        })
      ),
      ...(active
        ? [
            {
              id: 'clear-sort',
              label: 'Clear sort',
              icon: 'I105' as const,
              separatorBefore: true,
              onSelect: handleClearSort,
            },
          ]
        : []),
    ]
  }

  const controls = (
    <ControlBar trail={trail}>
      {presenceUsers.length > 0 && (
        <AvatarGroup
          label='Viewing this table'
          people={presenceUsers.map((user) => ({
            name: user.userName,
            src: user.avatarUrl ?? undefined,
          }))}
        />
      )}
      {running && (
        <span className={styles.runStatus}>
          <span className={styles.runCount} data-type='T052'>
            {selection.hasRunningCell ? `${selection.totalRunning} running` : 'Queueing'}
          </span>
          <Button
            variant='quiet'
            size='compact'
            icon='I035'
            disabled={cancelRunsMutation.isPending}
            onClick={onStopAll}
          >
            {cancelRunsMutation.isPending ? 'Stopping…' : 'Stop all'}
          </Button>
        </span>
      )}
      <Button
        variant='quiet'
        size='compact'
        icon='filter'
        count={activeRuleCount > 0 ? activeRuleCount : undefined}
        aria-label={filterOpen ? 'Hide filter' : 'Filter'}
        onClick={() => setFilterOpen((open) => !open)}
      >
        Filter
      </Button>
      <ActionMenu label='Sort' triggerSize='compact' actions={sortActions} />
      <ColumnsMenu
        columns={columns}
        workflowGroups={tableWorkflowGroups}
        hiddenColumns={effectiveHiddenColumns}
        onChange={handleHiddenColumnsChange}
      />
      <Button
        variant='quiet'
        size='compact'
        icon='I049'
        disabled={!tableData || tableData.rowCount === 0}
        onClick={() => void handleExportCsv()}
      >
        Export CSV
      </Button>
      {canEdit && (
        <ColumnDropdown
          columns={columns}
          blocked={!canMutateSchema}
          onPickType={handleAddColumnOfType}
          onPickWorkflow={handleAddWorkflowColumn}
          onPickEnrichment={onOpenEnrichments}
        />
      )}
    </ControlBar>
  )

  const columnConfig = panel.kind === 'column' ? panel.config : null
  const enrichmentDetailsGroupName =
    panel.kind === 'enrichment-details'
      ? tableWorkflowGroups.find((g) => g.id === panel.groupId)?.name
      : undefined
  const scope = selection.selectedRunScope
  const singleCell = selection.singleWorkflowCell

  return (
    <LiveWorkspacePage
      workspaceId={workspaceId}
      current='tables'
      layout='canvas'
      controls={controls}
    >
      <div className={styles.workspace}>
        <div className={styles.main}>
          {filterOpen && (
            <div className={styles.filter}>
              <TableFilter
                key={filterSeed}
                columns={columns}
                filter={effectiveFilter}
                autoApply
                onChange={setFilter}
                onClose={() => setFilterOpen(false)}
              />
            </div>
          )}
          <TableGrid
            workspaceId={workspaceId}
            tableId={tableId}
            canEdit={canEdit}
            locks={tableData?.locks}
            onBlockedAction={showBlockedToast}
            remoteSelections={remoteSelections}
            emitCellSelection={emitCellSelection}
            onOpenColumnConfig={onOpenColumnConfig}
            onOpenWorkflowConfig={onOpenWorkflowConfig}
            onOpenEnrichments={onOpenEnrichments}
            onOpenEnrichmentConfig={onOpenEnrichmentConfig}
            onOpenExecutionDetails={onOpenExecutionDetails}
            onOpenEnrichmentDetails={onOpenEnrichmentDetails}
            onOpenRowModal={onOpenRowModal}
            onOpenAddRowModal={onOpenAddRowModal}
            onRequestDeleteRows={onRequestDeleteRows}
            onRequestDeleteAllByFilter={onRequestDeleteAllByFilter}
            onRequestDeleteColumns={onRequestDeleteColumns}
            onFilterByCellValue={handleFilterByCellValue}
            onSortColumn={handleSortColumn}
            onClearSort={handleClearSort}
            onRunColumn={onRunColumn}
            onRunRow={onRunRow}
            onRunRows={onRunRows}
            onStopRows={onStopRows}
            onStopAllRows={onStopAllRows}
            onStopRow={onStopRow}
            onSelectionChange={setSelection}
            queryOptions={queryOptions}
            hiddenColumns={effectiveHiddenColumns}
            onPersistLayout={handlePersistLayout}
            columnRenameSinkRef={columnRenameSinkRef}
            afterDeleteRowsSinkRef={afterDeleteRowsSinkRef}
            afterDeleteAllSinkRef={afterDeleteAllSinkRef}
            confirmDeleteColumnsSinkRef={confirmDeleteColumnsSinkRef}
            pushTableRenameUndoSinkRef={pushTableRenameUndoSinkRef}
          />
          {canEdit && (
            <TableActionBar
              selectedCellCount={scope ? scope.groupIds.length * scope.rowCount : 0}
              runningCount={selection.runningInActionBarSelection}
              hasWorkflowColumns={selection.hasWorkflowColumns}
              showPlay={selection.selectionStats.hasIncompleteOrFailed}
              showRefresh={selection.selectionStats.hasCompleted}
              onPlay={() => {
                if (!scope) return
                runScope({
                  groupIds: scope.groupIds,
                  rowIds: scope.allRows ? undefined : scope.rowIds,
                  filter: scope.filter,
                  excludeRowIds: scope.excludeRowIds,
                  runMode: 'incomplete',
                  source: 'rows',
                })
              }}
              onRefresh={() => {
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
                if (!scope) return
                if (scope.allRows) {
                  if (scope.filter || scope.excludeRowIds?.length) {
                    onStopAllRows(scope.filter, scope.excludeRowIds)
                  } else {
                    onStopAll()
                  }
                } else {
                  onStopRows(scope.rowIds)
                }
              }}
              onViewExecution={
                singleCell?.canViewExecution && singleCell.executionId
                  ? () => {
                      if (singleCell.executionId) onOpenExecutionDetails(singleCell.executionId)
                    }
                  : singleCell?.canViewEnrichment
                    ? () => onOpenEnrichmentDetails(singleCell.rowId, singleCell.groupId)
                    : undefined
              }
            />
          )}
        </div>
        {panel.kind === 'column' && columnConfig && (
          <ColumnConfigPanel
            key={panelKey(panel)}
            config={columnConfig}
            onClose={onClosePanel}
            allColumns={columns}
            existingColumn={
              columnConfig.mode === 'edit'
                ? (columns.find((c) => getColumnId(c) === columnConfig.columnName) ?? null)
                : null
            }
            workspaceId={workspaceId}
            tableId={tableId}
            onColumnRename={onColumnRename}
            readOnly={!canMutateSchema}
            readOnlyReason={
              tableData?.locks.schemaLocked
                ? LOCK_TOOLTIPS.schema
                : 'You don’t have permission to change columns.'
            }
          />
        )}
        {panel.kind === 'enrichments' && (
          <EnrichmentsPanel
            key={panelKey(panel)}
            onClose={onClosePanel}
            allColumns={columns}
            workspaceId={workspaceId}
            tableId={tableId}
            editGroup={panel.editGroup}
          />
        )}
        {panel.kind === 'workflow' && (
          <WorkflowPanel
            key={panelKey(panel)}
            config={panel.config}
            onClose={onClosePanel}
            allColumns={columns}
            workflowGroups={tableWorkflowGroups}
            workflows={workflows}
            workspaceId={workspaceId}
            tableId={tableId}
            onColumnRename={onColumnRename}
            onBack={onOpenEnrichments}
          />
        )}
        {panel.kind === 'execution' && (
          <ExecutionDetailsPanel
            key={panelKey(panel)}
            workspaceId={workspaceId}
            executionId={panel.executionId}
            onClose={onClosePanel}
          />
        )}
        {panel.kind === 'enrichment-details' && (
          <EnrichmentDetailsPanel
            key={panelKey(panel)}
            tableId={tableId}
            rowId={panel.rowId}
            groupId={panel.groupId}
            groupName={enrichmentDetailsGroupName}
            onClose={onClosePanel}
          />
        )}
      </div>
      {addRowTarget && tableData && (
        <RowModal
          mode='add'
          isOpen
          onClose={() => setAddRowTarget(null)}
          table={tableData}
          insertAt={addRowTarget}
          onSuccess={() => setAddRowTarget(null)}
        />
      )}
      {editingRow && tableData && (
        <RowModal
          mode='edit'
          isOpen
          onClose={() => setEditingRow(null)}
          table={tableData}
          row={editingRow}
          onSuccess={() => setEditingRow(null)}
        />
      )}
      {deletingRows.length > 0 && tableData && (
        <RowModal
          mode='delete'
          isOpen
          onClose={() => setDeletingRows([])}
          table={tableData}
          rowIds={deletingRows.map((r) => r.rowId)}
          onSuccess={() => {
            afterDeleteRowsSinkRef.current?.(deletingRows)
            setDeletingRows([])
          }}
        />
      )}
      <ConfirmDialog
        target={deletingAll}
        onClose={() => setDeletingAll(null)}
        title='Delete rows'
        description={(target) =>
          `Delete ${target.estimatedCount.toLocaleString()} ${
            target.estimatedCount === 1 ? 'row' : 'rows'
          }${effectiveFilter ? ' matching the current filter' : ''}? This can't be undone.`
        }
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={(target) => {
          deleteRowsAsyncMutation.mutate({
            filter: effectiveFilter ?? undefined,
            sort: queryOptions.sort,
            excludeRowIds: target.excludeRowIds.length > 0 ? target.excludeRowIds : undefined,
            estimatedCount: target.estimatedCount,
          })
          // Cleared at once, so the select-all state doesn't linger over the emptied grid.
          afterDeleteAllSinkRef.current?.()
        }}
      />
      <ConfirmDialog
        target={deletingColumns}
        onClose={() => setDeletingColumns(null)}
        title={(names) => (names.length > 1 ? `Delete ${names.length} Columns` : 'Delete Column')}
        description={(names) =>
          `Are you sure you want to delete ${
            names.length > 1
              ? `${names.length} columns`
              : (columns.find((c) => getColumnId(c) === names[0])?.name ??
                names[0] ??
                'this column')
          }? This will remove all data in ${
            names.length > 1 ? 'these columns' : 'this column'
          }. You can undo this action.`
        }
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={(names) => {
          confirmDeleteColumnsSinkRef.current?.(names)
        }}
      />
      <ConfirmDialog
        target={showDeleteTableConfirm && tableData}
        onClose={() => setShowDeleteTableConfirm(false)}
        title='Delete Table'
        description={(table) =>
          `Are you sure you want to delete ${table.name}? All ${table.rowCount} rows will be removed. You can restore it from Recently Deleted in Settings.`
        }
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async () => {
          await deleteTableMutation.mutateAsync(tableId)
          router.push(tablesHref(null))
        }}
      />
      <RenameDialog
        target={renamingTable && tableData ? { id: tableData.id, name: tableData.name } : null}
        noun='table'
        onClose={() => setRenamingTable(false)}
        onRename={async (_id, name) => {
          if (tableData) pushTableRenameUndoSinkRef.current?.(tableData.name, name)
          await renameTableMutation.mutateAsync({ tableId, name })
        }}
      />
      {tableData && canAdmin && (
        <LockSettingsModal
          key={tableData.id}
          isOpen={showLockSettings}
          onClose={() => setShowLockSettings(false)}
          workspaceId={workspaceId}
          tableId={tableData.id}
          locks={tableData.locks}
        />
      )}
    </LiveWorkspacePage>
  )
}

/** How many conditions a filter applies, for the Filter action's count. */
function countRules(node: TablePredicate | Predicate): number {
  if ('field' in node) return 1
  const members = 'all' in node ? node.all : node.any
  return members.reduce((total, member) => total + countRules(member), 0)
}
