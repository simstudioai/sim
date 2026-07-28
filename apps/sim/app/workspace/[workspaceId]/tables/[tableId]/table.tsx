'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Chip, ChipConfirmModal, toast } from '@sim/emcn'
import { Download, Lock, Pencil, Table as TableIcon, Trash, Upload } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { usePostHog } from 'posthog-js/react'
import type { RunLimit, RunMode, TableViewWire } from '@/lib/api/contracts/tables'
import { captureEvent } from '@/lib/posthog/client'
import type {
  ColumnDefinition,
  Filter,
  Sort,
  SortDirection,
  TableMetadata,
  TableRow as TableRowType,
  TableViewConfig,
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
  useCreateTableView,
  useDeleteTable,
  useDeleteTableRowsAsync,
  useDeleteTableView,
  useExportTableAsync,
  useRenameTable,
  useRunColumn,
  useTableViews,
  useUpdateTableView,
} from '@/hooks/queries/tables'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import type { DeletedRowSnapshot } from '@/stores/table/types'
import {
  type ColumnConfig,
  ColumnConfigSidebar,
  ColumnsMenu,
  EnrichmentDetails,
  EnrichmentsSidebar,
  LockSettingsModal,
  NewColumnDropdown,
  RowModal,
  RunStatusControl,
  SaveViewModal,
  type SelectionSnapshot,
  TableActionBar,
  TableFilter,
  TableGrid,
  ViewsMenu,
  type WorkflowConfig,
  WorkflowSidebar,
} from './components'
import { COLUMN_SIDEBAR_WIDTH } from './components/table-grid/constants'
import { COLUMN_TYPE_ICONS } from './components/table-grid/headers'
import { useTable, useTableEventStream } from './hooks'
import {
  type BlockedTableAction,
  describeBlockedAction,
  describeLocks,
  lockedNouns,
} from './lock-copy'
import {
  ALL_VIEW_PARAM,
  DEFAULT_TABLE_DETAIL_SORT_DIRECTION,
  tableDetailParsers,
  tableDetailUrlKeys,
} from './search-params'
import type { QueryOptions } from './types'
import { generateColumnName } from './utils'

const logger = createLogger('Table')

/** Blocked-action toasts carry a button, so they linger past the 5s default. */
const BLOCKED_TOAST_MS = 8000

interface TableProps {
  /** When set, the table renders without its page header / breadcrumbs / page-level
   *  options bar. Used by the mothership chat panel to embed a table inline. */
  embedded?: boolean
  /** Identifiers — only set in embedded mode. Page mode reads from `useParams()`. */
  workspaceId?: string
  tableId?: string
  /**
   * Whether an admin may CHANGE locks, resolved server-side by the page (the
   * flag's gating lives in AppConfig and has no client counterpart). Defaults
   * to false so embedded renders, which have no server resolution, fail closed
   * — enforcement of stored locks is unaffected either way.
   */
  tableLocksEnabled?: boolean
  /**
   * Resolved `table-views` flag. Server-only to resolve for the same reason.
   * Defaults to `false` so the embedded mothership table — which has no server
   * context to resolve it — stays on today's Filter/Sort bar.
   */
  viewsEnabled?: boolean
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

/** Stable identity so a loading/disabled views query doesn't remint `[]` each render. */
const NO_VIEWS: TableViewWire[] = []

type ViewModalState = { mode: 'create' } | { mode: 'rename'; viewId: string } | null

/**
 * Order-insensitive JSON, used to compare a locally-built config against one that
 * has round-tripped through Postgres. `jsonb` does not preserve object key order
 * (`{status,plan}` comes back `{plan,status}`), so a plain `JSON.stringify` would
 * report any multi-key filter as permanently dirty. Array order is preserved —
 * it is meaningful for `columnOrder`.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
}

/**
 * Structural equality for the parts of a view config the user edits directly.
 * Column layout (widths/order/pinning) is excluded — it auto-saves into the
 * active view as the user drags, so it can never be the thing that is "unsaved".
 *
 * Compares serialized form rather than field-by-field because `filter` is an
 * arbitrarily nested predicate tree.
 */
function isSameViewConfig(a: TableViewConfig, b: TableViewConfig): boolean {
  const normalize = (config: TableViewConfig) =>
    stableStringify({
      filter: config.filter ?? null,
      sort: config.sort ?? null,
      hiddenColumns: [...(config.hiddenColumns ?? [])].sort(),
    })
  return normalize(a) === normalize(b)
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
  tableLocksEnabled = false,
  viewsEnabled = false,
}: TableProps = {}) {
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
  const [showLockSettings, setShowLockSettings] = useState(false)
  // Id of the last blocked-action toast, so a user who keeps typing into a
  // locked cell replaces one notice rather than stacking a column of them.
  const blockedToastIdRef = useRef<string | null>(null)
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
    hasRunningCell: false,
    hasActiveDispatch: false,
    hasWorkflowColumns: false,
    selectedRunScope: null,
    selectionStats: { hasIncompleteOrFailed: false, hasCompleted: false, hasInFlight: false },
    singleWorkflowCell: null,
  })
  const [filter, setFilter] = useState<Filter | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  /** Hidden **column ids**. Lives here (not in the grid) because the filter
   *  panel's Columns section edits it and the active view persists it. */
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])

  const [{ sort: sortColumn, dir: sortDirection, view: activeViewId }, setTableParams] =
    useQueryStates(tableDetailParsers, tableDetailUrlKeys)

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
  const {
    tableData,
    columns,
    tableWorkflowGroups,
    workflows,
    // Server-bound scopes use this: a filter condition the current schema
    // invalidated is pruned from the rows query, so the delete must target the
    // same predicate the grid is displaying.
    filter: effectiveFilter,
  } = useTable({
    workspaceId,
    tableId,
    queryOptions,
  })

  const { data: views = NO_VIEWS, isSuccess: viewsLoaded } = useTableViews({
    workspaceId,
    tableId,
    enabled: viewsEnabled,
  })
  const createViewMutation = useCreateTableView({ workspaceId, tableId })
  const updateViewMutation = useUpdateTableView({ workspaceId, tableId })
  const deleteViewMutation = useDeleteTableView({ workspaceId, tableId })

  /** The selected view, or `null` for the built-in "All" state. A view id that no
   *  longer resolves (deleted, stale bookmark) falls back to "All" rather than
   *  rendering an empty view. */
  const activeView = activeViewId ? (views.find((view) => view.id === activeViewId) ?? null) : null

  const [viewModal, setViewModal] = useState<ViewModalState>(null)
  /** Which view id the local filter/sort/hidden state was last seeded from.
   *  `undefined` means "nothing seeded yet" so the first resolve still runs. */
  const seededViewIdRef = useRef<string | null | undefined>(undefined)

  /** `keepUrlSort` leaves an explicitly deep-linked `?sort=` alone on the first
   *  seed — the URL is more specific than the view's stored default. */
  const applyViewConfig = useCallback(
    (config: TableViewConfig | null, keepUrlSort = false) => {
      setFilter(config?.filter ?? null)
      setHiddenColumns(config?.hiddenColumns ?? [])
      if (keepUrlSort) return
      const sortEntry = config?.sort ? Object.entries(config.sort)[0] : undefined
      setTableParams({
        sort: sortEntry ? sortEntry[0] : null,
        dir: sortEntry ? (sortEntry[1] as SortDirection) : null,
      })
    },
    [setTableParams]
  )

  /**
   * Resolves the active view and seeds the local filter/sort/hidden-column state
   * from it. Runs only when the *selected view id* changes, never on every edit,
   * so ad-hoc changes on top of a view are preserved until the user switches away.
   *
   * On first load with no `?view=` the table's default view (if any) is selected
   * and written into the URL explicitly — a link then keeps resolving to the same
   * view even after someone changes which view is default.
   */
  useEffect(() => {
    if (!viewsEnabled || !viewsLoaded) return

    if (seededViewIdRef.current === undefined) {
      if (activeViewId === null) {
        const defaultView = views.find((view) => view.isDefault)
        if (defaultView) {
          seededViewIdRef.current = defaultView.id
          setTableParams({ view: defaultView.id })
          applyViewConfig(defaultView.config, sortColumn !== null)
          return
        }
        // No view to adopt. Deliberately does NOT apply an empty config — that
        // would clear a deep-linked `?sort=` on mount.
        seededViewIdRef.current = null
        return
      }
      if (activeViewId === ALL_VIEW_PARAM) {
        seededViewIdRef.current = null
        return
      }
      // A `?view=` that resolves to nothing (deleted view, stale bookmark) falls
      // back to "All" without touching state, for the same reason. An explicit
      // `?sort=` alongside `?view=` also wins over the view's stored sort.
      seededViewIdRef.current = activeView?.id ?? null
      if (activeView) applyViewConfig(activeView.config, sortColumn !== null)
      return
    }

    // A selected id that doesn't resolve yet must not clear anything: right after
    // "Save as view" the URL names the new view before the list has refetched, and
    // clearing there would wipe the very filter that was just saved. Only an
    // explicit switch to "All" (`activeViewId === null`) resets.
    if (activeViewId !== null && activeViewId !== ALL_VIEW_PARAM && !activeView) return

    const nextViewId = activeView?.id ?? null
    if (seededViewIdRef.current === nextViewId) return
    seededViewIdRef.current = nextViewId
    applyViewConfig(activeView?.config ?? null)
  }, [
    viewsEnabled,
    viewsLoaded,
    views,
    activeView,
    activeViewId,
    sortColumn,
    applyViewConfig,
    setTableParams,
  ])

  /**
   * Live state pruned the same way `pruneViewConfig` prunes the stored config on
   * read. Without this, deleting a hidden or sorted column leaves the local ids
   * behind while the server drops them, so the dirty check never balances again —
   * Save writes the stale id, the response comes back pruned, and the chip is
   * stuck on. Guarded on the schema being loaded so an empty first render doesn't
   * prune everything.
   */
  const liveColumnIds = useMemo(() => new Set(columns.map(getColumnId)), [columns])
  const effectiveHiddenColumns = useMemo(
    () =>
      columns.length === 0 ? hiddenColumns : hiddenColumns.filter((id) => liveColumnIds.has(id)),
    [columns.length, hiddenColumns, liveColumnIds]
  )
  const effectiveSort = useMemo<Sort | null>(
    () =>
      !sortQuery || columns.length === 0
        ? sortQuery
        : Object.keys(sortQuery).every((id) => liveColumnIds.has(id))
          ? sortQuery
          : null,
    [sortQuery, columns.length, liveColumnIds]
  )

  /** The payload for creating a view, and the left-hand side of the dirty check.
   *  Carries the current layout so "Save as view" from "All" captures the widths /
   *  order / pins the grid is rendering (they live in the table's shared metadata
   *  until a view owns them) instead of creating a layout-less view that then
   *  resets the grid. Updates never send this — they send a merge patch. */
  const currentViewConfig = useMemo<TableViewConfig>(
    () => ({
      ...(activeView?.config ?? tableData?.metadata),
      filter,
      sort: effectiveSort,
      hiddenColumns: effectiveHiddenColumns,
    }),
    [activeView, tableData?.metadata, filter, effectiveSort, effectiveHiddenColumns]
  )

  /**
   * Whether the live state diverges from what the active view stores (or, on
   * "All", whether anything is applied at all). Drives the Save button — it is
   * the only affordance that persists, so ad-hoc exploration stays throwaway.
   */
  const isViewDirty = activeView
    ? !isSameViewConfig(currentViewConfig, activeView.config)
    : Boolean(filter) || Boolean(effectiveSort) || effectiveHiddenColumns.length > 0

  /** Rename targets a live view rather than a snapshot, so a concurrent rename or
   *  delete can't leave the modal editing stale data. */
  const renamingView =
    viewModal?.mode === 'rename' ? (views.find((v) => v.id === viewModal.viewId) ?? null) : null

  const handleSelectView = useCallback(
    (viewId: string | null) => {
      setTableParams({ view: viewId ?? ALL_VIEW_PARAM })
    },
    [setTableParams]
  )

  const handleRenameView = useCallback((viewId: string) => {
    setViewModal({ mode: 'rename', viewId })
  }, [])

  /** Column order/width/pinning auto-saves into the active view as the user drags,
   *  which is why `isSameViewConfig` excludes layout from the dirty check. Sent as
   *  a `configPatch` so the server merges it — two overlapping layout writes must
   *  not each replace the whole blob from their own snapshot. With no view active
   *  the grid keeps writing the table's shared metadata. */
  const handlePersistLayout = useCallback(
    (patch: TableMetadata) => {
      if (!activeView) return
      updateViewMutation.mutate(
        { viewId: activeView.id, configPatch: patch },
        { onError: (error) => toast.error(getErrorMessage(error, 'Failed to save layout')) }
      )
    },
    [activeView]
  )

  const handleSaveView = () => {
    if (activeView) {
      // Only the fields Save owns, merged server-side — never a client-built full
      // config. A full replace from a cached snapshot would drop a layout write
      // still in flight (and vice versa). `null`/`[]` merge as explicit values, so
      // clearing a filter or unhiding every column still persists as a removal.
      updateViewMutation.mutate(
        {
          viewId: activeView.id,
          configPatch: {
            filter,
            sort: effectiveSort,
            hiddenColumns: effectiveHiddenColumns,
          },
        },
        { onError: (error) => toast.error(getErrorMessage(error, 'Failed to save view')) }
      )
      return
    }
    setViewModal({ mode: 'create' })
  }

  const handleSubmitViewName = (name: string) => {
    if (viewModal?.mode === 'rename') {
      updateViewMutation.mutate(
        { viewId: viewModal.viewId, name },
        {
          onSuccess: () => setViewModal(null),
          onError: (error) => toast.error(getErrorMessage(error, 'Failed to rename view')),
        }
      )
      return
    }
    createViewMutation.mutate(
      { name, config: currentViewConfig },
      {
        onSuccess: (view) => {
          setViewModal(null)
          // Mark as seeded before selecting so the resolve effect doesn't re-apply the config.
          seededViewIdRef.current = view.id
          setTableParams({ view: view.id })
        },
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to create view')),
      }
    )
  }

  const handleDeleteView = useCallback(
    (viewId: string) => {
      deleteViewMutation.mutate(viewId, {
        onSuccess: () => {
          if (viewId === activeViewId) setTableParams({ view: ALL_VIEW_PARAM })
        },
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to delete view')),
      })
    },
    [activeViewId, setTableParams]
  )

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
      onSort: (column, direction) => setTableParams({ sort: column, dir: direction }),
      /**
       * Clearing writes the default direction (stripped by clearOnDefault) and
       * drops the column, leaving a clean URL with no active sort.
       */
      onClear: () => setTableParams({ sort: null, dir: DEFAULT_TABLE_DETAIL_SORT_DIRECTION }),
    }),
    [columnOptions, sortColumn, sortDirection, setTableParams]
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
              // Reachable with the flag off when something is locked, so an
              // admin can always clear locks (the route allows clearing).
              ...(userPermissions.canAdmin &&
              (tableLocksEnabled || lockedNouns(tableData.locks).length > 0)
                ? [
                    {
                      label: 'Lock settings',
                      icon: Lock,
                      onClick: () => setShowLockSettings(true),
                    },
                  ]
                : []),
              {
                label: 'Delete',
                icon: Trash,
                onClick: onRequestDeleteTable,
                disabled: userPermissions.canEdit !== true || tableData.locks.deleteLocked,
              },
            ],
          }
        : { label: '…', terminal: true },
    ],
    [
      handleNavigateBack,
      userPermissions.canAdmin,
      userPermissions.canEdit,
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

  // An admin can always reach the settings on a locked table — clearing locks
  // stays allowed with the flag off, so the kill switch can't strand one. With
  // the flag off and nothing locked there is nothing to change, so the toast is
  // a plain notice with no action.
  const canOpenLockSettings =
    userPermissions.canAdmin === true &&
    (tableLocksEnabled || (tableData ? lockedNouns(tableData.locks).length > 0 : false))

  /**
   * Explains why a table mutation is unavailable. A toast rather than a modal:
   * being told you can't edit shouldn't cost a dismiss click, and admins still
   * get a direct route to the settings via the action button.
   */
  const showBlockedToast = useCallback(
    (action: BlockedTableAction) => {
      if (!tableData) return
      if (blockedToastIdRef.current) toast.dismiss(blockedToastIdRef.current)
      const { title, text } = describeBlockedAction(action, tableData.locks)
      blockedToastIdRef.current = toast.warning(title, {
        description: text,
        ...(canOpenLockSettings
          ? {
              action: { label: 'Lock settings', onClick: () => setShowLockSettings(true) },
              // An action would otherwise pin the toast open until dismissed.
              duration: BLOCKED_TOAST_MS,
            }
          : {}),
      })
    },
    [tableData, canOpenLockSettings]
  )

  const headerActions = useMemo(() => {
    if (!tableData) return undefined
    // Header space is for state, not for settings: the chip appears only once
    // something is actually locked, and names the mode so it reads at a glance.
    // Reaching the panel on an unlocked table is the dropdown's job.
    const anyLocked = lockedNouns(tableData.locks).length > 0
    return [
      ...(anyLocked
        ? [
            {
              label: describeLocks(tableData.locks).name,
              icon: Lock,
              onClick: () =>
                userPermissions.canAdmin ? setShowLockSettings(true) : showBlockedToast('status'),
            },
          ]
        : []),
      {
        label: 'Import CSV',
        icon: Upload,
        onClick: onRequestImportCsv,
        // An import always inserts, so the insert lock disables it outright
        // rather than letting the dialog run to a server-side 423.
        disabled: userPermissions.canEdit !== true || tableData.locks.insertLocked,
      },
      {
        label: 'Export CSV',
        icon: Download,
        onClick: () => void handleExportCsv(),
        disabled: tableData.rowCount === 0,
      },
    ]
  }, [
    tableData,
    userPermissions.canEdit,
    userPermissions.canAdmin,
    handleExportCsv,
    onRequestImportCsv,
    showBlockedToast,
  ])

  // Adding a column is a schema change. The trigger stays visible when the
  // table is schema-locked and explains itself instead of disappearing.
  const canMutateSchema = userPermissions.canEdit && !tableData?.locks.schemaLocked
  const createTrigger = userPermissions.canEdit ? (
    <NewColumnDropdown
      trigger='header'
      disabled={false}
      blocked={!canMutateSchema}
      onBlocked={() => showBlockedToast('add-column')}
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
      // The pruned filter, not the raw one: a condition the current schema
      // invalidated is not applied to the grid, so showing the chip as active
      // (and reopening that rule) would claim a filter the rows do not reflect.
      active: filterOpen || !!effectiveFilter,
      onToggle: handleToggleFilter,
    }),
    [filterOpen, effectiveFilter, handleToggleFilter]
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
                  queueing={!selection.hasRunningCell}
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
          <>
            {viewsEnabled && (
              <ViewsMenu
                views={views}
                activeViewId={activeView?.id ?? null}
                onSelect={handleSelectView}
                onRename={handleRenameView}
                onDelete={handleDeleteView}
                canEdit={userPermissions.canEdit}
              />
            )}
            {embedded && (selection.totalRunning > 0 || selection.hasActiveDispatch) ? (
              <RunStatusControl
                running={selection.totalRunning}
                queueing={!selection.hasRunningCell}
                onStopAll={onStopAll}
                isStopping={cancelRunsMutation.isPending}
              />
            ) : null}
          </>
        }
        asideEnd={
          viewsEnabled ? (
            <ColumnsMenu
              columns={columns}
              workflowGroups={tableWorkflowGroups}
              hiddenColumns={effectiveHiddenColumns}
              onChange={setHiddenColumns}
            />
          ) : undefined
        }
        trailing={
          viewsEnabled && isViewDirty && userPermissions.canEdit ? (
            <Chip onClick={handleSaveView} disabled={updateViewMutation.isPending}>
              {activeView ? 'Save' : 'Save as view'}
            </Chip>
          ) : undefined
        }
      />
      {filterOpen && (
        <TableFilter
          columns={columns}
          filter={effectiveFilter}
          onApply={handleFilterApply}
          onClose={() => setFilterOpen(false)}
        />
      )}
      <SaveViewModal
        open={viewsEnabled && (viewModal?.mode === 'create' || renamingView !== null)}
        onOpenChange={(open) => !open && setViewModal(null)}
        mode={viewModal?.mode ?? 'create'}
        initialName={renamingView?.name ?? ''}
        onSubmit={handleSubmitViewName}
        isSubmitting={createViewMutation.isPending || updateViewMutation.isPending}
      />
      <TableGrid
        workspaceId={workspaceId}
        tableId={tableId}
        embedded={embedded}
        locks={tableData?.locks}
        onBlockedAction={showBlockedToast}
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
        hiddenColumns={effectiveHiddenColumns}
        viewLayout={activeView?.config ?? null}
        viewLayoutKey={activeView?.id ?? null}
        onPersistLayout={activeView ? handlePersistLayout : undefined}
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
        srTitle='Delete rows'
        title='Delete rows'
        text={`Delete ${deletingAll ? deletingAll.estimatedCount.toLocaleString() : 0} ${
          deletingAll?.estimatedCount === 1 ? 'row' : 'rows'
        }${effectiveFilter ? ' matching the current filter' : ''}? This can't be undone.`}
        confirm={{
          label: 'Delete',
          pending: deleteRowsAsyncMutation.isPending,
          pendingLabel: 'Deleting...',
          onClick: () => {
            if (!deletingAll) return
            const { excludeRowIds, estimatedCount } = deletingAll
            deleteRowsAsyncMutation.mutate({
              filter: effectiveFilter ?? undefined,
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
            : 'Delete Column'
        }
        title={
          deletingColumns && deletingColumns.length > 1
            ? `Delete ${deletingColumns.length} Columns`
            : 'Delete Column'
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
          srTitle='Delete Table'
          title='Delete Table'
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
      {tableData && userPermissions.canAdmin && (
        <LockSettingsModal
          isOpen={showLockSettings}
          onClose={() => setShowLockSettings(false)}
          workspaceId={workspaceId}
          tableId={tableData.id}
          locks={tableData.locks}
        />
      )}
    </Resource>
  )
}
