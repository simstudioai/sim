'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Chip, ChipConfirmModal, toast } from '@sim/emcn'
import { Download, Lock, Pencil, Trash, Upload } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isEqual } from 'es-toolkit'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { usePostHog } from 'posthog-js/react'
import type { RunLimit, RunMode, TableViewWire } from '@/lib/api/contracts/tables'
import { captureEvent } from '@/lib/posthog/client'
import type {
  ColumnDefinition,
  Predicate,
  SortDirection,
  SortSpec,
  TableMetadata,
  TablePredicate,
  TableRow as TableRowType,
  TableViewConfig,
  WorkflowGroup,
} from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'
import { withCellValueFilter } from '@/lib/table/query-builder/cell-filter'
import {
  type BreadcrumbItem,
  type ColumnOption,
  Resource,
  type SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import {
  FOLDERED_RESOURCE_HEADERS,
  folderBreadcrumbItems,
  folderedResourceListHref,
  useFolderAncestors,
} from '@/app/workspace/[workspaceId]/components/folders'
import { PresenceAvatars } from '@/app/workspace/[workspaceId]/components/presence/presence-avatars'
import { LogDetails } from '@/app/workspace/[workspaceId]/logs/components'
import { useFeatureFlag } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  getTableViewRevision,
  resolveTableViewConfig,
  resolveTableViewPinTransition,
  resolveTableViewSelection,
  shouldApplyTableViewRevision,
  type TableViewRevision,
} from '@/app/workspace/[workspaceId]/tables/[tableId]/view-state'
import { ImportCsvDialog } from '@/app/workspace/[workspaceId]/tables/components/import-csv-dialog'
import { ImportProgressMenu } from '@/app/workspace/[workspaceId]/tables/components/import-progress-menu'
import { useLogByExecutionId } from '@/hooks/queries/logs'
import {
  downloadExportResult,
  useCancelTableRuns,
  useCreateTableView,
  useDeleteTable,
  useDeleteTableRowsAsync,
  useDeleteTableView,
  useExportTable,
  useRenameTable,
  useRunColumn,
  useTableViews,
  useUpdateTableMetadata,
  useUpdateTableView,
} from '@/hooks/queries/tables'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import type { DeletedRowSnapshot } from '@/stores/table/types'
import { useTableViewPinStore } from '@/stores/table/view-pin/store'
import {
  type ColumnConfig,
  ColumnConfigSidebar,
  ColumnDropdown,
  ColumnsMenu,
  EnrichmentDetails,
  EnrichmentsSidebar,
  LockSettingsModal,
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
import { columnTypeIcon } from './components/table-grid/headers'
import { useTable, useTableEventStream, useTableRoom } from './hooks'
import { type BlockedTableAction, describeBlockedAction, lockedNouns } from './lock-copy'
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
   * Saved view to adopt on first seed instead of the table's default —
   * embedded mode only, set when the agent opened this table pinned to a
   * view. Participates only in the one-time adoption branch, so it never
   * fights a later user switch.
   */
  initialViewId?: string
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

/** New views are named before configuration; rename targets an existing view. */
type ViewModalState = { mode: 'new' } | { mode: 'rename'; viewId: string } | null

interface ViewConfigKeep {
  sort?: boolean
  filter?: boolean
  hiddenColumns?: boolean
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
  initialViewId,
  workspaceId: propWorkspaceId,
  tableId: propTableId,
}: TableProps = {}) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = propWorkspaceId || (params.workspaceId as string)
  const tableId = propTableId || (params.tableId as string)

  const posthog = usePostHog()
  const tableRowTtlEnabled = useFeatureFlag('table-row-ttl')
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

  // Live table presence (cell-selection carets + avatars). Runs in both modes so the
  // mothership chat panel shows collaborators' live selections too. The avatar stack lives
  // only in the `!embedded` Resource.Header, so the embedded panel gets carets without avatars
  // for free — matching the panel's own-chrome layout.
  const { otherUsers: presenceUsers, remoteSelections, emitCellSelection } = useTableRoom(tableId)

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
  const [filter, setFilter] = useState<TablePredicate | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  /** Bumped whenever the filter is replaced from outside the panel, to re-seed
   *  its rule rows. See {@link replaceFilter}. */
  const [filterSeed, setFilterSeed] = useState(0)
  /** Hidden **column ids**. Lives here (not in the grid) because the filter
   *  panel's Columns section edits it and the active view persists it. */
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])

  const [{ sort: sortColumn, dir: sortDirection, view: activeViewId }, setTableParams] =
    useQueryStates(tableDetailParsers, tableDetailUrlKeys)

  // Read-only mirrors for the resolve effect and replaceFilter's echo check:
  // both must read the current values without re-running when they change.
  const filterRef = useRef(filter)
  filterRef.current = filter
  const hiddenColumnsRef = useRef(hiddenColumns)
  hiddenColumnsRef.current = hiddenColumns

  /** Resolved single-column sort as an ordered spec, or `null` when none is active. */
  const sortQuery = useMemo<SortSpec | null>(
    () => (sortColumn ? [{ field: sortColumn, direction: sortDirection }] : null),
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

  const { data: viewsData, isError: viewsErrored } = useTableViews({
    workspaceId,
    tableId,
  })
  const views = viewsData ?? NO_VIEWS
  /** A views list exists — fresh or cached. A failed background refetch flips
   *  `isError` while the cached list stays perfectly usable (and every view
   *  mutation invalidates this query), so success/error is the wrong axis:
   *  what matters is whether there is a list to resolve against. */
  const viewsAvailable = viewsData !== undefined

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
  const tableAvailable = tableData !== undefined
  const createViewMutation = useCreateTableView({ workspaceId, tableId })
  const updateViewMutation = useUpdateTableView({ workspaceId, tableId })
  const updateMetadataMutation = useUpdateTableMetadata({ workspaceId, tableId })
  const deleteViewMutation = useDeleteTableView({ workspaceId, tableId })

  /** Resolve the restored or default view synchronously so the grid, autosave
   *  owner, and menu agree before the URL effect records the adopted view id. */
  const { selectedView, defaultView, activeView } = resolveTableViewSelection(
    views,
    activeViewId,
    embedded ? initialViewId : undefined
  )
  const activeViewConfig = useMemo(
    () => resolveTableViewConfig(tableData?.metadata, activeView?.config ?? null),
    [tableData?.metadata, activeView?.config]
  )

  const [viewModal, setViewModal] = useState<ViewModalState>(null)
  /** Which persisted view revision last seeded the local filter/sort/hidden state.
   *  `undefined` means "nothing seeded yet" so the first resolve still runs. */
  const appliedViewRevisionRef = useRef<TableViewRevision | undefined>(undefined)

  /**
   * A view this client just created, held only until the list refetch carries it.
   * Distinct from `appliedViewRevisionRef`, which is stamped on EVERY selection —
   * reusing that for the create race also matched a view that had been selected
   * normally and then deleted, so the delete never cleaned up.
   */
  const pendingCreatedViewIdRef = useRef<string | null>(null)

  /** View config gestures made before the views query identifies their owner. */
  const pendingViewConfigRef = useRef<TableViewConfig | null>(null)

  /**
   * State deliberately kept over the first view seed. Deep-linked sort remains
   * authoritative until the user changes it; early filter/column gestures stay
   * protected until their queued patch succeeds.
   */
  const preservedViewStateRef = useRef<{ viewId: string; keep: ViewConfigKeep } | null>(null)

  /**
   * Replaces the filter from OUTSIDE the filter panel — a view switch, or
   * "Filter by cell value". Bumps {@link filterSeed} so the panel re-seeds: it
   * builds its draft rule rows from the predicate once at mount, so without
   * this an open panel keeps showing the rules of the filter it replaced.
   *
   * The remount discards an unapplied draft, which is the point — the rules on
   * screen must be the rules in effect. An incoming filter identical to the
   * current one is skipped entirely: the resolve effect re-applies the config
   * after this client's own autosave settles, and letting that echo remount an
   * open panel would wipe keystrokes typed since the flush and steal focus.
   */
  const replaceFilter = useCallback((next: TablePredicate | null) => {
    if (isEqual(next, filterRef.current)) return
    setFilter(next)
    setFilterSeed((seed) => seed + 1)
  }, [])

  /**
   * Applies a view's config to the live state. `keep` marks slices the user has
   * already set by hand. A deep-linked `?sort=` is more specific than the view's
   * default, and a filter typed while the views query was still in flight should
   * not be thrown away when it lands. Switching views later passes no `keep`, so
   * the incoming view fully replaces the outgoing one.
   */
  const applyViewConfig = useCallback(
    (config: TableViewConfig | null, keep?: ViewConfigKeep) => {
      if (!keep?.filter) replaceFilter(config?.filter ?? null)
      if (!keep?.hiddenColumns) setHiddenColumns(config?.hiddenColumns ?? [])
      if (keep?.sort) return
      const sortEntry = config?.sort?.[0]
      setTableParams({
        sort: sortEntry ? sortEntry.field : null,
        dir: sortEntry ? (sortEntry.direction as SortDirection) : null,
      })
    },
    [replaceFilter, setTableParams]
  )

  /** Reader for the grid's CURRENT column layout, populated by the grid itself.
   *  The grid owns widths/order/pinning, so the wrapper asks at the moment it
   *  needs them instead of mirroring every patch — a mirror only stays right
   *  while every write flows through it, and layout writes bypass it whenever
   *  All is active. */
  const layoutSnapshotRef = useRef<(() => TableMetadata) | null>(null)
  const readLayout = useCallback((): TableMetadata => layoutSnapshotRef.current?.() ?? {}, [])

  /** Layout patch the user committed before the views query identified its owner. */
  const pendingLayoutPatchRef = useRef<TableMetadata | null>(null)

  /** Whether the resolve effect has decided the initial owner — including the
   *  terminal-error fallback to All. Until then a write that reads "All" might
   *  actually belong to a default view about to be adopted, so it buffers. */
  const ownerResolvedRef = useRef(false)

  /**
   * Resolves that pending layout once the resolve effect has picked an owner.
   *
   * Called from the resolve effect rather than keyed on the URL selection:
   * default adoption is resolved synchronously before that URL catches up.
   */
  const resolvePendingLayout = useCallback(
    (viewId: string | null) => {
      const patch = pendingLayoutPatchRef.current
      pendingLayoutPatchRef.current = null
      if (!patch || !userPermissions.canEdit) return
      if (viewId) {
        updateViewMutation.mutate(
          { viewId, configPatch: patch },
          { onError: (error) => toast.error(getErrorMessage(error, 'Failed to save layout')) }
        )
        return
      }
      updateMetadataMutation.mutate(patch)
    },
    [userPermissions.canEdit]
  )

  /** What the user has already set by hand when the first view resolves. */
  const localWork = () => {
    const pending = pendingViewConfigRef.current
    return {
      sort: sortColumn !== null || Boolean(pending && 'sort' in pending),
      filter: filterRef.current !== null || Boolean(pending && 'filter' in pending),
      hiddenColumns:
        hiddenColumnsRef.current.length > 0 || Boolean(pending && 'hiddenColumns' in pending),
    }
  }

  const preserveViewState = useCallback((viewId: string, keep: ViewConfigKeep | undefined) => {
    if (!keep || (!keep.sort && !keep.filter && !keep.hiddenColumns)) {
      preservedViewStateRef.current = null
      return
    }
    preservedViewStateRef.current = { viewId, keep }
  }, [])

  const releasePersistedViewState = useCallback((viewId: string, patch: TableViewConfig) => {
    const preserved = preservedViewStateRef.current
    if (!preserved || preserved.viewId !== viewId) return
    const keep = { ...preserved.keep }
    if ('sort' in patch) keep.sort = undefined
    if ('filter' in patch) keep.filter = undefined
    if ('hiddenColumns' in patch) keep.hiddenColumns = undefined
    preservedViewStateRef.current =
      keep.sort || keep.filter || keep.hiddenColumns ? { viewId, keep } : null
  }, [])

  const flushPendingViewConfig = useCallback(
    (viewId: string) => {
      const configPatch = pendingViewConfigRef.current
      if (!configPatch || !userPermissions.canEdit) return
      pendingViewConfigRef.current = null
      updateViewMutation.mutate(
        { viewId, configPatch },
        {
          onSuccess: () => releasePersistedViewState(viewId, configPatch),
          onError: (error) => toast.error(getErrorMessage(error, 'Failed to save view')),
        }
      )
    },
    [userPermissions.canEdit, releasePersistedViewState]
  )

  /**
   * Resolves the active view and seeds the local filter/sort/hidden-column state
   * from it. A different view always applies; a newer revision of the same view
   * applies once this client's autosave queue settles. That lets navigation
   * rehydrate a freshly saved filter without an intermediate response rewinding
   * a newer local gesture.
   *
   * On first load with no `?view=` the table's default view (if any) is selected
   * and written into the URL explicitly — a link then keeps resolving to the same
   * view even after someone changes which view is default.
   */
  useEffect(() => {
    // Terminal only when the fetch failed WITHOUT ever producing a list — then
    // the table settles to All: mark the owner resolved so layout writes flow
    // to shared metadata, and flush what was touched during the load. It does
    // NOT stamp `appliedViewRevisionRef` — that would consume the first resolve, and a
    // later successful refetch must still run adoption (with `localWork` keep,
    // so filters set while errored survive). An error with a cached list falls
    // through — the list is still resolvable.
    if (viewsErrored && !viewsAvailable) {
      ownerResolvedRef.current = true
      resolvePendingLayout(null)
      return
    }
    if (!viewsAvailable || !tableAvailable) return
    ownerResolvedRef.current = true
    if (appliedViewRevisionRef.current === undefined) {
      // Embedded tables bind these parsers to the HOST page's URL, which the
      // mothership panel keeps across resource switches. A view id this table
      // can't resolve was left by the previously-open resource — ignore it so
      // this table picks its own default. A param it CAN resolve is honoured.
      const inheritedParams =
        embedded &&
        activeViewId !== null &&
        activeViewId !== ALL_VIEW_PARAM &&
        selectedView === null
      // Until the backfill ships, All remains the compatibility state for a
      // table with no persisted default. Once a default exists, an old All URL
      // upgrades to that view instead of preserving the synthetic state.
      const legacyAllWithDefault = activeViewId === ALL_VIEW_PARAM && defaultView !== null

      if (activeViewId === null || inheritedParams || legacyAllWithDefault) {
        // Embedded mode may pin the view the agent opened this table on
        // (`initialViewId`); the pin outranks the persisted default for this
        // first adoption.
        const pinnedView =
          embedded && initialViewId ? views.find((view) => view.id === initialViewId) : undefined
        const viewToApply = pinnedView ?? defaultView
        // `sort` rides the same host URL, so when the view id is inherited the
        // sort beside it is too — not local work, and it must not suppress the
        // default view's own sort.
        const keep = inheritedParams ? { ...localWork(), sort: false } : localWork()
        if (viewToApply) {
          appliedViewRevisionRef.current = getTableViewRevision(viewToApply)
          setTableParams({ view: viewToApply.id })
          preserveViewState(viewToApply.id, keep)
          applyViewConfig(resolveTableViewConfig(tableData?.metadata, viewToApply.config), keep)
          resolvePendingLayout(viewToApply.id)
          flushPendingViewConfig(viewToApply.id)
          return
        }
        // No view to adopt. Deliberately does NOT apply an empty config — that
        // would clear a deep-linked `?sort=` on mount. Inherited params are the
        // exception: nothing about them refers to this table, so they're cleared.
        appliedViewRevisionRef.current = getTableViewRevision(null)
        if (inheritedParams) setTableParams({ view: ALL_VIEW_PARAM, sort: null, dir: null })
        resolvePendingLayout(null)
        return
      }
      if (activeViewId === ALL_VIEW_PARAM) {
        appliedViewRevisionRef.current = getTableViewRevision(null)
        resolvePendingLayout(null)
        return
      }
      // A `?view=` that resolves to nothing adopts the persisted default when
      // one exists; tables awaiting backfill retain the legacy All fallback.
      const viewToAdopt = selectedView ?? defaultView
      const keep = localWork()
      appliedViewRevisionRef.current = getTableViewRevision(viewToAdopt)
      resolvePendingLayout(viewToAdopt?.id ?? null)
      if (selectedView) {
        preserveViewState(selectedView.id, keep)
        applyViewConfig(resolveTableViewConfig(tableData?.metadata, selectedView.config), keep)
        flushPendingViewConfig(selectedView.id)
      } else if (defaultView) {
        setTableParams({ view: defaultView.id })
        preserveViewState(defaultView.id, keep)
        applyViewConfig(resolveTableViewConfig(tableData?.metadata, defaultView.config), keep)
        flushPendingViewConfig(defaultView.id)
      } else {
        // Nothing to apply, but the URL still names a view that no longer exists.
        // Rewrite it so a stale bookmark can't be copied on, and so the param
        // matches the All the UI is already showing.
        setTableParams({ view: ALL_VIEW_PARAM })
      }
      return
    }

    /** Creating a view updates the query cache before nuqs commits its URL id.
     *  Keep the blank view already applied in the success handler during that
     *  gap instead of briefly reapplying the previously selected view. */
    if (pendingCreatedViewIdRef.current && activeViewId !== pendingCreatedViewIdRef.current) {
      return
    }

    // The id resolved, so any create race for it is over.
    if (selectedView && pendingCreatedViewIdRef.current === selectedView.id) {
      pendingCreatedViewIdRef.current = null
    }

    // A selected id that doesn't resolve is one of two things. Ours — creation
    // writes the URL before the list refetches, and clearing there would wipe the
    // config just saved. Or genuinely dead (deleted by someone else, stale
    // bookmark), where leaving it applied keeps the grid narrowed under the
    // wrong label because the menu resolves the same missing view to null.
    if (activeViewId !== null && activeViewId !== ALL_VIEW_PARAM && !selectedView) {
      if (pendingCreatedViewIdRef.current === activeViewId) return
      preservedViewStateRef.current = null
      appliedViewRevisionRef.current = getTableViewRevision(defaultView)
      setTableParams({ view: defaultView?.id ?? ALL_VIEW_PARAM })
      applyViewConfig(resolveTableViewConfig(tableData?.metadata, defaultView?.config ?? null))
      return
    }

    // Embedded tables record the adopted id BEFORE the revision guard can bail:
    // `resolveTableViewSelection` resolves a null param to the restored view, so
    // leaving the param unwritten lets a later render drift back to the default.
    // Standalone tables have no restored view and keep writing it below.
    if (embedded && activeView && activeViewId === null) {
      setTableParams({ view: activeView.id })
    }
    const nextViewRevision = getTableViewRevision(activeView)
    if (
      !shouldApplyTableViewRevision(
        appliedViewRevisionRef.current,
        nextViewRevision,
        updateViewMutation.isPending
      )
    ) {
      return
    }
    appliedViewRevisionRef.current = nextViewRevision
    const nextViewId = nextViewRevision.id
    const preserved = preservedViewStateRef.current
    if (preserved && preserved.viewId !== nextViewId) {
      preservedViewStateRef.current = null
    }
    if (activeView && (activeViewId === null || activeViewId === ALL_VIEW_PARAM)) {
      setTableParams({ view: activeView.id })
    }
    const keep = preserved?.viewId === nextViewId ? preserved.keep : undefined
    applyViewConfig(activeViewConfig, keep)
    if (activeView) flushPendingViewConfig(activeView.id)
  }, [
    viewsAvailable,
    viewsErrored,
    tableAvailable,
    views,
    selectedView,
    defaultView,
    activeView,
    activeViewConfig,
    activeViewId,
    embedded,
    sortColumn,
    updateViewMutation.isPending,
    applyViewConfig,
    setTableParams,
    resolvePendingLayout,
    preserveViewState,
    flushPendingViewConfig,
    tableData?.metadata,
  ])

  /**
   * A view the agent just created or edited (see the view-pin store). Applied
   * only once the views list carries it — the pin arrives ahead of the list
   * refetch, and writing the URL earlier would name a view the effect above
   * resolves to nothing and treats as dead. First adoption is left to that
   * effect (it honours `initialViewId` itself); a pin that turns out to be the
   * view already applied is consumed without a URL write.
   */
  const viewPin = useTableViewPinStore((state) => state.pins[tableId])
  const consumeViewPin = useTableViewPinStore((state) => state.consume)
  useEffect(() => {
    if (!embedded || !viewPin) return
    if (appliedViewRevisionRef.current === undefined) return
    if (!views.some((view) => view.id === viewPin.viewId)) return
    consumeViewPin(tableId, viewPin.seq)
    const transition = resolveTableViewPinTransition(
      activeViewId,
      appliedViewRevisionRef.current.id,
      viewPin.viewId,
      pendingCreatedViewIdRef.current
    )
    pendingCreatedViewIdRef.current = transition.pendingCreatedViewId
    if (!transition.nextViewId) return
    preservedViewStateRef.current = null
    setTableParams({ view: transition.nextViewId })
    // `viewsAvailable`/`tableAvailable` are what gate first adoption, and
    // adoption records itself in a ref, which re-renders nothing. Without them
    // a pin that arrives before the table is ready is never reconsidered — the
    // restore path has no query invalidation to nudge `views` and rescue it.
  }, [
    embedded,
    viewPin,
    views,
    activeViewId,
    tableId,
    viewsAvailable,
    tableAvailable,
    consumeViewPin,
    setTableParams,
  ])

  /**
   * Live state pruned the same way `pruneViewConfig` prunes the stored config on
   * read. Without this, deleting a hidden or sorted column leaves the local ids
   * behind while the server drops them. Guarded on the schema being loaded so
   * an empty first render doesn't prune everything.
   */
  const liveColumnIds = useMemo(() => new Set(columns.map(getColumnId)), [columns])
  const effectiveHiddenColumns = useMemo(
    () =>
      columns.length === 0 ? hiddenColumns : hiddenColumns.filter((id) => liveColumnIds.has(id)),
    [columns.length, hiddenColumns, liveColumnIds]
  )

  /** Rename targets a live view rather than a snapshot, so a concurrent rename or
   *  delete can't leave the modal editing stale data. */
  const renamingView =
    viewModal?.mode === 'rename' ? (views.find((v) => v.id === viewModal.viewId) ?? null) : null

  const handleSelectView = useCallback(
    (viewId: string | null) => {
      preservedViewStateRef.current = null
      setTableParams({ view: viewId ?? ALL_VIEW_PARAM })
    },
    [setTableParams]
  )

  const handleRenameView = useCallback((viewId: string) => {
    setViewModal({ mode: 'rename', viewId })
  }, [])

  const handleSetDefaultView = useCallback((viewId: string) => {
    updateViewMutation.mutate(
      { viewId, isDefault: true },
      {
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to set default view')),
      }
    )
  }, [])

  const handleNewView = useCallback(() => {
    setViewModal({ mode: 'new' })
  }, [])

  /**
   * Persists one user-committed view change. Filter application, sorting, and
   * column visibility are discrete gestures, so they can save immediately
   * without the document-style debounce needed for text editing. The mutation
   * hook serializes patches for this table, preserving click order when several
   * visibility changes happen before the first request settles.
   */
  const persistActiveViewConfig = useCallback(
    (configPatch: TableViewConfig) => {
      if (!userPermissions.canEdit) return
      const viewId = activeView?.id ?? pendingCreatedViewIdRef.current
      if (!viewId) {
        if (!ownerResolvedRef.current) {
          pendingViewConfigRef.current = {
            ...pendingViewConfigRef.current,
            ...configPatch,
          }
        }
        return
      }

      updateViewMutation.mutate(
        { viewId, configPatch },
        {
          onSuccess: () => releasePersistedViewState(viewId, configPatch),
          onError: (error) => toast.error(getErrorMessage(error, 'Failed to save view')),
        }
      )
    },
    [activeView?.id, userPermissions.canEdit, releasePersistedViewState]
  )

  /**
   * Drops a sort whose column was deleted from the URL and, only when the saved
   * view names that same field, from persistence. A stale deep-link can name a
   * missing field while the view still owns a different valid sort, which must
   * not be erased.
   */
  useEffect(() => {
    if (!sortColumn || columns.length === 0) return
    if (liveColumnIds.has(sortColumn)) return
    setTableParams({ sort: null, dir: null })
    if (activeViewConfig?.sort?.[0]?.field === sortColumn) {
      persistActiveViewConfig({ sort: null })
    }
  }, [
    sortColumn,
    columns.length,
    liveColumnIds,
    activeViewConfig?.sort,
    setTableParams,
    persistActiveViewConfig,
  ])

  /** Column order/width/pinning auto-saves into the active view as the user drags.
   *  Sent as a `configPatch` so the server merges it — two overlapping layout writes must
   *  not each replace the whole blob from their own snapshot. With All selected
   *  the sink is unbound and the grid writes the table's shared metadata instead;
   *  while the views query is still loading the sink IS bound and the write is
   *  suppressed, because the owner isn't known yet. */
  const handlePersistLayout = useCallback(
    (patch: TableMetadata, owner: string | null) => {
      // The resize grip and drag handles stay live for read-only members, so
      // without this a resize fires a write-gated PATCH and an error toast. Local
      // layout still updates — only the persist is suppressed.
      if (!userPermissions.canEdit) return
      // `owner` is stamped by the GRID — the layout source it was displaying
      // when the write happened — so routing no longer depends on when the
      // resolve effect ran relative to the grid's own effects. A write stamped
      // with a view id is fully addressed: route it even before the first
      // resolve (a deep-linked view's seed reconcile must persist, not buffer)
      // or before the list refetch resolves a just-created view.
      const target = owner ?? pendingCreatedViewIdRef.current
      if (target) {
        updateViewMutation.mutate(
          { viewId: target, configPatch: patch },
          { onError: (error) => toast.error(getErrorMessage(error, 'Failed to save layout')) }
        )
        return
      }
      // Owner reads "All", but the resolve effect hasn't confirmed that yet —
      // retain the exact gesture so adoption can save it to the selected owner.
      if (!ownerResolvedRef.current) {
        pendingLayoutPatchRef.current = { ...pendingLayoutPatchRef.current, ...patch }
        return
      }
      updateMetadataMutation.mutate(patch)
    },
    [userPermissions.canEdit]
  )

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
    // New views start unfiltered and are configured after naming. They inherit
    // the live layout so creation never visually resets the grid.
    const config: TableViewConfig = {
      ...(activeView?.config ?? tableData?.metadata),
      ...readLayout(),
      filter: null,
      sort: null,
      hiddenColumns: [],
    }
    createViewMutation.mutate(
      { name, config },
      {
        onSuccess: (view) => {
          setViewModal(null)
          // Stamp before selecting so the resolve effect treats this as already
          // seeded — it can't tell a just-created view from a dead id otherwise.
          appliedViewRevisionRef.current = getTableViewRevision(view)
          pendingCreatedViewIdRef.current = view.id
          setTableParams({ view: view.id })
          // Apply the clean config immediately; nuqs batches its sort write with
          // the `view` write above into one URL update.
          applyViewConfig(view.config)
        },
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to create view')),
      }
    )
  }

  const handleDeleteView = useCallback(
    (viewId: string) => {
      if (views.some((view) => view.id === viewId && view.isDefault)) {
        toast.error('Set another view as default before deleting this view')
        return
      }
      deleteViewMutation.mutate(viewId, {
        onSuccess: () => {
          if (viewId !== activeViewId) return
          const defaultView = views.find((view) => view.isDefault && view.id !== viewId)
          setTableParams({ view: defaultView?.id ?? ALL_VIEW_PARAM })
        },
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to delete view')),
      })
    },
    [activeViewId, views, setTableParams]
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
      filter?: TablePredicate,
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
    (
      rowIds: string[] | undefined,
      runMode: RunMode,
      filter?: TablePredicate,
      excludeRowIds?: string[]
    ) => {
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
    (filter?: TablePredicate, excludeRowIds?: string[]) => {
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

  /**
   * The table's own folder trail, so the header reads `Tables / Reports / Q3` exactly as the
   * list does one level up — and as a file's header does. Skipped in embedded mode, which
   * renders no header at all.
   */
  const { ancestors: folderChain } = useFolderAncestors({
    resourceType: 'table',
    workspaceId,
    folderId: tableData?.folderId,
    enabled: !embedded,
  })

  const handleNavigateToFolder = useCallback(
    (folderId: string | null) => {
      router.push(folderedResourceListHref('table', workspaceId, folderId))
    },
    [router, workspaceId]
  )

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
      const exported = await exportTableAsync.mutateAsync({ format: 'csv' })
      if (exported.status === 'completed') {
        await downloadExportResult(workspaceId, exported.id)
      } else {
        toast.success('Export started — the download will begin when it finishes')
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

  useRegisterGlobalCommands(() => [
    {
      id: 'table-new-column',
      handler: () => {
        if (!userPermissions.canEdit) return
        if (tableDataRef.current?.locks.schemaLocked) {
          showBlockedToast('add-column')
          return
        }
        handleAddColumnOfType('string')
      },
    },
    {
      id: 'table-export-csv',
      handler: () => {
        if (!tableDataRef.current?.rowCount) return
        void handleExportCsv()
      },
    },
    {
      id: 'table-import-csv',
      handler: () => {
        if (!userPermissions.canEdit || tableDataRef.current?.locks.insertLocked) return
        onRequestImportCsv()
      },
    },
  ])

  const columnOptions = useMemo<ColumnOption[]>(
    () =>
      columns.map((col) => ({
        // `id` is the filter/sort field key (column id); `label` is what the user sees.
        id: getColumnId(col),
        label: col.name,
        type: col.type,
        icon: columnTypeIcon(col.type),
      })),
    [columns]
  )

  const handleSortColumn = useCallback(
    (column: string, direction: SortDirection) => {
      setTableParams({ sort: column, dir: direction })
      persistActiveViewConfig({ sort: [{ field: column, direction }] })
    },
    [setTableParams, persistActiveViewConfig]
  )

  /**
   * Clearing writes the default direction (stripped by clearOnDefault) and
   * drops the column, leaving a clean URL with no active sort.
   */
  const handleClearSort = useCallback(() => {
    setTableParams({ sort: null, dir: DEFAULT_TABLE_DETAIL_SORT_DIRECTION })
    persistActiveViewConfig({ sort: null })
  }, [setTableParams, persistActiveViewConfig])

  const sortConfig = useMemo<SortConfig>(
    () => ({
      options: columnOptions,
      active: sortColumn ? { column: sortColumn, direction: sortDirection } : null,
      onSort: handleSortColumn,
      onClear: handleClearSort,
      keepOpenOnSelect: true,
    }),
    [columnOptions, sortColumn, sortDirection, handleSortColumn, handleClearSort]
  )

  const handleFilterChange = useCallback(
    (next: TablePredicate | null) => {
      setFilter(next)
      persistActiveViewConfig({ filter: next })
    },
    [persistActiveViewConfig]
  )

  const handleHiddenColumnsChange = useCallback(
    (next: string[]) => {
      setHiddenColumns(next)
      persistActiveViewConfig({ hiddenColumns: next })
    },
    [persistActiveViewConfig]
  )

  /**
   * "Filter by cell value" from the grid's cell context menu. Narrows the
   * PRUNED filter, so a condition the current schema already invalidated is not
   * resurrected, and opens the panel — a silently narrowed table would leave the
   * user no way to see what was applied. Persists explicitly: the reseeded
   * panel starts signature-matched to this filter, so its gesture handlers will
   * not emit it again.
   */
  const handleFilterByCellValue = (conditions: readonly Predicate[]) => {
    const next = withCellValueFilter(effectiveFilter, conditions)
    replaceFilter(next)
    persistActiveViewConfig({ filter: next })
    setFilterOpen(true)
  }

  const breadcrumbs = useMemo(
    (): BreadcrumbItem[] =>
      folderBreadcrumbItems({
        rootLabel: FOLDERED_RESOURCE_HEADERS.table.rootLabel,
        rootIcon: FOLDERED_RESOURCE_HEADERS.table.rootIcon,
        breadcrumbs: folderChain,
        onNavigate: handleNavigateToFolder,
        trailing: [
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
                  ...(userPermissions.canAdmin
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
      }),
    [
      folderChain,
      handleNavigateToFolder,
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

  const canOpenLockSettings = userPermissions.canAdmin === true

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
      // 'status' is the on-open announcement — nothing was refused, so it reads
      // as information rather than a warning.
      const notify = action === 'status' ? toast.info : toast.warning
      blockedToastIdRef.current = notify(title, {
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

  // Announce the lock state once per table on open. Unlike the re-rendering
  // permission gates, this fires once and can't self-correct, so it waits for
  // `canAdmin` to settle instead of treating loading as permitted.
  const announcedLockTableIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!tableData || userPermissions.isLoading) return
    if (announcedLockTableIdRef.current === tableData.id) return
    announcedLockTableIdRef.current = tableData.id
    if (lockedNouns(tableData.locks).length === 0) return
    showBlockedToast('status')
  }, [tableData, userPermissions.isLoading, showBlockedToast])

  // A notice must not outlive the table it describes — its action targets
  // whichever table is current. Keyed on `tableId` so an embedded swap that
  // changes the prop without a route change is covered too. Leaving ends the
  // visit, so the latch resets and coming back announces again.
  useEffect(
    () => () => {
      announcedLockTableIdRef.current = null
      if (!blockedToastIdRef.current) return
      toast.dismiss(blockedToastIdRef.current)
      blockedToastIdRef.current = null
    },
    [tableId]
  )

  // A toast's action is captured when it is created, so a viewer who loses
  // admin access mid-toast would keep a Lock settings button that opens
  // nothing. Dismiss on that transition only — a viewer who never had access
  // has a legitimate action-less notice that must survive.
  const couldOpenLockSettingsRef = useRef(canOpenLockSettings)
  useEffect(() => {
    const lostAccess = couldOpenLockSettingsRef.current && !canOpenLockSettings
    couldOpenLockSettingsRef.current = canOpenLockSettings
    if (!lostAccess || !blockedToastIdRef.current) return
    toast.dismiss(blockedToastIdRef.current)
    blockedToastIdRef.current = null
  }, [canOpenLockSettings])

  const headerActions = useMemo(() => {
    if (!tableData) return undefined
    return [
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
  }, [tableData, userPermissions.canEdit, handleExportCsv, onRequestImportCsv])

  // Adding a column is a schema change. The trigger stays visible when the
  // table is schema-locked and explains itself instead of disappearing.
  const canMutateSchema = userPermissions.canEdit && !tableData?.locks.schemaLocked
  const createTrigger = userPermissions.canEdit ? (
    <ColumnDropdown
      columns={columns}
      tableRowTtlEnabled={tableRowTtlEnabled}
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
  const exportTableAsync = useExportTable({ workspaceId, tableId })
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

  const runStatus =
    embedded && (selection.totalRunning > 0 || selection.hasActiveDispatch) ? (
      <RunStatusControl
        running={selection.totalRunning}
        queueing={!selection.hasRunningCell}
        onStopAll={onStopAll}
        isStopping={cancelRunsMutation.isPending}
      />
    ) : null

  /** Right-aligned slot. Left `undefined` when absent so the options bar
   *  doesn't render an empty flex row. */
  const optionsTrailing = runStatus || undefined

  return (
    <Resource>
      {!embedded && (
        <Resource.Header
          icon={FOLDERED_RESOURCE_HEADERS.table.rootIcon}
          breadcrumbs={breadcrumbs}
          aside={
            <div className='flex items-center gap-1.5'>
              {presenceUsers.length > 0 && (
                <PresenceAvatars users={presenceUsers} className='mr-1' />
              )}
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
            Resource.Header, so the run/stop control rides in the options bar — pinned
            right, opposite the menu cluster. */}
      <Resource.Options
        sort={sortConfig}
        filter={filterConfig}
        aside={
          viewsAvailable ? (
            <ViewsMenu
              views={views}
              activeViewId={activeView?.id ?? null}
              onSelect={handleSelectView}
              onRename={handleRenameView}
              onSetDefault={handleSetDefaultView}
              onDelete={handleDeleteView}
              onNewView={handleNewView}
              canEdit={userPermissions.canEdit}
            />
          ) : undefined
        }
        asideEnd={
          <ColumnsMenu
            columns={columns}
            workflowGroups={tableWorkflowGroups}
            hiddenColumns={effectiveHiddenColumns}
            onChange={handleHiddenColumnsChange}
          />
        }
        trailing={optionsTrailing}
      />
      {filterOpen && (
        <TableFilter
          key={filterSeed}
          columns={columns}
          filter={effectiveFilter}
          autoApply
          onChange={handleFilterChange}
          onClose={() => setFilterOpen(false)}
        />
      )}
      <SaveViewModal
        open={viewModal?.mode === 'new' || renamingView !== null}
        onOpenChange={(open) => !open && setViewModal(null)}
        mode={viewModal?.mode === 'rename' ? 'rename' : 'new'}
        initialName={renamingView?.name ?? ''}
        onSubmit={handleSubmitViewName}
        isSubmitting={createViewMutation.isPending || updateViewMutation.isPending}
      />
      <TableGrid
        workspaceId={workspaceId}
        tableId={tableId}
        embedded={embedded}
        tableRowTtlEnabled={tableRowTtlEnabled}
        locks={tableData?.locks}
        onBlockedAction={showBlockedToast}
        sidebarReservedPx={sidebarReservedPx}
        remoteSelections={remoteSelections}
        emitCellSelection={emitCellSelection}
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
        onFilterByCellValue={handleFilterByCellValue}
        onSortColumn={handleSortColumn}
        onClearSort={handleClearSort}
        onRunColumn={onRunColumn}
        onRunRow={onRunRow}
        onRunRows={onRunRows}
        onStopRows={onStopRows}
        onStopAllRows={onStopAllRows}
        onStopRow={onStopRow}
        onSelectionChange={onSelectionChange}
        queryOptions={queryOptions}
        hiddenColumns={effectiveHiddenColumns}
        viewLayout={activeViewConfig}
        viewLayoutKey={activeView?.id ?? null}
        // The router reads the owner at call time (buffer / view / All-metadata),
        // so no binding gap can send a write to the wrong place between settle
        // and adoption.
        onPersistLayout={handlePersistLayout}
        columnRenameSinkRef={columnRenameSinkRef}
        layoutSnapshotSinkRef={layoutSnapshotRef}
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
        tableRowTtlEnabled={tableRowTtlEnabled}
        onClose={onCloseSlideout}
        allColumns={columns}
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
        defaultAction='dismiss'
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
          defaultAction='dismiss'
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
